/**
 * npm-registry.test.mjs — 发版门禁 1a/1c 的 npm 查询件（issue #386）。
 *
 * 背景（本机实测）：本机 npm 配置指向 npmmirror 镜像 + 缓存，镜像的"否定性结论"不等于
 * registry 事实——官方已是 0.1.1 的包本机读成 0.1.0；刚发布的依赖镜像未同步时直接 404。
 * 于是门禁出现两类错误结论：
 *   · 1a 查询失败（非 404，如镜像超时/限流）→ 旧实现 `return { ok: true }` 静默放行 = **假绿**；
 *   · 1c 镜像 404 → 判定「从未发布」硬阻断 = **假红**（顺序发版被挡下）。
 *
 * 防回归口径（本套件钉住）：
 *   1. npm view 一律钉官方 registry（CLI + env 双保险，禁源重写），且 1a/1c 不得绕过该件直连 npm；
 *   2. 镜像 404 而官方有版本 → 1c **不阻断**；官方也 404 → 仍硬阻断（issue #72 口径不放松）；
 *   3. 1a 查询失败 → **不静默放行**（fail-closed），404（首次发布）语义不变。
 *
 * 测试手法：把「假 npm」可执行文件放进临时目录并前置到 PATH——它只有看到真正被钉住的
 * 官方源才回答 registry 事实，否则复现镜像的陈旧/未同步行为（新包 404）。因此用例验证的是
 * **参数与环境真的到达了子进程**，而不是字符串断言。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NPM_OFFICIAL_REGISTRY,
  npmRegistryEnv,
  npmViewInvocation,
  npmLatestGate,
  prefetchNpmVersions,
  createIsPublished,
} from '../lib/npm-registry.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RELEASE_SOURCE = readFileSync(join(repoRoot, 'scripts', 'release.mjs'), 'utf8')

/** 假 npm：模拟「本机配置指向镜像」与「钉住官方源」两种世界的差异。 */
const FAKE_NPM = `#!/bin/sh
# 只有同时满足「registry=官方」+「禁用源重写」时才回答 registry 事实；
# 否则复现镜像行为：缓存陈旧 / 新包未同步 → 404。
FAKE_OFFICIAL=0
if [ "$npm_config_registry" = "https://registry.npmjs.org" ] && [ "$npm_config_replace_registry_host" = "never" ]; then
  FAKE_OFFICIAL=1
fi
field=""
for arg in "$@"; do
  case "$arg" in
    dist-tags.latest|version) field="$arg" ;;
  esac
done
case "$FAKE_NPM_SCENARIO" in
  network-fail)
    echo "npm error network request to https://registry.npmjs.org/dsh-demo failed, reason: read ECONNRESET" >&2
    exit 1
    ;;
  official-not-found)
    echo "npm error code E404" >&2
    echo "npm error 404 Not Found - GET https://registry.npmjs.org/dsh-demo - Not found" >&2
    exit 1
    ;;
esac
if [ "$FAKE_OFFICIAL" != "1" ]; then
  echo "npm error code E404" >&2
  if [ "$field" = "dist-tags.latest" ]; then
    echo "npm error 404 Not Found - GET https://registry.npmmirror.com/dsh-demo" >&2
  else
    echo "npm error 404 Not Found - GET https://registry.npmmirror.com/dsh-shared (stale cache)" >&2
  fi
  exit 1
fi
if [ "$field" = "dist-tags.latest" ]; then
  echo "\${FAKE_NPM_LATEST:-0.1.0}"
else
  echo "\${FAKE_NPM_VERSION:-0.1.1}"
fi
exit 0
`

let stubDir = ''
beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'fake-npm-386-'))
  writeFileSync(join(stubDir, 'npm'), FAKE_NPM)
  chmodSync(join(stubDir, 'npm'), 0o755)
})
afterAll(() => {
  if (stubDir !== '') rmSync(stubDir, { recursive: true, force: true })
})

/**
 * 构造一个「真 spawn」的 exec：把假 npm 前置到 PATH，并把调用方给的 env 透传给子进程
 * （与 release.mjs 的 runChild 同形状：`exec(cmd, argv, { env }) → { code, stdout, stderr }`）。
 * `dropEnv: true` 用来模拟"旧实现不传 env"的世界，证明镜像结论确实会误判。
 */
