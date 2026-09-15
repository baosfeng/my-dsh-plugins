#!/usr/bin/env node
/**
 * check-client-artifacts.mjs — 构建产物 ↔ 源码/共享件 一致性门禁（issue #318，ADR-0002）。
 *
 * 覆盖两类产物（两类都**必须提交**、而 CI 不跑构建，所以都会静默陈旧）：
 *   1. client bundle：消费 `plugins/dsh-shared/client-parts/*` 的插件，`node scripts/build.mjs`
 *      重建 `lib/client.js` 后须与 git 已提交版本逐字节一致；
 *   2. server 端 tsc 产物：各插件 `tsconfig.json`（server 配置）编译到 `lib/` 的 `.js`
 *      （如 `lib/store.js` / `lib/media-route.js`）——源码删过未使用声明但产物没重生成时，
 *      这里会报出来。
 *
 * 为什么需要（不是重复门禁）：CI 只跑 `node --check` + 测试，不重建产物，所以"改了共享件/
 * 删了声明但漏重建"长期不会被发现，表现为插件间行为漂移——实测 commit 735e2fa 加 3 个图标
 * 只重建了 2 个消费方；file-activity 的 lib/media-route.js、lib/store.js 也属同类陈旧。
 *
 * 用法：
 *   node scripts/check-client-artifacts.mjs             # 全量（client + server）
 *   node scripts/check-client-artifacts.mjs --list      # 只列判定范围（不构建，<1s）
 *   node scripts/check-client-artifacts.mjs --client-only   # 只查 client bundle（更快）
 *   node scripts/check-client-artifacts.mjs --json      # 机器可读结果
 *   node scripts/check-client-artifacts.mjs --plugin <名>
 *
 * 退出码：0 = 全部同源；1 = 存在漂移 / 无法判定（fail-closed：缺产物、tsc 失败、git 不可用都算失败）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  evaluateClientArtifacts,
  findClientArtifactConsumers,
  renderClientArtifactReport,
} from './lib/client-artifacts.mjs'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_ARTIFACT = join('lib', 'client.js')
const SHARED_PARTS_DIR = join('plugins', 'dsh-shared', 'client-parts')

/** dsh-shared 里的共享部件文件名（"共享件清单"的唯一来源）。 */
export function sharedPartNames(root = REPO_ROOT) {
  const dir = join(root, SHARED_PARTS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.part.js'))
    .sort()
}

/** 插件名 → scripts/build.mjs 源码（无该文件的插件不参与 client 判定）。 */
export function buildSources(root = REPO_ROOT) {
  const pluginsDir = join(root, 'plugins')
  const out = {}
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const build = join(pluginsDir, entry.name, 'scripts', 'build.mjs')
    if (existsSync(build)) out[entry.name] = readFileSync(build, 'utf8')
  }
  return out
}

export function findConsumers(root = REPO_ROOT) {
  return findClientArtifactConsumers(buildSources(root), sharedPartNames(root))
}

/** 有 server 端 tsconfig（`tsconfig.json`）的插件——其 `lib/*.js` 是 tsc 产物。 */
export function serverPlugins(root = REPO_ROOT) {
  const pluginsDir = join(root, 'plugins')
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(pluginsDir, e.name, 'tsconfig.json')))
    .map((e) => e.name)
    .sort()
}

