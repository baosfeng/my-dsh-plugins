/**
 * pre[data-context-text] 上下文注入块按 markdown 渲染（**自研渲染器**）。
 *
 * 宿主 ui-chat 的 ContextBody 把上下文注入正文（子 agent 回传消息 / AGENTS.md）
 * 渲染为 <pre data-context-text> 纯文本（ui-chat/src/client/chat/ContextBody.tsx:147），
 * 官方不接管 → 本插件在 DOM 层用**自己的** markdown 渲染器渲染：
 * 容器插在 pre **之前**、pre 置 hidden（React 拥有该子树，不改其子结构）、
 * 幂等签名（未变不重建）、超长 / 开关关闭 / 渲染依赖没就绪 → 不动宿主 DOM。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeContextPre,
  makeElement,
} from './support/fake-dom.mjs'

const SAMPLE = ['## 子 agent 回传', '', '要点 **加粗**：', '', '- 一', '- 二'].join('\n')
const CARD_SEL = 'div.mdr-ctx'
const BODY_SEL = 'div.mdr-ctx-body'

function setup({ text = SAMPLE, assets = true } = {}) {
  const row = makeElement('div')
  const pre = makeContextPre(text)
  row.appendChild(pre)
  const page = installGlobals(createPage(row))
  const react = createReactStub()
  const stack = createRenderStack(page, react, { assets })
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, stack, row, pre }
}

test('上下文块由自研 markdown 渲染器渲染，原文 pre 保留并隐藏', () => {
  const { loaded, row, pre } = setup()
  const card = row.querySelector(CARD_SEL)
  assert.ok(card, '渲染卡片已插入')
  const body = card.querySelector(BODY_SEL)
  assert.ok(body, 'markdown 正文容器已插入')
  assert.ok(String(body.className).includes('mdr-md'), '容器带 mdr-md 契约类')
  assert.equal(card.getAttribute('data-mdr-context'), 'true', '卡片标记')
  assert.equal(pre.previousElementSibling, card, 'pre 的前一个兄弟是渲染卡片')
  assert.equal(pre.getAttribute('data-mdr-context-hidden'), 'true', 'pre 上的已处理标记')
  assert.equal(pre.hidden, true, '原文 pre 置 hidden')
  assert.equal(pre.textContent, SAMPLE, '原文内容未改写')
  assert.equal(body.querySelector('h2').textContent, '子 agent 回传', '真实 h2 标签（自研渲染）')
  assert.equal(body.querySelectorAll('li').length, 2, '列表渲染为真 li')
  assert.equal(body.querySelector('strong').textContent, '加粗', '加粗渲染为真 strong')
  assert.equal(loaded.exports.domRootAvailable(), true, 'react-dom/client 可用')
})

test('幂等：重扫不重建容器、不重复渲染', () => {
  const { loaded, row } = setup()
  const body = row.querySelector(BODY_SEL)
  loaded.exports.apply({ effect: (fn) => fn() })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(row.querySelector(BODY_SEL), body, '同一容器复用')
  assert.equal(row.querySelectorAll(CARD_SEL).length, 1, '无重复卡片')
  assert.equal(body.querySelectorAll('h2').length, 1, '内容未重复渲染')
})

test('注入内容变化 → 重建并卸载旧容器', () => {
  const { loaded, row, pre, stack } = setup()
  const body = row.querySelector(BODY_SEL)
  pre.textContent = '## 更新后的正文'
  loaded.exports.apply({ effect: (fn) => fn() })
  const next = row.querySelector(BODY_SEL)
  assert.notEqual(next, body, '内容变化后重建')
  assert.equal(row.querySelectorAll(CARD_SEL).length, 1, '旧卡片已移除')
  assert.equal(next.querySelector('h2').textContent, '更新后的正文', '新内容已渲染')
  assert.ok(stack.reactDom.unmounts.includes(body), '旧容器的 React root 已卸载')
})

test('超长文本 / 开关关闭 / 渲染依赖没就绪 → 保持宿主纯文本（真降级）', () => {
  const huge = setup({ text: 'x'.repeat(200001) })
  assert.equal(huge.row.querySelector(BODY_SEL), null, '超长文本不接管')
  assert.equal(huge.pre.hidden, false, 'pre 保持可见')

  const off = setup()
  off.loaded.exports.setRenderOptions({ contextMarkdown: false })
  const pre2 = makeContextPre('# 关掉后')
  off.row.appendChild(pre2)
  off.loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(off.row.querySelectorAll(BODY_SEL).length, 1, '关闭后不再新增容器')
  assert.equal(pre2.getAttribute('data-mdr-context'), null, '关闭后 pre 不被标记')
  assert.equal(pre2.hidden, false, '关闭后 pre 不被隐藏')

  const none = setup({ assets: false })
  assert.equal(none.row.querySelector(BODY_SEL), null, '解析层没就绪时不注入（等就绪通知重扫）')
  assert.equal(none.pre.hidden, false, '解析层没就绪时 pre 保持可见')
})
