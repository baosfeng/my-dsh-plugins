/**
 * post-release.test.mjs — 发版后校验判定与文案单元测试。
 *
 * 判定口径（一字不放宽）：
 *   - GitHub Release 已创建 → ok；超时未创建 / HTTP 非 404 → ok=false（发版失败，exit 1）；
 *   - GH_TOKEN 未配置 → 跳过 Release 校验（info，不算失败）。
 *
 * npm 发布状态**不再由本地判定**：本机 npm 版本查询常走 npmmirror 镜像且缓存陈旧
 * （实测本机某包显示 0.1.0、官方 registry 已是 0.1.1）；最近一次真实批量发版里 npm
 * 轮询耗满 5 分钟超时窗口，还对两个**实际已发布成功**的包报了「未在 5 分钟内发布」
 * 假警报。→ npm 只留一行 info 说明，不含任何 ✓/⚠ 判定。
 *
 * 防回归（本套件钉住）：源码里不得再出现 npm 轮询，运行 verifyPostRelease 不得
 * spawn 子进程、不得为 npm 等待阻塞。
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as postReleaseModule from '../lib/post-release.mjs'
import { summarizePostRelease, verifyPostRelease, POST_RELEASE_TIMEOUT_MS } from '../lib/post-release.mjs'

const SOURCE = readFileSync(new URL('../lib/post-release.mjs', import.meta.url), 'utf8')
const target = { name: 'dsh-demo', version: '1.2.3', pkgName: 'dsh-demo' }
const levels = (lines) => lines.map((l) => l.level)
const text = (lines) => lines.map((l) => l.text).join('\n')

describe('summarizePostRelease（发版后校验判定）', () => {
  it('Release 已创建 → ok，npm 只给一行 info（不再参与判定）', () => {
    const r = summarizePostRelease(target, { release: { ok: true } })
    expect(r.ok).toBe(true)
    expect(levels(r.lines)).toEqual(['ok', 'info'])
    expect(text(r.lines)).toContain('dsh-demo@v1.2.3')
  })

  it('Release 未创建（超时）→ ok=false（发版失败，必须 exit 1）', () => {
    const r = summarizePostRelease(target, { release: { timeout: true } })
    expect(r.ok).toBe(false)
    expect(levels(r.lines)[0]).toBe('error')
    expect(text(r.lines)).toContain('未在 5 分钟内创建')
  })

  it('Release HTTP 非 404 → ok=false（口径不变）', () => {
    const r = summarizePostRelease(target, { release: { http: 500 } })
    expect(r.ok).toBe(false)
    expect(levels(r.lines)[0]).toBe('error')
  })

  it('GH_TOKEN 未配置 → 跳过 Release 校验，不算失败', () => {
    const r = summarizePostRelease(target, { release: { skipped: true } })
    expect(r.ok).toBe(true)
    expect(levels(r.lines)).toEqual(['info', 'info'])
  })

  it('npm 只留 info 说明：无 ✓/⚠ 判定、无「未在 N 分钟内发布」、无手动重试命令', () => {
    const r = summarizePostRelease(target, { release: { ok: true } })
    const npmLine = r.lines.find((l) => l.text.includes('npm'))
    expect(npmLine).toBeTruthy()
    expect(npmLine.level).toBe('info')
    expect(npmLine.text).not.toMatch(/[✓⚠✗]/)
    const all = text(r.lines)
    expect(all).not.toContain('分钟内发布')
    expect(all).not.toContain('npm publish --access public')
    expect(all).toContain('GitHub Actions')
  })

  it('历史 npm 字段不再影响判定（纯函数忽略未知字段）', () => {
    const withTimeout = summarizePostRelease(target, { release: { ok: true }, npm: { timeout: true } })
    const withOk = summarizePostRelease(target, { release: { ok: true }, npm: { ok: true } })
    expect(withTimeout).toEqual(withOk)
    expect(withTimeout.ok).toBe(true)
  })

  it('轮询上限可注入，Release 文案跟着变（并发下每个 tag 可独立设上限）', () => {
    const r = summarizePostRelease(target, { release: { timeout: true } }, 60000)
    expect(text(r.lines)).toContain('未在 1 分钟内创建')
  })

  it('默认轮询上限仍是 5 分钟（Release 判定不悄悄放宽）', () => {
    expect(POST_RELEASE_TIMEOUT_MS).toBe(300000)
  })

  it('缺字段的 result 不炸（并发分支里的异常输入）', () => {
    const r = summarizePostRelease(target, {})
    expect(r.ok).toBe(false)
    expect(r.lines).toHaveLength(2)
  })
})

describe('verifyPostRelease（只等 Release，不为 npm 等待）', () => {
  beforeEach(() => {
    // 无 GH_TOKEN → Release 分支立即 skipped，用例不依赖网络
    vi.stubEnv('GH_TOKEN', '')
    vi.stubGlobal('fetch', () => {
      throw new Error('无 GH_TOKEN 时不应发起任何网络请求')
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('无 GH_TOKEN → 立即返回，结果里已无 npm 分支', async () => {
    const started = Date.now()
    const r = await verifyPostRelease('dsh-demo', 'dsh-demo', '1.2.3')
    const elapsed = Date.now() - started
    expect(r.ok).toBe(true)
    expect(r.result.release).toEqual({ ok: false, skipped: true })
    expect(r.result.npm).toBeUndefined()
    expect(levels(r.lines)).toEqual(['info', 'info'])
    // 旧实现此时会 npm 查询失败后 sleep 10s（并最终耗满 5 分钟）→ 3s 上限足以钉死回归
    expect(elapsed).toBeLessThan(3000)
  })

  it('注入更短的 timeout/poll 也不会产生任何 npm 等待', async () => {
    const started = Date.now()
    const r = await verifyPostRelease('dsh-demo', 'dsh-demo', '1.2.3', { timeoutMs: 5000, pollMs: 1000 })
    expect(r.ok).toBe(true)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('防回归：npm 轮询已从发版后校验中移除', () => {
  it('源码里不再有 npm 轮询（无子进程、无 npm 查询调用）', () => {
    expect(SOURCE).not.toMatch(/child_process/)
    expect(SOURCE).not.toMatch(/\bexecFileSync\b|\bspawnSync\b|\bspawn\(/)
    expect(SOURCE).not.toMatch(/npm\s+view/)
  })

  it('模块导出里没有 waitForNpm（不会被悄悄加回来）', () => {
    expect(Object.keys(postReleaseModule)).not.toContain('waitForNpm')
  })

  it('导出面只剩 Release 侧 API + npm 说明所需常量', () => {
    expect(Object.keys(postReleaseModule).sort()).toEqual(
      ['POST_RELEASE_POLL_MS', 'POST_RELEASE_TIMEOUT_MS', 'summarizePostRelease', 'verifyPostRelease'].sort(),
    )
  })
})