/** 已提交（HEAD）的产物内容；未纳入版本控制 / git 不可用 → null（判据按 fail-closed 处理）。 */
function committed(root, relPath) {
  try {
    return execFileSync('git', ['show', `HEAD:${relPath}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/** 重建单个消费方的 client bundle。 */
function buildClient(root, plugin) {
  execFileSync('node', ['scripts/build.mjs'], {
    cwd: join(root, 'plugins', plugin),
    stdio: 'ignore',
    timeout: 600_000,
  })
}

/**
 * 把 server 端 tsc 产物编到临时目录（一次 tsc，不逐文件跑），返回 `{文件相对路径: 内容}`
 * 或 null（tsc 失败 → fail-closed）。`--outDir` 覆盖 tsconfig 的 outDir，工作区不被改动；
 * server tsconfig 已 `exclude: src/client`，因此与 client 端产物互不干扰。
 */
function buildServerToTemp(root, plugin) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-artifact-${plugin}-`))
  try {
    execFileSync('npx', ['--no-install', 'tsc', '-p', 'tsconfig.json', '--outDir', dir], {
      cwd: join(root, 'plugins', plugin),
      stdio: 'ignore',
      timeout: 600_000,
    })
    const out = {}
    const walk = (rel) => {
      for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const next = rel === '' ? entry.name : join(rel, entry.name)
        if (entry.isDirectory()) walk(next)
        else if (entry.name.endsWith('.js')) out[next] = readFileSync(join(dir, next))
      }
    }
    walk('')
    return out
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 跑门禁。可注入 `root` / `consumers` / `serverTargets` / `log` 供单测构造漂移与失败用例。
 */
export function runCheck({
  root = REPO_ROOT,
  consumers = null,
  serverTargets = null,
  clientOnly = false,
  log = console.log,
} = {}) {
  const started = Date.now()
  const list = consumers ?? findConsumers(root)
  const servers = clientOnly ? [] : (serverTargets ?? serverPlugins(root))
  if (list.length === 0 && servers.length === 0) {
    log('❌ 判定范围为空——判据本身失效（fail-closed）')
    return { ok: false, code: 1, checked: 0, drifted: [], ms: Date.now() - started }
  }

  const drifted = []
  // 1. client bundle（只重建受影响插件）
  const buildFailures = new Set()
  for (const { plugin } of list) {
    try {
      buildClient(root, plugin)
    } catch (error) {
      buildFailures.add(plugin)
      drifted.push({ plugin, parts: [], reason: `client 重建失败：${error.message.split('\n')[0]}` })
    }
  }
  const clientResult = evaluateClientArtifacts(list, (plugin) => {
    const artifact = join(root, 'plugins', plugin, CLIENT_ARTIFACT)
    return {
      expected: buildFailures.has(plugin) || !existsSync(artifact) ? null : readFileSync(artifact),
      actual: committed(root, `plugins/${plugin}/${CLIENT_ARTIFACT}`),
    }
  })
  drifted.push(...clientResult.drifted)

  // 2. server 端 tsc 产物
  for (const plugin of servers) {
    const emitted = buildServerToTemp(root, plugin)
    if (emitted === null) {
      drifted.push({ plugin, parts: [], reason: 'server tsc 编译失败（无法判定产物是否同源）' })
      continue
    }
    const files = Object.keys(emitted).sort()
    if (files.length === 0) {
      drifted.push({ plugin, parts: [], reason: 'server tsc 未产出任何 .js（配置或 include 可能已坏）' })
      continue
    }
    for (const file of files) {
      const expected = emitted[file]
      const actual = committed(root, `plugins/${plugin}/lib/${file}`)
      if (actual === null) {
        drifted.push({ plugin, parts: [], reason: `lib/${file} 未提交（源码在、产物缺失）` })
      } else if (!expected.equals(actual)) {
        drifted.push({
          plugin,
          parts: [`server:${file}`],
          reason: `lib/${file} 与 tsc 重建结果不一致（差 ${expected.length - actual.length} 字节）`,
        })
      }
    }
  }

  const ms = Date.now() - started
  const scope = `client ${list.length} 个消费方 + server ${servers.length} 个插件`
  if (drifted.length === 0) {
    log(`✅ 产物与源码/共享件同源（${scope}）`)
    log(`   耗时 ${ms}ms（client 只重建受影响插件；server 走临时 outDir，不改工作区）`)
    return { ok: true, code: 0, checked: list.length + servers.length, drifted: [], ms }
  }
  if (clientResult.drifted.length > 0) {
    log(renderClientArtifactReport({ checked: list.length, drifted: clientResult.drifted }))
  }
  const serverDrift = drifted.filter((d) => !clientResult.drifted.includes(d))
  if (serverDrift.length > 0) {
    log(`❌ server 端 tsc 产物不同源：${serverDrift.length} 处`)
    log('   修复：在对应插件目录跑 `npx tsc -p tsconfig.json` 并提交 lib/ 下的产物')
    for (const d of serverDrift.slice(0, 8)) log(`   · ${d.plugin}：${d.reason}`)
    if (serverDrift.length > 8) log(`   …其余 ${serverDrift.length - 8} 处已截断`)
  }
  log(`   耗时 ${ms}ms`)
  return { ok: false, code: 1, checked: list.length + servers.length, drifted, ms }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      '用法：node scripts/check-client-artifacts.mjs [--list] [--json] [--client-only] [--root <目录>] [--plugin <名>]',
    )
    process.exit(0)
  }
  // --root 供单测/沙箱指向临时仓库；默认仓库根（与生产语义一致）。
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : REPO_ROOT
  if (args.includes('--list')) {
    for (const { plugin, parts } of findConsumers(root)) console.log(`client\t${plugin}\t${parts.join(',')}`)
    for (const plugin of serverPlugins(root)) console.log(`server\t${plugin}\tlib/*.js (tsc)`)
    process.exit(0)
  }
  const only = args.includes('--plugin') ? args[args.indexOf('--plugin') + 1] : null
  const consumers = only ? findConsumers(root).filter((c) => c.plugin === only) : null
  const serverTargets = only ? serverPlugins(root).filter((p) => p === only) : null
  if (only && (consumers ?? []).length === 0 && (serverTargets ?? []).length === 0) {
    console.error(`❌ --plugin ${only} 不在判定范围内（用 --list 查看）`)
    process.exit(1)
  }
  const result = runCheck({
    root,
    consumers,
    serverTargets,
    clientOnly: args.includes('--client-only'),
    log: args.includes('--json') ? () => {} : console.log,
  })
  if (args.includes('--json')) console.log(JSON.stringify(result))
  process.exit(result.code)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
