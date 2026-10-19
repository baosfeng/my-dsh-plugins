/**
 * 代码块「换行切换」（wrap / unwrap）—— 官方 CodeToolbar 有、自研渲染器一度漏掉的能力。
 *
 * 判据（产物 lib/client.js + 假 DOM）：
 *  · 工具栏里**复制之前**有一个 `dsh-md-render-code-wrap-btn` 按钮；
 *  · 默认**不换行**：pre 只有原有的 `dsh-md-render-code-pre`（默认视觉行为与现状一致）；
 *  · 点一下 → pre **追加** `dsh-md-render-code-wrap`（原类名保留），再点一下切回；
 *  · `aria-pressed` / `aria-label` / `title` 随状态在 true|false、「自动换行」「取消换行」间翻转；
 *  · 多个代码块各自独立（点 A 不影响 B）。
 *
 * 假 DOM 的 react 桩默认把 setState 当空操作（断言不到重渲染后的 DOM），
 * 因此本文件自带「带状态槽 + 点完重渲染」的 react / react-dom 桩（React hook 语义最小实现）。
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

const CODE_HOST = 'div.dsh-md-render-code-host'
const CODE_ACTIONS = 'div.dsh-md-render-code-actions'
const CODE_WRAP_BTN = 'button.dsh-md-render-code-wrap-btn'
const CODE_COPY = 'button.dsh-md-render-code-copy'
const CODE_LINES_BTN = 'button.dsh-md-render-code-lines-btn'
const CODE_NUMS = 'div.dsh-md-render-code-nums'
const CODE_PRE = 'pre.dsh-md-render-code-pre'
const PRE_PLAIN = 'dsh-md-render-code-pre'
const PRE_WRAP = 'dsh-md-render-code-pre dsh-md-render-code-wrap'

/** 带状态槽的 react 桩 + 会按状态重渲染的 react-dom 桩（每个 root 一份 hook 槽）。 */
function createStatefulStack(page) {
  const roots = []
  let hooks = []
  let hookIndex = 0
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.flat() },
  })
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

/** 装配一页（单 MutationObserver 扫描器）+ 应用插件。 */
function boot(blocks) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  for (const block of blocks) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const stack = createStatefulStack(page)
  const loaded = loadBundle({ page, react: stack.react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, scroll }
}

test('工具栏：行号 / 换行 / 复制顺序固定，默认态 = 不换行且不显示行号 / aria-pressed=false', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  boot([block])
  const host = block.querySelector(CODE_HOST)
  const actions = host.querySelector(CODE_ACTIONS)
  assert.ok(actions, '操作区就位')
  assert.equal(actions.children.length, 3, '操作区三个按钮（行号 + 换行 + 复制）')
  assert.equal(actions.children[0].getAttribute('class'), 'dsh-md-render-code-lines-btn', '行号按钮在最前')
  assert.equal(actions.children[1].getAttribute('class'), 'dsh-md-render-code-wrap-btn', '换行按钮在复制之前')
  assert.equal(actions.children[2].getAttribute('class'), 'dsh-md-render-code-copy', '复制按钮在后')
  const btn = host.querySelector(CODE_WRAP_BTN)
  assert.equal(btn.getAttribute('data-dsh-md-render-tip'), '自动换行', '默认浮层文案')
  assert.equal(btn.textContent, '', '只显示图标，不常显文字')
  assert.equal(btn.getAttribute('aria-pressed'), 'false', '默认未换行（与现状一致）')
  assert.equal(btn.getAttribute('aria-label'), '自动换行', '可访问名 = 当前动作')
  assert.equal(btn.getAttribute('title'), null, '不写原生 title（自绘浮层是唯一的鼠标提示）')
  assert.equal(
    host.querySelector('pre').getAttribute('class'),
    PRE_PLAIN,
    '默认 pre 只有原有类名（不改变默认视觉行为）',
  )
  assert.ok(host.querySelector(CODE_COPY), '复制按钮照旧在')
})

