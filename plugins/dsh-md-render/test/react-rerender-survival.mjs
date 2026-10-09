/**
 * React 重渲染存活（issue #463 收尾的第 6 类防回归）。
 *
 * 宿主对话正文由 React 管理：流式补写、会话切换、虚拟列表回收都会**重建 DOM 节点**，
 * 而本插件的渲染容器是我们插进去的（React 不认识它）。两条必须成立的行为：
 *   ① React 把块整个换掉 → MutationObserver 兜底重扫在**新节点**上重建容器，
 *      且同一时刻只有一个容器（不重复挂载、不残留已卸载的 React root）；
 *   ② 块节点还在、内容被 React 改写 → 按签名重建（旧容器卸载、新容器就位），
 *      未变时原容器复用（幂等，不抖动）。
 *
 * 这里的「重渲染」用**真实的 DOM 变更 + MutationObserver 回调**模拟：
 * 替换节点、触发 observer（addedNodes + 兜底重扫选择器），与宿主真实行为同路径。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeContextPre,
  makeElement,
} from './support/fake-dom.mjs'

const TEXT_BODY = 'div.dsh-md-render-text-md'
const CONTEXT_BODY = 'div.dsh-md-render-context-md'

/** 装配一页 + 应用插件；返回触发 observer 的辅助函数。 */
function setup() {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  const observer = page.observers[0]
  assert.ok(observer, '扫描器已装配')
  /** 模拟一次 React 提交：替换节点 + 触发 observer（addedNodes 与兜底重扫两条路径）。 */
  const commit = (...added) => observer.callback([{ addedNodes: added, type: 'childList' }])
  return { page, loaded, stack, scroll, commit, observer }
}

test('React 重建 text 围栏块 → 新节点上重建容器，同一时刻只有一个', () => {
  const { stack, scroll, commit } = setup()
  const first = makeCodeBlock({ lang: 'text', code: '## 第一版' })
  scroll.appendChild(first)
  commit(first)
  const firstBody = first.querySelector(TEXT_BODY)
  assert.ok(firstBody, '首次接管')
  assert.equal(stack.reactDom.unmounts.includes(firstBody), false, '首次的容器未被卸载')

  // React 重渲染：旧节点被换掉（React 移除 + 插入新节点），新节点内容相同
  scroll.removeChild(first)
  const second = makeCodeBlock({ lang: 'text', code: '## 第一版' })
  scroll.appendChild(second)
  commit(second)

  assert.ok(second.querySelector(TEXT_BODY), '新节点上重建了容器')
  assert.equal(second.querySelectorAll(TEXT_BODY).length, 1, '新节点只有一个容器')
  assert.equal(first.querySelectorAll(TEXT_BODY).length, 1, '旧节点（已脱离）不再被追加')
  assert.equal(scroll.querySelectorAll(TEXT_BODY).length, 1, '整页只有一个容器（不重复挂载）')
  assert.ok(stack.reactDom.unmounts.includes(firstBody), '旧容器的 React root 已卸载（不泄漏）')
})

test('React 重建上下文注入块 → 新 pre 上重建容器、旧容器卸载', () => {
  const { scroll, commit, stack } = setup()
  const row = makeElement('div')
  const firstPre = makeContextPre('## 上下文一')
  row.appendChild(firstPre)
  scroll.appendChild(row)
  commit(row)
  const firstBody = row.querySelector(CONTEXT_BODY)
  assert.ok(firstBody, '首次接管')
  assert.equal(firstPre.hidden, true, '原文 pre 被隐藏')

  // React 重渲染：整个 row 子树被替换
  const nextRow = makeElement('div')
  const nextPre = makeContextPre('## 上下文一')
  nextRow.appendChild(nextPre)
  scroll.removeChild(row)
  scroll.appendChild(nextRow)
  commit(nextRow)

  assert.ok(nextRow.querySelector(CONTEXT_BODY), '新 row 上重建容器')
  assert.equal(nextRow.querySelectorAll(CONTEXT_BODY).length, 1, '新 row 只有一个容器')
  assert.equal(nextPre.hidden, true, '新 pre 被隐藏')
  assert.ok(stack.reactDom.unmounts.includes(firstBody), '旧容器已卸载')
})

test('React 改写内容（节点复用）→ 按签名重建，不重复、不残留', () => {
  const { stack, scroll, commit } = setup()
  const block = makeCodeBlock({ lang: 'text', code: '## 旧内容' })
  scroll.appendChild(block)
  commit(block)
  const body = block.querySelector(TEXT_BODY)
  assert.equal(stack.markdown.calls.filter((c) => c.text === '## 旧内容').length, 1, '旧内容渲染一次')

  // 内容未变：原容器复用（幂等，不重建、不抖动）
  commit(block)
  assert.equal(block.querySelector(TEXT_BODY), body, '内容未变时复用同一容器')
  assert.equal(stack.markdown.calls.filter((c) => c.text === '## 旧内容').length, 1, '未重复渲染')

  // React 改写内容：重建
  block.querySelector('code').textContent = '## 新内容'
  block.querySelector('pre').textContent = '## 新内容'
  commit(block)
  const next = block.querySelector(TEXT_BODY)
  assert.notEqual(next, body, '内容变化后重建容器')
  assert.equal(block.querySelectorAll(TEXT_BODY).length, 1, '旧容器已移除')
  assert.ok(stack.reactDom.unmounts.includes(body), '旧容器的 React root 已卸载')
  assert.ok(
    stack.markdown.calls.some((c) => c.text === '## 新内容'),
    '新内容进入官方渲染器',
  )
})

test('宿主冲掉容器但保留块（React 重渲染抹掉插件节点）→ 兜底重扫自愈', () => {
  const { scroll, commit, stack } = setup()
  const block = makeCodeBlock({ lang: 'text', code: '## 自愈' })
  scroll.appendChild(block)
  commit(block)
  const body = block.querySelector(TEXT_BODY)
  assert.ok(body, '首次接管')

  // 模拟 React 重建块内部子树：容器与按钮被抹掉，宿主结构回来
  block.removeChild(body)
  const toggle = block.querySelector('button.dsh-md-render-text-toggle')
  block.removeChild(toggle)
  assert.equal(block.querySelector(TEXT_BODY), null, '容器已丢失')

  commit(block)
  assert.ok(block.querySelector(TEXT_BODY), '兜底重扫自愈：容器重建')
  assert.equal(block.querySelectorAll(TEXT_BODY).length, 1, '不重复挂载')
  assert.equal(block.querySelectorAll('button.dsh-md-render-text-toggle').length, 1, '切换按钮也只一份')
  assert.ok(stack.reactDom.unmounts.includes(body), '被抹掉的容器已卸载')
})
