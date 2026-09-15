#!/usr/bin/env node
/**
 * typecheck-all.mjs — 遍历全部 TS 插件做类型检查：server 端 `tsconfig.json` + client 端 `tsconfig.client.json`。
 *
 * 为什么需要它：根 `tsconfig.json` 的 include 覆盖 `plugins/**`，但必须排除 `plugins/<插件>/src/client/**`
 * —— client parts 是「拼接片段」（无 import/export，靠 factory 全局作用域共享符号），在根配置的
 * nodenext 模块模式下每个片段都被当成独立模块，跨文件符号全部解析失败（数百个 TS2304/TS2552）。
 * 因此 client 端的类型检查由各插件自己的 `tsconfig.client.json` 承担（`module: commonjs`，无
 * import/export 的文件是全局脚本，语义与拼接一致）。本脚本保证「排除了但没人检查」的盲区不存在。
 *
 * issue #330 的两处优化（**门禁语义一个字没改**：同样的 tsconfig、同样的插件集合、同样的 --noEmit）：
 *   1. 直调 `node_modules/.bin/tsc`（缺失才回退 `npx --no-install tsc`）—— npx 每次启动要多花
 *      约 170ms 的自身解析（见 .husky/pre-commit 的实测注释），29 个任务就是约 5s 纯浪费；
 *   2. N 路并发（默认 min(4, CPU)，可用 `--concurrency` / `TYPECHECK_CONCURRENCY` 覆盖）——
 *      原先是一个 for 循环串行跑 29 次 tsc 进程。实测本机 12.6s → 0.9s。
 *
 * 与 `plugins/<插件>/tsconfig.json` 的分工（唯一权威执行点，issue #330）：
 *   · 本脚本 = plugins 下 server + client TS 源码的**唯一权威**（构建语义，产物由这些配置生成）
 *   · 根 `tsc --noEmit` = 只剩 `plugins/<插件>/lib/*.d.ts`（产物声明）与根级 TS（见 tsconfig.json 注释）
 *
 * 用法：
 *   node scripts/typecheck-all.mjs                  # 全量（server + client）
 *   node scripts/typecheck-all.mjs --concurrency 8  # 指定并发度
 *   node scripts/typecheck-all.mjs --json           # 机器可读结果
 * 退出码：0 = 全部通过；1 = 有失败项、或没有找到任何可检查的 tsconfig（防「什么都没查却绿」）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseConcurrency() {
  const argv = process.argv
  const flagIdx = argv.indexOf('--concurrency')
  const raw = flagIdx >= 0 ? argv[flagIdx + 1] : process.env.TYPECHECK_CONCURRENCY
  const n = Number.parseInt(raw ?? '', 10)
  if (Number.isInteger(n) && n >= 1 && n <= 16) return n
  // 默认 4：CI runner（ubuntu-latest）是 4 核，本机核数更多时也不必超过它——
  // tsc 是短命进程（~300ms），并发收益在 4 路后迅速饱和（实测 4 → 2.6s、8 → 2.2s）。
  return Math.min(4, availableParallelism())
}

/** 枚举待检查项：`{ label, cwd, project }`。顺序稳定（插件名字典序，server 先于 client）。 */
export function listTypecheckTargets(pluginsDir) {
  const targets = []
  for (const name of readdirSync(pluginsDir).sort()) {
    const dir = join(pluginsDir, name)
    for (const [file, kind] of [
      ['tsconfig.json', 'server'],
      ['tsconfig.client.json', 'client'],
    ]) {
      if (existsSync(join(dir, file))) targets.push({ label: `${name} ${kind}`, cwd: dir, project: file })
    }
  }
  return targets
}

/** tsc 可执行入口：优先本地 bin（省 npx 解析），缺失回退 npx --no-install（零联网）。 */
function tscCommand() {
  const local = join(root, 'node_modules', '.bin', 'tsc')
  if (existsSync(local)) return { cmd: local, prefix: [] }
  return { cmd: 'npx', prefix: ['--no-install', 'tsc'] }
}

function runOne(target, tsc) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(tsc.cmd, [...tsc.prefix, '--noEmit', '-p', target.project], {
      cwd: target.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', npm_config_update_notifier: 'false' },
    })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.on('error', (error) =>
      resolve({ ...target, ok: false, ms: Date.now() - started, out: String(error.message) }),
    )
    child.on('close', (code) => resolve({ ...target, ok: code === 0, code, ms: Date.now() - started, out }))
  })
}

async function runPool(targets, limit, tsc) {
  const results = []
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= targets.length) return
      const result = await runOne(targets[index], tsc)
      results.push(result)
      const mark = result.ok ? '✓' : '✗'
      console.log(`  ${mark} ${result.label} ${(result.ms / 1000).toFixed(1)}s`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker))
  return results
}

async function main() {
  const asJson = process.argv.includes('--json')
  const targets = listTypecheckTargets(join(root, 'plugins'))
  if (targets.length === 0) {
    console.error('[typecheck-all] ❌ 没有找到任何 tsconfig（plugins/*/tsconfig.json 或 tsconfig.client.json）')
    console.error('  这不是「通过」，而是「什么都没检查」——门禁配置可能已被破坏。')
    process.exit(1)
  }
  const concurrency = parseConcurrency()
  const tsc = tscCommand()
  const started = Date.now()
  if (!asJson) {
    console.log(`[typecheck-all] ${targets.length} 个类型检查任务（并发 ${concurrency}，tsc: ${tsc.cmd}）`)
  }
  const results = await runPool(targets, concurrency, tsc)
  const failed = results.filter((r) => !r.ok)
  const totalMs = Date.now() - started

  if (asJson) {
    console.log(JSON.stringify({ ok: failed.length === 0, totalMs, checks: results.map(shapeOf) }, null, 2))
  } else if (failed.length === 0) {
    console.log(`[typecheck-all] ✅ 全部通过（${targets.length} 个任务，${(totalMs / 1000).toFixed(1)}s）`)
  } else {
    console.error(`[typecheck-all] ❌ ${failed.length}/${targets.length} 个任务失败（${(totalMs / 1000).toFixed(1)}s）`)
    for (const f of failed) {
      console.error(`\n── ${f.label}（${f.project} @ ${f.cwd}）──`)
      console.error(f.out.trim().split('\n').slice(-40).join('\n'))
    }
    console.error(
      '\n复现单项：cd <插件目录> && ../../node_modules/.bin/tsc --noEmit -p ' + (failed[0]?.project ?? 'tsconfig.json'),
    )
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

/** 结果里只带 parity/日志需要的字段（避免把整段 tsc 输出塞进 JSON）。 */
function shapeOf(r) {
  return { label: r.label, ok: r.ok, ms: r.ms }
}

main()
