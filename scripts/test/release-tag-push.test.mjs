/**
 * release-tag-push.test.mjs — tag 推送策略与触发确认单测（issue #375-#380）。
 *
 * 钉死三条判据（这些正是「提速不得削弱发布语义」的边界）：
 *   1. **逐个推**：一次 push 只带一个 ref——一次推 N 个 tag 是「零触发」的根因
 *      （实测 14 个 tag 一次推 → 2h12m57s 零 run），且 release.mjs 不得回退；
 *   2. **三态触发确认**：`created` / `pending`（确实没触发）/ `unknown`（无法判定）
 *      必须可区分——把「查不到」当「没触发」会制造「本地红、CI 绿」的假红；
 *   3. **绝不自动删远端 tag**：补救命令只打印，不代做（破坏性外发动作由人确认）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  tagPushArgv,
  bulkTagPushArgv,
  pushTagsIndividually,
  tagRunsUrl,
  readTriggeredFromResponse,
  confirmTagTriggered,
  retriggerHint,
} from '../lib/release-tag-push.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ok = () => ({ status: 200, json: async () => ({ total_count: 1, workflow_runs: [{ id: 1 }] }) })
const empty = () => ({ status: 200, json: async () => ({ total_count: 0, workflow_runs: [] }) })
const forbidden = () => ({ status: 403, json: async () => ({ message: 'rate limit' }) })

describe('tagPushArgv（逐个推 = 一次 push 一个 ref）', () => {
  it('单 tag → 单个 ref 参数', () => {
    expect(tagPushArgv('dsh-md-render@v0.1.9')).toEqual(['push', 'origin', 'dsh-md-render@v0.1.9'])
  })

  it('反模式 bulkTagPushArgv 会带多个 ref（保留仅为钉死「不许用它」）', () => {
    expect(bulkTagPushArgv(['a@v1', 'b@v2'])).toEqual(['push', 'origin', 'a@v1', 'b@v2'])
  })
})

describe('pushTagsIndividually（逐个推送）', () => {
  it('N 个 tag = N 次 push，且每次只带一个 ref', async () => {
    const calls = []
    const targets = [{ tag: 'a@v1' }, { tag: 'b@v2' }, { tag: 'c@v3' }]
    const outcome = await pushTagsIndividually(targets, async (argv) => {
      calls.push(argv)
      return { code: 0 }
    })
    expect(outcome.ok).toBe(true)
    expect(calls).toEqual([
      ['push', 'origin', 'a@v1'],
      ['push', 'origin', 'b@v2'],
      ['push', 'origin', 'c@v3'],
    ])
    // 关键：没有任何一次 push 带超过一个 ref（这正是零触发的根因）
    for (const argv of calls) expect(argv.length).toBe(3)
  })

  it('保序：结果顺序与输入一致', async () => {
    const seen = []
    const outcome = await pushTagsIndividually([{ tag: 'a@v1' }, { tag: 'b@v2' }], async (argv) => {
      seen.push(argv[2])
      return { code: 0 }
    })
    expect(seen).toEqual(['a@v1', 'b@v2'])
    expect(outcome.results.map((r) => r.tag)).toEqual(['a@v1', 'b@v2'])
  })

  it('失败即停（不继续推后续 tag）并回报失败的 tag', async () => {
    const calls = []
    const outcome = await pushTagsIndividually([{ tag: 'a@v1' }, { tag: 'b@v2' }, { tag: 'c@v3' }], async (argv) => {
      calls.push(argv[2])
      return { code: argv[2] === 'b@v2' ? 1 : 0 }
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.failedTag).toBe('b@v2')
    expect(calls).toEqual(['a@v1', 'b@v2']) // c@v3 未被推送
  })

  it('执行器返回残缺对象时按失败处理（不静默当作成功）', async () => {
    const outcome = await pushTagsIndividually([{ tag: 'a@v1' }], async () => ({}))
    expect(outcome.ok).toBe(false)
    expect(outcome.results[0].code).toBe(1)
  })
})

describe('readTriggeredFromResponse（三态判定）', () => {
  it('200 且有 run → created', () => {
    expect(readTriggeredFromResponse(200, { total_count: 2 })).toEqual({ known: true, created: true })
  })

  it('200 但 0 run → known 但未触发（等满超时才算「确实没触发」）', () => {
    expect(readTriggeredFromResponse(200, { total_count: 0 })).toEqual({ known: true, created: false })
  })

  it('无 total_count 时回落到 workflow_runs 长度', () => {
    expect(readTriggeredFromResponse(200, { workflow_runs: [{ id: 1 }] })).toEqual({ known: true, created: true })
    expect(readTriggeredFromResponse(200, {})).toEqual({ known: true, created: false })
  })

  it('非 200 → known=false（不得据此判「没触发」）', () => {
    expect(readTriggeredFromResponse(403, { message: 'rate limit' })).toEqual({ known: false, created: false })
    expect(readTriggeredFromResponse(401, null)).toEqual({ known: false, created: false })
  })
})

describe('tagRunsUrl', () => {
  it('按 head_branch（tag 名）查询并转义', () => {
    expect(tagRunsUrl('dsh-my-context@v0.1.5')).toContain('head_branch=dsh-my-context%40v0.1.5')
    expect(tagRunsUrl('x@v1', 'o/r')).toContain('https://api.github.com/repos/o/r/actions/runs')
  })
})

describe('confirmTagTriggered（触发确认）', () => {
  it('无 GH_TOKEN → skipped（无法确认 ≠ 没触发，不判红）', async () => {
    const result = await confirmTagTriggered('a@v1', { token: '' })
    expect(result.status).toBe('skipped')
  })

  it('已有 run → created', async () => {
    const result = await confirmTagTriggered('a@v1', { token: 't', fetchImpl: ok })
    expect(result.status).toBe('created')
  })

  it('查得到但等满超时仍无 run → pending（强证据：确实没触发）', async () => {
    const result = await confirmTagTriggered('a@v1', { token: 't', fetchImpl: empty, timeoutMs: 0 })
    expect(result.status).toBe('pending')
  })

  it('非 200 → unknown（附 HTTP 状态，供调用方区分限流）', async () => {
    const result = await confirmTagTriggered('a@v1', { token: 't', fetchImpl: forbidden, timeoutMs: 0 })
    expect(result.status).toBe('unknown')
    expect(result.http).toBe(403)
  })

  it('轮询到 run 出现即返回 created（不空等）', async () => {
    let calls = 0
    const flaky = async () => {
      calls += 1
      return calls === 1 ? empty() : ok()
    }
    const result = await confirmTagTriggered('a@v1', { token: 't', fetchImpl: flaky, timeoutMs: 5000, pollMs: 1 })
    expect(result.status).toBe('created')
    expect(calls).toBe(2)
  })
})

describe('retriggerHint（补救命令只提示、不代做）', () => {
  it('给出删 tag + 重推两步，并标注破坏性', () => {
    const lines = retriggerHint('a@v1').join('\n')
    expect(lines).toContain("git push --delete origin 'a@v1'")
    expect(lines).toContain("git push origin 'a@v1'")
    expect(lines).toContain('破坏性')
  })
})

describe('release.mjs 集成（防回退：不许回到「一次推 N 个 tag」）', () => {
  const source = readFileSync(join(root, 'scripts', 'release.mjs'), 'utf8')

  it('不再出现「一次 push 带多个 tag ref」的写法', () => {
    expect(source).not.toMatch(/\[\s*'push'\s*,\s*'origin'\s*,\s*\.\.\./)
    expect(source).not.toMatch(/bulkTagPushArgv/)
  })

  it('改用逐个推送 + 触发确认', () => {
    expect(source).toContain('pushTagsIndividually')
    expect(source).toContain('confirmTagTriggered')
  })

  it('未触发（pending）的 tag 跳过发版后校验空等并判失败', () => {
    expect(source).toContain('notTriggeredTags')
    expect(source).toContain('retriggerHint')
  })
})
