/**
 * 代码块「换行 / 行号切换」（重构 v2）—— 官方 CodeToolbar 有、自研渲染器必须保留的能力。
 *
 * 判据（产物 lib/client.js + 假 DOM）：
 *  · 工具栏操作区三个按钮：复制 / 换行 / 行号；默认 data-mdr-wrap="off"、data-mdr-lines="off"；
 *  · 状态由卡片根节点属性驱动（CSS 据此换行 / 显示行号列），**不写 el.style / classList**；
 *  · aria-pressed / data-mdr-tip 随状态翻转；多个代码块各自独立；
 *  · 新按钮文案不会被收进「整段复制」。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createPage,
  createReactStub,
  createRenderStack,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeElement,
  vdomToDom,
} from './support/fake-dom.mjs'

const CODE_HOST = 'div.mdr-block'
const CODE_CARD = 'div.mdr-fence'
const CODE_ACTIONS = '.mdr-fence-actions'
const CODE_WRAP_BTN = 'button[aria-label="切换自动换行"],button[aria-label="关闭自动换行"]'
const CODE_LINES_BTN = 'button[aria-label="切换行号"],button[aria-label="隐藏行号"]'
const CODE_NUMS = 'div.mdr-line-nums'
const CODE_PRE = 'pre.mdr-fence-code'

/** 带状态槽的 react 桩 + 会按状态重渲染的 react-dom 桩（每个 root 一份 hook 槽）。 */
function createStatefulStack(page) {
  const roots = []
  let hooks = []
  let hookIndex = 0
  const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.flat() } })
  const paint = (root) => {
    hooks = root.hooks
    hookIndex = 0
    root.container.textContent = ''
    const dom = vdomToDom(root.node, page.document)
    if (dom) root.container.appendChild(dom)
    hooks = []
  }
  const react = {
    createElement,
    useState(initial) {
      const i = hookIndex
      hookIndex += 1
      const store = hooks
      if (store[i] === undefined) store[i] = typeof initial === 'function' ? initial() : initial
      const set = (value) => {
        store[i] = typeof value === 'function' ? value(store[i]) : value
        for (const root of roots) paint(root)
      }
      return [store[i], set]
    },
    useEffect() {
      hookIndex += 1
    },
  }
  const createRoot = (container) => {
    const root = { container, node: null, hooks: [] }
    roots.push(root)
    return {
      render(node) {
        root.node = node
        paint(root)
      },
      unmount() {
        container.textContent = ''
      },
    }
  }
  return { react, reactDom: { createRoot } }
}

function boot(blocks) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  for (const block of blocks) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const stack = createStatefulStack(page)
  const loaded = loadBundle({ page, react: stack.react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, scroll }
}

test('工具栏：复制 / 换行 / 行号三按钮就位，默认态 = 不换行、不显示行号', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  boot([block])
  const host = block.querySelector(CODE_HOST)
  const actions = host.querySelector(CODE_ACTIONS)
  assert.ok(actions, '操作区就位')
  assert.equal(actions.children.length, 3, '操作区三个按钮')
  assert.ok(String(actions.children[0].getAttribute('class')).includes('mdr-fence-copy'), '复制按钮在最前')
  const card = host.querySelector(CODE_CARD)
  assert.equal(card.getAttribute('data-mdr-wrap'), 'off', '默认不换行')
  assert.equal(card.getAttribute('data-mdr-lines'), 'off', '默认不显示行号')
  const wrap = host.querySelector(CODE_WRAP_BTN)
  assert.equal(wrap.getAttribute('data-mdr-tip'), '切换自动换行', '换行按钮默认文案')
  assert.equal(wrap.getAttribute('aria-pressed'), 'false', '默认未换行')
  const lines = host.querySelector(CODE_LINES_BTN)
  assert.equal(lines.getAttribute('data-mdr-tip'), '切换行号', '行号按钮默认文案')
  assert.equal(lines.getAttribute('aria-pressed'), 'false', '默认未开行号')
  assert.equal(host.querySelector('pre').getAttribute('class'), 'mdr-fence-code', '默认 pre 类名不变')
  assert.ok(host.querySelector(CODE_NUMS), '行号列已渲染（由 CSS 按 data-mdr-lines 隐藏）')
})