function makeExec({ dropEnv = false, extraEnv = {} } = {}) {
  const calls = []
  const exec = (command, argv, options = {}) => {
    calls.push({ command, argv, env: options.env })
    const env = {
      ...process.env,
      ...extraEnv,
      PATH: `${stubDir}:${process.env.PATH}`,
    }
    if (!dropEnv && options.env) Object.assign(env, options.env)
    const r = spawnSync(command, argv, { env, encoding: 'utf8' })
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  return { exec, calls }
}

const collectSaid = () => {
  const lines = []
  return { lines, say: (text) => lines.push(text) }
}

// ── 官方源钉住（防"优化回镜像"）────────────────────────────────────────────
describe('npm 查询必须钉官方 registry（issue #386 的根因）', () => {
  it('命令参数带官方 registry，不含任何镜像域名', () => {
    const { argv } = npmViewInvocation('dsh-demo', 'dist-tags.latest')
    expect(argv).toEqual(['view', 'dsh-demo', 'dist-tags.latest', `--registry=${NPM_OFFICIAL_REGISTRY}`])
    expect(argv.join(' ')).not.toMatch(/npmmirror|taobao|cnpm/)
  })

  it('环境变量钉住官方源并禁用源重写（否则 npm 会按本机镜像改回去）', () => {
    expect(npmRegistryEnv()).toEqual({
      npm_config_registry: NPM_OFFICIAL_REGISTRY,
      npm_config_replace_registry_host: 'never',
    })
  })

  it('1a/1c 不得绕过本件直连 npm view（否则又回到镜像查询）', () => {
    expect(RELEASE_SOURCE).not.toMatch(/runChild\(\s*'npm'\s*,\s*\[\s*'view'/)
    expect(RELEASE_SOURCE).toContain('npm-registry.mjs')
  })
})

// ── 1a npmLatestGate ──────────────────────────────────────────────────────
describe('1a npmLatestGate（防降级）', () => {
  const gate = (exec, { version = '0.1.1', pkgName = 'dsh-demo' } = {}) => {
    const { lines, say } = collectSaid()
    return npmLatestGate({ exec, name: 'dsh-demo', pkgName, version, say }).then((r) => ({ ...r, lines }))
  }

  it('官方源读到 latest 0.1.0，当前 0.1.1 → 放行（无降级）', async () => {
    const { exec, calls } = makeExec()
    const r = await gate(exec)
    expect(r.ok).toBe(true)
    expect(r.lines.join('\n')).toContain('无降级')
    expect(calls[0].env.npm_config_registry).toBe(NPM_OFFICIAL_REGISTRY)
  })

  it('官方 latest 2.0.0 > 当前 1.0.0 → 拒绝发布（判定口径不变）', async () => {
    const { exec } = makeExec({ extraEnv: { FAKE_NPM_LATEST: '2.0.0' } })
    const r = await gate(exec, { version: '1.0.0' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('低于 npm latest 2.0.0')
  })

  it('官方 404（首次发布）→ 跳过检查，不阻断', async () => {
    const { exec } = makeExec({ extraEnv: { FAKE_NPM_SCENARIO: 'official-not-found' } })
    const r = await gate(exec)
    expect(r.ok).toBe(true)
    expect(r.lines.join('\n')).toContain('首次发布')
  })

  it('查询失败（网络异常）→ 不再静默放行：fail-closed 拒绝发布（假绿修复）', async () => {
    const { exec } = makeExec({ extraEnv: { FAKE_NPM_SCENARIO: 'network-fail' } })
    const r = await gate(exec)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('无法判定是否降级')
    expect(r.message).toContain(NPM_OFFICIAL_REGISTRY)
    expect(r.message).toContain('ECONNRESET')
  })

  it('查询失败时重试一次再判失败（网络抖动不当假红）', async () => {
    const { exec, calls } = makeExec({ extraEnv: { FAKE_NPM_SCENARIO: 'network-fail' } })
    const r = await gate(exec)
    expect(calls.length).toBe(2)
    expect(r.ok).toBe(false)
    expect(r.lines.join('\n')).toContain('重试')
  })

  it('非 stable 版本（预发布）不查询、不阻断', async () => {
    const { exec, calls } = makeExec()
    const r = await gate(exec, { version: '1.0.0-beta.1' })
    expect(r.ok).toBe(true)
    expect(calls.length).toBe(0)
  })
})

// ── 1c prefetchNpmVersions ────────────────────────────────────────────────
describe('1c prefetchNpmVersions（依赖发布状态）', () => {
  it('镜像未同步（无官方源时 404）而官方有版本 → 得到官方事实，不判 404', async () => {
    const { exec, calls } = makeExec()
    const map = await prefetchNpmVersions(exec, ['dsh-shared'], 2)
    expect(map.get('dsh-shared')).toEqual({ version: '0.1.1', notFound: false })
    expect(calls[0].env.npm_config_registry).toBe(NPM_OFFICIAL_REGISTRY)
    expect(calls[0].argv).toContain(`--registry=${NPM_OFFICIAL_REGISTRY}`)
  })

  it('对照（旧的"走本机配置"世界）：同样的假 npm 会返回镜像 404 → 误判未发布', async () => {
    const { exec } = makeExec({ dropEnv: true })
    const map = await prefetchNpmVersions(exec, ['dsh-shared'], 2)
    expect(map.get('dsh-shared')).toEqual({ version: '', notFound: true })
  })

  it('并发查询多个依赖，逐个落表（含查询异常项）', async () => {
    const { exec } = makeExec({ extraEnv: { FAKE_NPM_SCENARIO: 'network-fail' } })
    const map = await prefetchNpmVersions(exec, ['dsh-a', 'dsh-b'], 2)
    expect(map.get('dsh-a')).toEqual({ version: '', notFound: false })
    expect(map.get('dsh-b')).toEqual({ version: '', notFound: false })
  })
})

// ── 1c createIsPublished（判定规则一字未改，issue #72 口径不放松）───────────
describe('1c createIsPublished（判定语义不变）', () => {
  const index = new Map([['dsh-shared', { dir: 'dsh-shared', version: '0.1.1' }]])
  const build = ({ npmVersions, tagged = true, library = false }) =>
    createIsPublished({
      npmVersions,
      pluginIndex: index,
      isTagged: () => tagged,
      isLibraryDep: () => library,
    })

  it('镜像 404 而官方有版本（官方源查询结果）→ 不阻断（假红修复）', () => {
    const isPublished = build({ npmVersions: new Map([['dsh-shared', { version: '0.1.1', notFound: false }]]) })
    expect(isPublished('dsh-shared', '^0.1.0')).toBe(true)
  })

  it('官方也 404（真的从未发布）→ 硬阻断（issue #72）', () => {
    const isPublished = build({ npmVersions: new Map([['dsh-shared', { version: '', notFound: true }]]) })
    expect(isPublished('dsh-shared', '^0.1.0')).toBe(false)
  })

  it('版本低于声明范围 → 阻断', () => {
    const isPublished = build({ npmVersions: new Map([['dsh-shared', { version: '0.0.9', notFound: false }]]) })
    expect(isPublished('dsh-shared', '^0.1.0')).toBe(false)
  })

  it('限流等临时错误 + 已打 tag（非 library）→ 放行（现状语义）', () => {
    const isPublished = build({ npmVersions: new Map([['dsh-shared', { version: '', notFound: false }]]) })
    expect(isPublished('dsh-shared', '^0.1.0')).toBe(true)
  })

  it('限流 + library 依赖（运行时 import）→ 阻断（issue #72 不放松）', () => {
    const isPublished = build({
      npmVersions: new Map([['dsh-shared', { version: '', notFound: false }]]),
      library: true,
    })
    expect(isPublished('dsh-shared', '^0.1.0')).toBe(false)
  })

  it('限流 + 未打 tag → 阻断', () => {
    const isPublished = build({
      npmVersions: new Map([['dsh-shared', { version: '', notFound: false }]]),
      tagged: false,
    })
    expect(isPublished('dsh-shared', '^0.1.0')).toBe(false)
  })

  it('范围无下限 / 未预热 → 阻断', () => {
    expect(build({ npmVersions: new Map() })('dsh-shared', 'workspace:*')).toBe(false)
    expect(build({ npmVersions: new Map() })('dsh-shared', '^0.1.0')).toBe(false)
  })
})
