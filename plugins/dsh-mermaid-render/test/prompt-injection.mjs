/**
 * dsh-mermaid-render — 系统提示词注入测试（issue #194）。
 *
 * 需求：安装即默认向系统提示词注入一段「本环境原生支持 mermaid 渲染」的能力说明，
 * 让模型在用户**没有**说出 "mermaid" 字样时也主动输出 \`\`\`mermaid 代码块。
 *
 * 本文件钉住四条底线：
 *  1. 注入文本包含关键引导行（原生支持 + 围栏语言标识 + 图类型清单 + 常见易错写法 +
 *     渲染失败兜底描述）；
 *  2. 注入文本有明确长度上限（不吃上下文预算）；
 *  3. 开关默认开、显式 false 关闭（非布尔值按默认开，fail-safe）；
 *  4. apply() 注册且只注册一条 section，关闭时不注册，缺服务/缺 logger 不抛错。
 *
 * 断言对象是构建产物 lib/prompt.js / lib/index.js（CI 只跑产物，不跑构建）。
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../lib/index.js'
import {
  PROMPT_MAX_CHARS,
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  PROMPT_TEXT,
  createPromptSection,
  shouldInjectPrompt,
} from '../lib/prompt.js'

/** 挂载插件并捕获 section 注册与日志（与 host-smoke.mjs 同风格的 mock ctx）。 */
function boot(config) {
  const sections = []
  const logs = []
  const ctx = {
    systemPrompt: {
      section(options) {
        sections.push(options)
        return () => {}
      },
    },
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
  }
  apply(ctx, config)
  return { sections, logs }
}

/** 其它插件在用的 section 名（issue #194 要求不干扰/不撞名）。 */
const FOREIGN_SECTION_NAMES = ['dsh-think-zh', 'dsh-my-memory', 'harness:identity', 'deployment:persona-prefix']

describe('注入文本内容（issue #194）', () => {
  it('说明当前环境原生支持 mermaid 渲染，并给出 ```mermaid 围栏写法', () => {
    expect(PROMPT_TEXT).toContain('原生支持')
    expect(PROMPT_TEXT).toContain('```mermaid')
  })

  it('覆盖 7 类图表关键字，模型知道什么时候用', () => {
    for (const kind of [
      'flowchart',
      'sequenceDiagram',
      'stateDiagram-v2',
      'classDiagram',
      'erDiagram',
      'gantt',
      'pie',
    ]) {
      expect(PROMPT_TEXT, '缺少图类型: ' + kind).toContain(kind)
    }
  })

  it('包含常见易错写法的引导（特殊字符加引号 / 不嵌套 markdown）', () => {
    expect(PROMPT_TEXT).toContain('引号')
    expect(PROMPT_TEXT).toContain('嵌套')
  })

  it('描述渲染失败的兜底行为（原样显示代码块 + 错误提示，可修正重试）', () => {
    expect(PROMPT_TEXT).toContain('原样显示')
    expect(PROMPT_TEXT).toContain('错误提示')
  })

  it('不含 {{变量}} 占位（宿主渲染器对变量引用是严格的，写了会直接抛错）', () => {
    expect(PROMPT_TEXT).not.toContain('{{')
    expect(PROMPT_TEXT).not.toContain('}}')
  })
})

describe('注入文本长度上限（issue #194）', () => {
  it('不超过 PROMPT_MAX_CHARS', () => {
    expect(PROMPT_TEXT.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS)
  })

  it('上限本身保持「简短」量级（≤ 800 字符，防上限被悄悄调大）', () => {
    expect(PROMPT_MAX_CHARS).toBeLessThanOrEqual(800)
  })

  it('文本非空且确实被用上（上限不是摆设）', () => {
    expect(PROMPT_TEXT.length).toBeGreaterThan(0)
    expect(PROMPT_MAX_CHARS).toBeGreaterThan(0)
  })
})

describe('开关（issue #194：默认开，可关）', () => {
  it('未配置 / 空配置 / 显式 true：注入', () => {
    expect(shouldInjectPrompt(undefined)).toBe(true)
    expect(shouldInjectPrompt({})).toBe(true)
    expect(shouldInjectPrompt({ injectPrompt: true })).toBe(true)
    expect(createPromptSection(undefined)).not.toBeNull()
    expect(createPromptSection({ injectPrompt: true })).not.toBeNull()
  })

  it('显式 false：不注入', () => {
    expect(shouldInjectPrompt({ injectPrompt: false })).toBe(false)
    expect(createPromptSection({ injectPrompt: false })).toBeNull()
  })

  it('非法值（字符串/数字/null）按默认开处理，不静默关掉能力', () => {
    for (const bad of ['false', 0, null]) {
      expect(shouldInjectPrompt({ injectPrompt: bad })).toBe(true)
    }
  })
})

describe('section 注册契约（issue #194）', () => {
  it('名称唯一且不与其它插件/宿主 section 撞名', () => {
    expect(PROMPT_SECTION_NAME).toBe('dsh-mermaid-render')
    for (const foreign of FOREIGN_SECTION_NAMES) expect(PROMPT_SECTION_NAME).not.toBe(foreign)
  })

  it('order 是有限数字，且排在部署 persona（0）之后（不覆盖用户自定义提示词）', () => {
    expect(Number.isFinite(PROMPT_SECTION_ORDER)).toBe(true)
    expect(PROMPT_SECTION_ORDER).toBeGreaterThan(0)
  })

  it('createPromptSection 返回 {name, order, text}', () => {
    expect(createPromptSection(undefined)).toEqual({
      name: PROMPT_SECTION_NAME,
      order: PROMPT_SECTION_ORDER,
      text: PROMPT_TEXT,
    })
  })
})

describe('apply() 注入行为（issue #194）', () => {
  it('默认挂载：恰好注册一条 section，内容即注入文本（渲染端插件不注册即无效）', () => {
    const { sections } = boot(undefined)
    expect(sections).toHaveLength(1)
    expect(sections[0].name).toBe(PROMPT_SECTION_NAME)
    expect(sections[0].order).toBe(PROMPT_SECTION_ORDER)
    expect(sections[0].text).toBe(PROMPT_TEXT)
  })

  it('开关关闭：不注册任何 section，但仍挂载（client 渲染不受影响）', () => {
    const { sections, logs } = boot({ injectPrompt: false })
    expect(sections).toHaveLength(0)
    expect(logs[0]).toContain('[dsh-mermaid-render]')
    expect(logs[0]).toContain('已挂载')
  })

  it('开关打开时的日志也带统一前缀与挂载语义（issue #155 日志体系）', () => {
    const { logs } = boot(undefined)
    expect(logs[0]).toContain('[dsh-mermaid-render]')
    expect(logs[0]).toContain('已挂载')
  })

  it('缺 systemPrompt 服务时不抛错（guard 降级，client 端照常渲染）', () => {
    expect(() => apply({}, undefined)).not.toThrow()
    expect(() => apply({ logger: { info: () => {} } }, undefined)).not.toThrow()
  })

  it('缺 logger 时不抛错（可选链）', () => {
    const sections = []
    expect(() => apply({ systemPrompt: { section: (o) => sections.push(o) } }, undefined)).not.toThrow()
    expect(sections).toHaveLength(1)
  })
})
