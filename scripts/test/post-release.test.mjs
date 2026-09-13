/**
 * post-release.test.mjs — 发版后校验判定与文案单元测试（issue #246 改造）。
 *
 * 背景：原实现的 verifyPostRelease 自己 `process.exit(1)`，没法在批量并发里用
 * （N 个 tag 的 Release 等待并发后，任一分支 exit 会把其它等待的日志截断）。
 * 现在拆成「纯判定/文案」+「IO 轮询」两层，本套件钉住判定口径**一字未改**：
 *   - GitHub Release 未创建 → ok=false（发版失败，exit 1）；
 *   - npm 未发布 → 只警告不阻断（issue #12：GitHub Release 是主交付物）；
 *   - GH_TOKEN 未配置 → 跳过 Release 校验（不算失败）。
 */
import { describe, it, expect } from 'vitest'
import { summarizePostRelease, POST_RELEASE_TIMEOUT_MS } from '../lib/post-release.mjs'

const target = { name: 'dsh-demo', version: '1.2.3', pkgName: 'dsh-demo' }
const levels = (lines) => lines.map((l) => l.level)
const text = (lines) => lines.map((l) => l.text).join('\n')

describe('summarizePostRelease（发版后校验判定）', () => {
  it('Release 已创建 + npm 已发布 → ok，两条成功', () => {
    const r = summarizePostRelease(target, { release: { ok: true }, npm: { ok: true } })
    expect(r.ok).toBe(true)
    expect(levels(r.lines)).toEqual(['ok', 'ok'])
    expect(text(r.lines)).toContain('dsh-demo@v1.2.3')
  })

  it('Release 未创建 → ok=false（发版失败，必须 exit 1）', () => {
    const r = summarizePostRelease(target, { release: { timeout: true }, npm: { ok: true } })
    expect(r.ok).toBe(false)
    expect(levels(r.lines)[0]).toBe('error')
    expect(text(r.lines)).toContain('未在 5 分钟内创建')
  })

  it('npm 未发布 → 只警告不阻断（issue #12：GitHub Release 为主交付物）', () => {
    const r = summarizePostRelease(target, { release: { ok: true }, npm: { timeout: true } })
    expect(r.ok).toBe(true)
    expect(levels(r.lines)).toEqual(['ok', 'warn'])
    expect(text(r.lines)).toContain('npm publish --access public')
  })

  it('GH_TOKEN 未配置 → 跳过 Release 校验，不算失败', () => {
    const r = summarizePostRelease(target, { release: { skipped: true }, npm: { ok: true } })
    expect(r.ok).toBe(true)
    expect(levels(r.lines)).toEqual(['info', 'ok'])
  })

  it('npm 未发布且 Release 也失败 → ok=false（两者都不满足）', () => {
    const r = summarizePostRelease(target, { release: { http: 500 }, npm: { timeout: true } })
    expect(r.ok).toBe(false)
  })

  it('轮询上限可注入，文案跟着变（并发下每个 tag 可独立设上限）', () => {
    const r = summarizePostRelease(target, { release: { timeout: true }, npm: { timeout: true } }, 60000)
    expect(text(r.lines)).toContain('未在 1 分钟内')
  })

  it('默认轮询上限仍是 5 分钟（与改造前一致，不悄悄放宽）', () => {
    expect(POST_RELEASE_TIMEOUT_MS).toBe(300000)
  })

  it('缺字段的 result 不炸（并发分支里的异常输入）', () => {
    const r = summarizePostRelease(target, {})
    expect(r.ok).toBe(false)
    expect(r.lines).toHaveLength(2)
  })
})
