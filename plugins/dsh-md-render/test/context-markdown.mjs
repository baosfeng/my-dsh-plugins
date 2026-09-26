/**
 * pre[data-context-text] 上下文注入块按 markdown 渲染（本插件保留的真增量）。
 *
 * 宿主 ui-chat 的 ContextBody 把上下文注入正文（子 agent 回传消息 / AGENTS.md）
 * 渲染为 <pre data-context-text> 纯文本（ui-chat/src/client/chat/ContextBody.tsx:147），
 * 官方不接管 → 本插件在 DOM 层把它交给官方 MarkdownText 渲染：
 * 容器插在 pre **之前**、pre 置 hidden（React 拥有该子树，不改其子结构）、
 * 幂等签名（未变不重建）、超长 / 开关关闭 / 官方不可用 → 不动宿主 DOM。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeContextPre,
  makeElement,
} from './support/fake-dom.mjs'

const SAMPLE = ['## 子 agent 回传', '', '要点 **加粗**：', '', '- 一', '- 二'].join('\n')
const BODY_SEL = 'div.dsh-md-render-context-md'

function setup({ text = SAMPLE, withOfficial = true } = {}) {
  const row = makeElement('div')
  const pre = makeContextPre(text)
  row.appendChild(pre)
  const page = installGlobals(createPage(row))
  const react = createReactStub()
  const stack = withOfficial ? createOfficialStack(page, react) : { markdown: undefined, reactDom: undefined }
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, stack, row, pre }
}

test('上下文块渲染为官方 markdown，原文 pre 保留并隐藏', () => {
  const { loaded, stack, row, pre } = setup()
  const body = row.querySelector(BODY_SEL)
  assert.ok(body, '渲染容器已插入')
  assert.ok(String(body.className).includes('tzx-md'), '容器带 tzx-md 契约类')
  assert.equal(body.getAttribute('data-dsh-md-render-context-body'), 'true', '容器标记')
  assert.equal(pre.previousElementSibling, body, 'pre 的前一个兄弟是渲染容器')
  assert.equal(pre.getAttribute('data-dsh-md-render-context'), 'applied', 'pre 上的已处理标记')
  assert.equal(pre.hidden, true, '原文 pre 置 hidden')
  assert.equal(pre.textContent, SAMPLE, '原文内容未改写')
  assert.equal(body.querySelector('.official-md-stub').getAttribute('data-text'), SAMPLE, '文本交给官方渲染器')
  assert.equal(stack.markdown.calls[0].labels.code.copyLabel, '复制', 'labels 透传')
  assert.equal(loaded.exports.officialMarkdownAvailable(), true, '官方渲染器可用')
})

test('幂等：重扫不重建容器、不重复渲染', () => {
  const { loaded, row, stack } = setup()
  const body = row.querySelector(BODY_SEL)
  const calls = stack.markdown.calls.length
  loaded.exports.apply({ effect: (fn) => fn() })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(row.querySelector(BODY_SEL), body, '同一容器复用')
  assert.equal(row.querySelectorAll(BODY_SEL).length, 1, '无重复容器')
  assert.equal(stack.markdown.calls.length, calls, '签名未变不重复渲染')
})

test('注入内容变化 → 重建并卸载旧容器', () => {
  const { loaded, row, pre, stack } = setup()
  const body = row.querySelector(BODY_SEL)
  pre.textContent = '## 更新后的正文'
  loaded.exports.apply({ effect: (fn) => fn() })
  const next = row.querySelector(BODY_SEL)
  assert.notEqual(next, body, '内容变化后重建')
  assert.equal(row.querySelectorAll(BODY_SEL).length, 1, '旧容器已移除')
  assert.equal(next.querySelector('.official-md-stub').getAttribute('data-text'), '## 更新后的正文')
  assert.ok(stack.reactDom.unmounts.includes(body), '旧容器的 React root 已卸载')
})

test('超长文本 / 开关关闭 / 官方组件不可用 → 保持宿主纯文本（真降级）', () => {
  const huge = setup({ text: 'x'.repeat(200001) })
  assert.equal(huge.row.querySelector(BODY_SEL), null, '超长文本不接管')
  assert.equal(huge.pre.hidden, false, 'pre 保持可见')

  const off = setup()
  off.loaded.exports.setRenderOptions({ contextMarkdown: false })
  const pre2 = makeContextPre('# 关掉后')
  off.row.appendChild(pre2)
  off.loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(off.row.querySelectorAll(BODY_SEL).length, 1, '关闭后不再新增容器')
  assert.equal(pre2.getAttribute('data-dsh-md-render-context'), null, '关闭后 pre 不被标记')
  assert.equal(pre2.hidden, false, '关闭后 pre 不被隐藏')

  const none = setup({ withOfficial: false })
  assert.equal(none.row.querySelector(BODY_SEL), null, '官方组件不可用时不注入')
  assert.equal(none.pre.hidden, false, '官方组件不可用时 pre 保持可见')
})
