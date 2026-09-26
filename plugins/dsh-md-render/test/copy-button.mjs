/**
 * 整段 markdown 复制（本插件保留的增量：官方只有代码块复制）。
 *
 * 判据：按钮挂在 tzx-md 容器上、点击复制**整段纯文本**，且官方代码块 banner
 * 的语言名与官方复制按钮文案不被收进复制内容（否则粘贴出来会多出「js 复制」）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  vdomToDom,
} from './support/fake-dom.mjs'

const MARKDOWN = '# 标题\n\n正文 **加粗**\n\n- 一\n- 二'

function mount({ official = true } = {}) {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = official ? createOfficialStack(page, react) : { markdown: undefined, reactDom: undefined }
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: MARKDOWN }), page.document)
  return { page, loaded, dom }
}

function installClipboard() {
  const written = []
  // Node ≥22 的 navigator 是只读 getter：用 defineProperty 覆盖（测试进程内有效）。
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
  return written
}

test('整段复制按钮渲染在 tzx-md 容器内', () => {
  const { dom } = mount()
  const btn = dom.querySelector('button.dsh-md-render-copy')
  assert.ok(btn, 'copy button rendered')
  assert.equal(btn.textContent, '复制', 'idle label')
})

test('点击复制整段文本，且不含官方 banner 语言名 / 官方复制按钮文案', async () => {
  const { dom } = mount()
  const written = installClipboard()
  dom.querySelector('button.dsh-md-render-copy').fire('click')
  await Promise.resolve()
  assert.equal(written.length, 1, 'clipboard.writeText called once')
  assert.equal(written[0], MARKDOWN, '整段纯文本（banner 与官方按钮文案已排除）')
})

test('copyButton 关闭 → 不渲染复制按钮', () => {
  const { loaded, page, dom } = mount()
  assert.ok(dom.querySelector('button.dsh-md-render-copy'), '默认开启')
  loaded.exports.setRenderOptions({ copyButton: false })
  const dom2 = vdomToDom(loaded.exports.MarkdownView({ text: MARKDOWN }), page.document)
  assert.equal(dom2.querySelector('button.dsh-md-render-copy'), null, '关闭后无按钮')
})

test('官方组件不可用（<pre> 兜底）时整段复制按钮仍在', () => {
  const { dom } = mount({ official: false })
  assert.ok(dom.querySelector('pre.dsh-md-render-fallback'), 'fallback pre')
  assert.ok(dom.querySelector('button.dsh-md-render-copy'), 'copy button still available')
})