test('点击换行按钮：pre 追加换行类名、状态文案与 aria-pressed 翻转，再点切回', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  boot([block])
  const host = block.querySelector(CODE_HOST)

  host.querySelector(CODE_WRAP_BTN).fire('click')
  assert.equal(
    host.querySelector('pre').getAttribute('class'),
    PRE_WRAP,
    '换行态：追加 dsh-md-render-code-wrap，原类名保留',
  )
  const on = host.querySelector(CODE_WRAP_BTN)
  assert.equal(on.getAttribute('data-dsh-md-render-tip'), '取消换行', '浮层文案翻到「取消换行」')
  assert.equal(on.getAttribute('aria-pressed'), 'true', 'aria-pressed 翻转')
  assert.equal(on.getAttribute('aria-label'), '取消换行', '可访问名同步')
  assert.equal(on.getAttribute('title'), null, '不写原生 title')
  assert.equal(host.querySelector('pre').textContent, 'const a = 1', '换行后内容一字不少')

  on.fire('click')
  assert.equal(host.querySelector('pre').getAttribute('class'), PRE_PLAIN, '再点切回不换行')
  const off = host.querySelector(CODE_WRAP_BTN)
  assert.equal(off.getAttribute('aria-pressed'), 'false', 'aria-pressed 回到 false')
  assert.equal(off.getAttribute('data-dsh-md-render-tip'), '自动换行', '浮层文案回到「自动换行」')
})

test('新按钮的文案不会被收进「整段复制」（复制的是内容，不是 chrome）', async () => {
  const written = []
  // Node ≥22 的 navigator 是只读 getter：用 defineProperty 覆盖（与本插件既有复制测试同款）。
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText: (text) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    },
  })
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: '说明：\n\n```js\nconst a = 1\n```' }), page.document)
  dom.querySelector('button.dsh-md-render-copy').fire('click')
  await Promise.resolve()
  assert.equal(written.length, 1, '复制调用一次')
  assert.ok(written[0].includes('const a = 1'), '代码内容在复制文本里')
  assert.equal(written[0].includes('自动换行'), false, '换行按钮文案不算内容（代码卡片头部整块被跳过）')
  assert.equal(written[0].includes('复制'), false, '复制按钮文案不算内容')
})

test('多块代码：换行态各自独立（点 A 不影响 B）', () => {
  const first = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const second = makeCodeBlock({ lang: 'python', code: 'print(1)' })
  boot([first, second])
  first.querySelector(CODE_WRAP_BTN).fire('click')
  // 注意：pre 必须从自有 code-host 里取（块级 querySelector('pre') 会先命中官方那个 pre.plain）。
  assert.equal(first.querySelector(CODE_HOST).querySelector('pre').getAttribute('class'), PRE_WRAP, 'A 换行')
  assert.equal(second.querySelector(CODE_HOST).querySelector('pre').getAttribute('class'), PRE_PLAIN, 'B 仍是不换行')
  assert.equal(second.querySelector(CODE_WRAP_BTN).getAttribute('aria-pressed'), 'false', 'B 的按钮态不受影响')
})
test('行号切换：默认不渲染行号列，打开后按逻辑行编号出现，换行态自动让位', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1\nconst b = 2\nconst c = 3' })
  boot([block])
  const host = block.querySelector(CODE_HOST)
  const btn = host.querySelector(CODE_LINES_BTN)
  assert.ok(btn, '行号按钮就位')
  assert.equal(btn.getAttribute('aria-pressed'), 'false', '默认关闭行号')
  assert.equal(btn.textContent, '', '只显示图标，不常显文字')
  assert.equal(host.querySelector(CODE_NUMS), null, '默认不渲染行号列（不改变默认视觉行为）')

  btn.fire('click')
  const nums = host.querySelector(CODE_NUMS)
  assert.ok(nums, '打开后出现行号列')
  assert.equal(nums.textContent, '1\n2\n3', '行号按逻辑行逐行编号')
  assert.equal(nums.getAttribute('aria-hidden'), 'true', '行号列不进无障碍树（纯呈现）')
  const on = host.querySelector(CODE_LINES_BTN)
  assert.equal(on.getAttribute('aria-pressed'), 'true', '状态同步到 aria-pressed')
  assert.equal(on.getAttribute('aria-label'), '隐藏行号', '可访问名 = 当前动作')

  // 打开换行 → 逻辑行会占多行物理行，行号列必然错位，所以让位（按钮意图保留）
  host.querySelector(CODE_WRAP_BTN).fire('click')
  assert.equal(host.querySelector(CODE_NUMS), null, '换行态隐藏行号列')
  assert.ok(host.querySelector(CODE_PRE).className.includes('dsh-md-render-code-wrap'), '换行确实开启')

  // 再点行号：先收起换行，再出现行号列（避免「按了没反应」）
  host.querySelector(CODE_LINES_BTN).fire('click')
  assert.equal(host.querySelector(CODE_NUMS), null, '这一次是关闭行号（状态仍为开 → 关）')
  host.querySelector(CODE_LINES_BTN).fire('click')
  assert.ok(host.querySelector(CODE_NUMS), '重新打开行号列')
  assert.equal(host.querySelector(CODE_PRE).className, PRE_PLAIN, '打开行号时自动收起换行')
})
