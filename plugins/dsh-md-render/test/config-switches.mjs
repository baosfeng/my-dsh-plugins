/**
 * 保留增强功能的开关（copyButton / textFenceMarkdown / contextMarkdown）。
 *
 * 判据：默认全开；只接受布尔值（非法值 / 未知键忽略，不覆盖默认）；保存后热生效
 * （setRenderOptions 立即影响渲染）；启动时经 GET /md/api/config 拉取真实配置，
 * 拉取失败保持默认全开（不阻塞能力）。已下线的旧开关（syntaxHighlight /
 * mathStructures / tableSort / codeTheme …）不再存在——迁移说明见 README。
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

const KEYS = ['copyButton', 'textFenceMarkdown', 'contextMarkdown']

function load() {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  return { page, loaded, stack }
}

test('默认开关恰好三项且全开', () => {
  const { loaded } = load()
  assert.deepEqual(Object.keys(loaded.exports.DEFAULT_RENDER_OPTIONS).sort(), [...KEYS].sort(), '只保留三个开关')
  for (const key of KEYS) assert.equal(loaded.exports.DEFAULT_RENDER_OPTIONS[key], true, key + ' 默认开启')
})

test('pickRenderOptions 只接受布尔值，非法值 / 未知键忽略', () => {
  const { loaded } = load()
  const picked = loaded.exports.pickRenderOptions({
    copyButton: false,
    textFenceMarkdown: 'yes',
    contextMarkdown: true,
    syntaxHighlight: false,
    codeTheme: 'nord',
  })
  assert.deepEqual(picked, { copyButton: false, contextMarkdown: true }, '只取合法布尔值')
  assert.deepEqual(loaded.exports.pickRenderOptions(undefined), {}, '缺省不覆盖默认')
})

test('开关热生效：关闭后不再注入，恢复后重新注入', () => {
  const { loaded, page } = load()
  const block = makeCodeBlock({ lang: 'text', code: '# 标题' })
  const row = makeElement('div')
  const pre = makeContextPre('# 注入块')
  row.appendChild(pre)
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  scroll.appendChild(block)
  scroll.appendChild(row)
  // 夹具必须挂在 document.body 上（扫描器从 body 起扫）
  page.document.body.appendChild(scroll)

  loaded.exports.setRenderOptions({ textFenceMarkdown: false, contextMarkdown: false })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(block.querySelector('div.dsh-md-render-text-md'), null, 'text 围栏块关闭后不注入')
  assert.equal(row.querySelector('div.dsh-md-render-context-md'), null, '上下文块关闭后不注入')

  loaded.exports.setRenderOptions({ textFenceMarkdown: true, contextMarkdown: true })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(block.querySelector('div.dsh-md-render-text-md'), '恢复后注入 text 围栏块')
  assert.ok(row.querySelector('div.dsh-md-render-context-md'), '恢复后注入上下文块')
})

test('启动时拉取服务端配置并应用；拉取失败保持默认全开', async () => {
  const { loaded, page } = load()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = () =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: true, value: { copyButton: false, contextMarkdown: 'nope' } }),
      })
    loaded.exports.initConfigFromServer()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const row = makeElement('div')
    const pre = makeContextPre('# 上下文')
    row.appendChild(pre)
    page.document.body.appendChild(row)
    loaded.exports.apply({ effect: (fn) => fn() })
    // copyButton 关（不再渲染复制按钮）、contextMarkdown 保持默认开（非法值忽略）
    const view = loaded.exports.MarkdownView({ text: 'x' })
    assert.equal(view.props.children.filter(Boolean).length, 1, 'copyButton=false 生效：无复制按钮')
    assert.ok(row.querySelector('div.dsh-md-render-context-md'), '非法值忽略：上下文渲染保持默认开')

    // 拉取失败：保持当前状态、不抛错
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    loaded.exports.initConfigFromServer()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = originalFetch
  }
})
