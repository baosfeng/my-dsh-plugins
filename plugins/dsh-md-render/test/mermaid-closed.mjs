/**
 * mermaid「围栏闭合即渲染」门禁（task-5）。
 *
 * 判据：
 *  a) 事件流围栏已闭合 + 消息仍在流式（[data-streaming]）→ 立即挂卡片；
 *  b) 事件流明确未闭合 + 流式中 → 不挂卡片（也不排 400ms 窗口）；
 *  c) 事件流不可用 → 退回原有 400ms 稳定窗口（行为与今天一致）；
 *  d) 闭合后内容再变 → 自愈卸载并按窗口重挂。
 *
 * 事件流形态：assistant/live-chunk 的 text-delta（宿主 StreamChunk），
 * 见 packages/llm/llm/src/types.ts:472；拼接后由 lang-source 解析围栏闭合位。
 */
import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeElement,
} from './support/fake-dom.mjs'

const MERMAID_SOURCE = ['flowchart TD', '  A["提交订单 (v2)"] --> B[校验]', '  B --> C[完成]'].join('\n')

function setup() {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const page = installGlobals(createPage(scroll))
  const rendered = []
  page.window.mermaid = {
    initialize() {},
    render(id, source) {
      rendered.push({ id, source })
      return Promise.resolve({ svg: '<svg data-mermaid="' + id + '"></svg>' })
    },
  }
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, scroll, rendered }
}

/** 造一个流式中的 mermaid 块（DOM 语言只用于 c 分支的旧判据）。 */
function makeStreamingBlock(source = MERMAID_SOURCE, lang = 'mermaid') {
  const wrap = makeElement('div', { 'data-streaming': 'true' })
  const block = makeCodeBlock({ lang, code: source, fiber: false })
  block.querySelector('code').className = 'language-' + lang
  wrap.appendChild(block)
  return { wrap, block }
}

/** 一条 assistant/live-chunk 事件（text-delta）。 */
function liveEvent(seq, text, entryType = 'transient') {
  return {
    type: entryType,
    event: {
      type: 'assistant/live-chunk',
      seq,
      data: { attemptId: 'attempt-1', turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } },
    },
  }
}

/** 假 ctx：sessions → 主视图会话 → eventSource 快照。 */
function ctxWith(entries) {
  const source = {
    getSnapshot: () => ({ revision: entries.length, entries }),
    subscribe: () => () => {},
  }
  return {
    get: (name) =>
      name === 'sessions'
        ? {
            list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) },
            binding: () => ({ eventSource: source }),
          }
        : undefined,
    effect: (fn) => fn(),
  }
}

test('a) 事件流围栏已闭合 + 仍在流式 → 立即渲染（transient live-chunk 条目）', () => {
  const { loaded, scroll } = setup()
  const { wrap, block } = makeStreamingBlock()
  scroll.appendChild(wrap)
  loaded.exports.refreshFenceLangIndex(ctxWith([liveEvent(1, '```mermaid\n' + MERMAID_SOURCE + '\n```')]))
  assert.equal(loaded.exports.fenceLangOf(block), 'mermaid', '事件流语言命中')
  assert.equal(loaded.exports.fenceTrustOf(block)?.closed, true, '事件流闭合位命中')
  loaded.exports.considerMermaidBlock(block, 1)
  const host = block.querySelector('div.mdr-mm-host')
  assert.ok(host, '闭合即挂卡片')
  assert.equal(host.getAttribute('data-dsh-md-render-mermaid-state'), 'loading')
  assert.ok(host.querySelector('.mdr-mm-card'), '卡片组件已渲染')
})

test('b) 事件流明确未闭合 + 流式中 → 不渲染（也不排窗口）', () => {
  const { loaded, scroll } = setup()
  const { wrap, block } = makeStreamingBlock()
  scroll.appendChild(wrap)
  loaded.exports.refreshFenceLangIndex(ctxWith([liveEvent(1, '```mermaid\n' + MERMAID_SOURCE + '\n')]))
  loaded.exports.considerMermaidBlock(block, 1)
  assert.equal(block.querySelector('div.mdr-mm-host'), null, '未闭合不挂卡片')
})

test('c) 事件流不可用 + 无 DOM 语言 → 内容启发式 + 400ms 窗口兜底', () => {
  vi.useFakeTimers()
  try {
    const { loaded, scroll } = setup()
    const { wrap, block } = makeStreamingBlock(MERMAID_SOURCE, '代码块')
    scroll.appendChild(wrap)
    loaded.exports.considerMermaidBlock(block, 1)
    assert.equal(block.querySelector('div.mdr-mm-host'), null, '窗口未到期不渲染')
    vi.advanceTimersByTime(450)
    assert.ok(block.querySelector('div.mdr-mm-host'), '窗口到期后按内容启发式渲染')
  } finally {
    vi.useRealTimers()
  }
})

test('c2) 非图表内容不被启发式误判（无 DOM 语言、事件流不可用 → 不渲染）', () => {
  vi.useFakeTimers()
  try {
    const { loaded, scroll } = setup()
    const { wrap, block } = makeStreamingBlock('const answer = 42\nconsole.log(answer)', '代码块')
    scroll.appendChild(wrap)
    loaded.exports.considerMermaidBlock(block, 1)
    vi.advanceTimersByTime(600)
    assert.equal(block.querySelector('div.mdr-mm-host'), null, '普通代码不接管')
  } finally {
    vi.useRealTimers()
  }
})

test('d) 闭合后内容再变 → 卸载重挂（自愈保留）', () => {
  vi.useFakeTimers()
  try {
    const { loaded, scroll } = setup()
    const { wrap, block } = makeStreamingBlock()
    scroll.appendChild(wrap)
    loaded.exports.refreshFenceLangIndex(ctxWith([liveEvent(1, '```mermaid\n' + MERMAID_SOURCE + '\n```')]))
    loaded.exports.considerMermaidBlock(block, 1)
    assert.ok(block.querySelector('div.mdr-mm-host'), '首次闭合已挂载')

    block.querySelector('code').textContent = MERMAID_SOURCE + '\n  C --> D[新增节点]'
    loaded.exports.considerMermaidBlock(block, 2)
    assert.equal(block.querySelector('div.mdr-mm-host'), null, '内容变了先自愈卸载')

    vi.advanceTimersByTime(450)
    assert.ok(block.querySelector('div.mdr-mm-host'), '退回窗口后按新内容重挂')
  } finally {
    vi.useRealTimers()
  }
})