test('点击换行：卡片属性翻转、aria-pressed 同步，再点切回', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  boot([block])
  const host = block.querySelector(CODE_HOST)
  const card = () => host.querySelector(CODE_CARD)
  host.querySelector(CODE_WRAP_BTN).fire('click')
  assert.equal(card().getAttribute('data-mdr-wrap'), 'on', '换行态由卡片属性驱动')
  const on = host.querySelector(CODE_WRAP_BTN)
  assert.equal(on.getAttribute('data-mdr-tip'), '关闭自动换行', '浮层文案翻到关闭')
  assert.equal(on.getAttribute('aria-pressed'), 'true', 'aria-pressed 翻转')
  assert.equal(host.querySelector(CODE_PRE).textContent, 'const a = 1', '换行后内容一字不少')
  on.fire('click')
  assert.equal(card().getAttribute('data-mdr-wrap'), 'off', '再点切回不换行')
  assert.equal(host.querySelector(CODE_WRAP_BTN).getAttribute('aria-pressed'), 'false', 'aria-pressed 回到 false')
})

test('行号切换：属性翻转 + 行号列文本按逻辑行编号', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1\nconst b = 2\nconst c = 3' })
  boot([block])
  const host = block.querySelector(CODE_HOST)
  const btn = host.querySelector(CODE_LINES_BTN)
  btn.fire('click')
  assert.equal(host.querySelector(CODE_CARD).getAttribute('data-mdr-lines'), 'on', '行号态由卡片属性驱动')
  const nums = host.querySelector(CODE_NUMS)
  assert.equal(nums.textContent, '1\n2\n3', '行号按逻辑行逐行编号')
  assert.equal(nums.getAttribute('aria-hidden'), 'true', '行号列不进无障碍树')
  const on = host.querySelector(CODE_LINES_BTN)
  assert.equal(on.getAttribute('aria-pressed'), 'true', 'aria-pressed 同步')
  assert.equal(on.getAttribute('data-mdr-tip'), '隐藏行号', '可访问名 = 当前动作')
  on.fire('click')
  assert.equal(host.querySelector(CODE_CARD).getAttribute('data-mdr-lines'), 'off', '再点关闭行号')
})

test('新按钮的文案不会被收进「整段复制」（复制的是内容，不是 chrome）', async () => {
  const written = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { clipboard: { writeText: (text) => (written.push(text), Promise.resolve()) } },
  })
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: '说明：\n\n```js\nconst a = 1\n```' }), page.document)
  dom.querySelector('button.mdr-copy').fire('click')
  await Promise.resolve()
  assert.equal(written.length, 1, '复制调用一次')
  assert.ok(written[0].includes('const a = 1'), '代码内容在复制文本里')
  assert.equal(written[0].includes('自动换行'), false, '换行按钮文案不算内容')
  assert.equal(written[0].includes('复制'), false, '复制按钮文案不算内容')
})

test('多块代码：换行态各自独立（点 A 不影响 B）', () => {
  const first = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const second = makeCodeBlock({ lang: 'python', code: 'print(1)' })
  boot([first, second])
  first.querySelector(CODE_WRAP_BTN).fire('click')
  assert.equal(first.querySelector(CODE_CARD).getAttribute('data-mdr-wrap'), 'on', 'A 换行')
  assert.equal(second.querySelector(CODE_CARD).getAttribute('data-mdr-wrap'), 'off', 'B 仍不换行')
  assert.equal(second.querySelector(CODE_WRAP_BTN).getAttribute('aria-pressed'), 'false', 'B 的按钮态不受影响')
})
