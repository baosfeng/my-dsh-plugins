/**
 * dsh-session-title-gen — title generation core tests.
 *
 * 覆盖：模板格式化、结构化判断、轻量流组装、LLM 生成（mock llm.stream）。
 */
import { describe, it, expect } from 'vitest'
import { formatTitle, isStructuredTitle, collectStreamText, generateTitle, foldTitle } from '../lib/title.js'

describe('formatTitle', () => {
  it('默认模板替换 {workspace} 与 {description}', () => {
    expect(formatTitle('[{workspace}] {description}', 'my-dsh-plugins', '修复 #143 记忆页签崩溃')).toBe(
      '[my-dsh-plugins] 修复 #143 记忆页签崩溃',
    )
  })

  it('自定义模板生效', () => {
    expect(formatTitle('{workspace}: {description}', 'repo-a', '重构标题生成')).toBe('repo-a: 重构标题生成')
  })

  it('description 为空时返回空串', () => {
    expect(formatTitle('[{workspace}] {description}', 'repo-a', '')).toBe('')
  })

  it('workspace 为空时仅保留 description', () => {
    expect(formatTitle('[{workspace}] {description}', '', '修复问题')).toBe('修复问题')
  })

  it('大量空格的 template 不触发 ReDoS（快速完成且结果正确）', () => {
    // 防复发（CodeQL ReDoS）：原实现 `\s*\[\{workspace\}\]\s*` 在用户配置的
    // template 含大量空白且无 `[{workspace}]` 时灾难性回溯；split/join 无回溯。
    const spaces = ' '.repeat(100000)
    const template = `${spaces}{description}${spaces}`
    const start = Date.now()
    const result = formatTitle(template, '', '修复问题')
    expect(Date.now() - start).toBeLessThan(1000)
    expect(result).toBe('修复问题')
  })
})

describe('isStructuredTitle', () => {
  it('方括号前缀视为结构化', () => {
    expect(isStructuredTitle('[my-dsh-plugins] 修复 #143')).toBe(true)
    expect(isStructuredTitle('[abc]')).toBe(true)
  })

  it('无方括号前缀视为非结构化', () => {
    expect(isStructuredTitle('修复 #143 记忆页签崩溃')).toBe(false)
    expect(isStructuredTitle('请你帮我修改一下处理 iss...')).toBe(false)
  })

  it('空/非字符串返回 false', () => {
    expect(isStructuredTitle('')).toBe(false)
    expect(isStructuredTitle(undefined)).toBe(false)
    expect(isStructuredTitle(null)).toBe(false)
  })
})

describe('collectStreamText', () => {
  it('收集 text-delta 并返回 finish reason', async () => {
    const chunks = [
      { type: 'text-delta', index: 0, text: '修复 #143 ' },
      { type: 'text-delta', index: 0, text: '记忆页签崩溃' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await collectStreamText(chunks)
    expect(result.text).toBe('修复 #143 记忆页签崩溃')
    expect(result.finish).toBe('stop')
  })

  it('finish 为 error 时返回 error 标记', async () => {
    const chunks = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'X' } } }]
    const result = await collectStreamText(chunks)
    expect(result.finish).toBe('error')
  })

  it('无 text-delta 时文本为空', async () => {
    const result = await collectStreamText([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(result.text).toBe('')
    expect(result.finish).toBe('stop')
  })

  it('忽略 reasoning-delta 与 usage chunk', async () => {
    const chunks = [
      { type: 'reasoning-delta', index: 0, text: '思考过程' },
      { type: 'text-delta', index: 0, text: '标题' },
      { type: 'usage', usage: { input: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await collectStreamText(chunks)
    expect(result.text).toBe('标题')
  })
})

describe('generateTitle', () => {
  function mockCtx(streamImpl) {
    return { llm: { stream: streamImpl } }
  }

  function streamOf(chunks) {
    return async function* stream() {
      for (const chunk of chunks) yield chunk
    }
  }

  const baseOptions = {
    session: { id: 's-1' },
    workspace: 'my-dsh-plugins',
    messages: [{ seq: 0, text: '修复 #143 记忆页签崩溃' }],
    route: { provider: 'deepseek', model: 'deepseek-chat' },
    config: { template: '[{workspace}] {description}', maxTitleBytes: 80, maxOutputTokens: 64 },
  }

  it('LLM 输出描述后返回格式化标题', async () => {
    const ctx = mockCtx(
      streamOf([
        { type: 'text-delta', index: 0, text: '修复 #143 记忆页签崩溃' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    )
    const result = await generateTitle(ctx, baseOptions)
    expect(result.title).toBe('[my-dsh-plugins] 修复 #143 记忆页签崩溃')
    expect(result.model).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('LLM 输出含换行与多余空白时规范化', async () => {
    const ctx = mockCtx(
      streamOf([
        { type: 'text-delta', index: 0, text: '  修复  #143 \n 记忆页签崩溃  ' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    )
    const result = await generateTitle(ctx, baseOptions)
    expect(result.title).toBe('[my-dsh-plugins] 修复 #143 记忆页签崩溃')
  })

  it('LLM 输出为空时抛错', async () => {
    const ctx = mockCtx(streamOf([{ type: 'finish', reason: { kind: 'stop' } }]))
    await expect(generateTitle(ctx, baseOptions)).rejects.toThrow(/empty/i)
  })

  it('finish 为 error 时抛错', async () => {
    const ctx = mockCtx(
      streamOf([{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'X' } } }]),
    )
    await expect(generateTitle(ctx, baseOptions)).rejects.toThrow(/boom/)
  })

  it('llm.stream 抛错时向上传播', async () => {
    const ctx = mockCtx(() => {
      throw new Error('llm unavailable')
    })
    await expect(generateTitle(ctx, baseOptions)).rejects.toThrow(/llm unavailable/)
  })

  it('标题超过 maxTitleBytes 时截断', async () => {
    const long = '很长的描述'.repeat(30)
    const ctx = mockCtx(
      streamOf([
        { type: 'text-delta', index: 0, text: long },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    )
    const result = await generateTitle(ctx, { ...baseOptions, config: { ...baseOptions.config, maxTitleBytes: 40 } })
    expect(Buffer.byteLength(result.title, 'utf8')).toBeLessThanOrEqual(40)
  })

  it('无 route 时使用配置的 provider/model', async () => {
    const ctx = mockCtx(
      streamOf([
        { type: 'text-delta', index: 0, text: '修复问题' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    )
    const result = await generateTitle(ctx, {
      ...baseOptions,
      route: undefined,
      config: { ...baseOptions.config, provider: 'p', model: 'm' },
    })
    expect(result.model).toEqual({ provider: 'p', model: 'm' })
  })
})

describe('foldTitle', () => {
  it('返回最后一个 session/title 事件数据', () => {
    const session = {
      events: [
        { type: 'user/message', seq: 0, data: {} },
        { type: 'session/title', seq: 1, data: { title: '旧标题', source: { kind: 'fallback' } } },
        { type: 'session/title', seq: 2, data: { title: '新标题', source: { kind: 'provider', provider: 'x' } } },
      ],
    }
    expect(foldTitle(session).title).toBe('新标题')
  })

  it('无 session/title 事件返回 undefined', () => {
    expect(foldTitle({ events: [{ type: 'user/message', seq: 0, data: {} }] })).toBeUndefined()
    expect(foldTitle({ events: [] })).toBeUndefined()
    expect(foldTitle({})).toBeUndefined()
  })
})
