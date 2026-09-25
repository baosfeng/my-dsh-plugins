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

  it('大量空格的 template 不触发 ReDoS：退化输入与同规模对照的耗时同数量级（相对判据）', () => {
    // 防复发（CodeQL ReDoS）：原实现 `\s*\[\{workspace\}\]\s*` 在用户配置的 template
    // 含大段空白且无 `[{workspace}]` 时灾难性回溯（O(n²)）；现实现 split/join + /\s+/g
    // 无回溯。本用例的输入就是那类退化形态。
    //
    // 判据演进（为什么既不是绝对阈值，也不是「10 倍输入耗时比」）：
    //  1) 绝对墙钟阈值（原 <1000ms）测的是机器快慢，负载高必假红 → issue #353 已废；
    //  2) 「10 倍输入的耗时比 < 30」的分子分母**规模不同**（0.2ms vs 2.2ms），负载/GC 抖动
    //     只砸在大输入一侧：实测 min-of-5 仍出现 52.2 的比值（阈值 30 被击穿，1/12 轮），
    //     因为信号（线性 ≈10 vs 二次 ≈100）只留 3 倍余量 —— 这是本用例 flaky 的根因；
    //  3) 本判据把**同规模的安全形态**当基线：退化形态（大段空白、无占位符）与对照形态
    //     （等长、无空白）交错各测 K 次取**最小值**。min 是「无争用成本」的下界估计——
    //     调度抖动只能抬高单次测量，取 min 就把负载噪声滤掉，且同规模下负载对分子分母
    //     同向作用。线性实现两者成本同数量级（实测 0.79~0.93，负载 16 仍稳定）；
    //     二次实现退化形态是对照的 O(n) 倍（n=2 万时实测比值 ≈2×10^4）——余量 ≥20 倍。
    //  4) 兜底（负载无关）：O(n²) 实现在 n=100 万退化模板上需 ~10^12 步，不可能在线性实现
    //     的 2.5ms 与框架停机保护之间返回，故最后一条行为断言对超线性实现必然超时红灯。
    const N = 20_000
    const K = 5
    const degraded = `${' '.repeat(N)}{description}${' '.repeat(N)}`
    const baseline = `${'x'.repeat(N)}{description}${'x'.repeat(N)}`
    /** 交错测 K 次取最小值：无争用成本的下界估计。 */
    const minCost = (template) => {
      let best = Infinity
      for (let i = 0; i < K; i++) {
        const start = performance.now()
        formatTitle(template, '', '修复问题')
        best = Math.min(best, performance.now() - start)
      }
      return best
    }

    // 行为判据（确定性）：退化/对照形态都返回正确结果
    expect(formatTitle(degraded, '', '修复问题')).toBe('修复问题')
    expect(formatTitle(baseline, '', '修复问题')).toBe(`${'x'.repeat(N)}修复问题${'x'.repeat(N)}`)
    // 复杂度判据（相对基线比值，阈值 20 ≫ 线性实测 ~0.9，≪ 二次实测 ~2.5×10^4）
    expect(minCost(degraded) / Math.max(minCost(baseline), 0.01)).toBeLessThan(20)
    // 兜底：退化的 100 万字符模板必须在停机保护内返回（超线性实现必然超时）
    expect(formatTitle(`${' '.repeat(1_000_000)}{description}${' '.repeat(1_000_000)}`, '', '修复问题')).toBe(
      '修复问题',
    )
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
