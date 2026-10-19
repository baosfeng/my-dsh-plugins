/**
 * 代码块（B 路）静态断言 + 纯函数单测 —— 不依赖整体 bundle。
 *
 * 覆盖：
 *  · styles-code.ts：围栏卡几何（10px 圆角 / 1px 发丝边 / 头 32 / 语言胶囊 10px·600·大写·.06em /
 *    行号列与代码 11.5px·1.65 / hl-* 语法色 / 底栏三态），颜色不出现裸十六进制、不取 shiki 调色板；
 *  · own-code.ts：行号 / 底栏说明 / hljs scope → hl-* 映射等纯函数；MdrCodeBlock 产出的 vdom 结构
 *    （语言胶囊、默认关的行号与换行、底栏三态）；hljs 未就绪 → 纯文本；
 *  · block-render.ts：div.md-code-block 契约、mountMdrBlock 三视图切换与幂等、不碰宿主节点。
 *
 * 判据来源：docs/原型重构/dsh-md-render.html（围栏块 3386–3517 / CSS 1404–1600）+ 重构契约。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const babel = require('@babel/core')
const presetTypescript = require('@babel/preset-typescript')

const here = dirname(fileURLToPath(import.meta.url))
const partsDir = join(here, '..', 'src', 'client', 'parts')

function readPart(name) {
  return readFileSync(join(partsDir, name), 'utf8')
}

/** 剔除注释后的源码（静态断言只认代码，避免「注释里写了禁令」被误判）。 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** 用 babel 把 TS 片段转成可执行 JS，在独立 vm 沙箱里求值（片段无 import/export 语句）。 */
function loadPart(name, globals = {}) {
  const source = readPart(name)
  const compiled = babel.transformSync(source, {
    filename: name,
    babelrc: false,
    configFile: false,
    presets: [[presetTypescript, {}]],
  }).code
  const exports = {}
  const sandbox = {
    exports,
    module: { exports },
    console,
    setTimeout,
    clearTimeout,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    icon: {},
    ...globals,
  }
  vm.createContext(sandbox)
  vm.runInContext(compiled, sandbox)
  return { exports, sandbox }
}

/** 极简假元素：只实现本套件用到的 DOM API。 */
function fakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    textContent: '',
    className: '',
    parentNode: null,
    _children: [],
    _attrs: {},
    _listeners: {},
    setAttribute(key, value) {
      this._attrs[key] = String(value)
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null
    },
    removeAttribute(key) {
      delete this._attrs[key]
    },
    appendChild(child) {
      child.parentNode = this
      this._children.push(child)
      return child
    },
    removeChild(child) {
      const index = this._children.indexOf(child)
      if (index >= 0) this._children.splice(index, 1)
      child.parentNode = null
      return child
    },
    querySelector(selector) {
      if (selector === 'div.mdr-block') {
        return this._children.find((child) => String(child.className).split(/\s+/).includes('mdr-block')) || null
      }
      if (selector === 'pre') return this._children.find((child) => child.tagName === 'PRE') || null
      return null
    },
    querySelectorAll() {
      return []
    },
    matches() {
      return false
    },
    closest() {
      return null
    },
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
  }
  return el
}

// ── ① styles-code：几何 / 字号 / 语法色 / 三态 ─────────────────────────────

test('styles-code：围栏卡几何 / 字号 / 语法色 / 底栏三态逐条对齐原型', () => {
  const css = readPart('styles-code.ts')
  assert.ok(css.includes('const STYLES_CODE: string'), '导出 STYLES_CODE 常量')
  assert.ok(css.includes('.mdr-fence{') && css.includes('border-radius:10px'), '围栏卡 10px 圆角')
  assert.ok(css.includes('border:1px solid var(--mdr-frame-line)'), '1px 发丝边')
  assert.ok(css.includes('.mdr-fence-head{') && css.includes('height:32px'), '头高 32')
  assert.ok(/\.mdr-fence-pill\{[^}]*font-size:10px/.test(css), '语言胶囊 10px')
  assert.ok(/\.mdr-fence-pill\{[^}]*font-weight:600/.test(css), '语言胶囊 600')
  assert.ok(/\.mdr-fence-pill\{[^}]*letter-spacing:0\.06em/.test(css), '语言胶囊字距 .06em')
  assert.ok(/\.mdr-fence-pill\{[^}]*text-transform:uppercase/.test(css), '语言胶囊大写')
  assert.ok(/\.mdr-line-nums\{[^}]*font-size:11\.5px/.test(css), '行号列 11.5px')
  assert.ok(/\.mdr-fence-code\{[^}]*font-size:11\.5px/.test(css), '代码 11.5px')
  assert.ok(/\.mdr-fence-code\{[^}]*line-height:1\.65/.test(css), '代码行高 1.65')
  assert.ok(/\.mdr-fence-code\{[^}]*padding:10px 12px/.test(css), '代码内边距 10 12')
  for (const token of ['hl-key', 'hl-str', 'hl-num', 'hl-com', 'hl-fn', 'hl-tag', 'hl-prop']) {
    assert.ok(css.includes('.mdr-fence-code .' + token + '{'), '语法色类 ' + token)
  }
  assert.ok(css.includes('.mdr-rm{') && css.includes('.mdr-rm-btn{'), '底栏三态容器/按钮')
  assert.ok(/\.mdr-rm-btn\.is-active\{/.test(css), '三态当前项 .is-active')
  assert.ok(css.includes('div.md-code-block[data-mdr-view]'), '接管态隐藏宿主原内容')
  assert.ok(css.includes('prefers-reduced-motion'), '减弱动效全关')
  const stylesCode = codeOnly(css)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(stylesCode), false, '不出现裸十六进制颜色')
  assert.equal(stylesCode.includes('--shiki-token-'), false, '不取 shiki 调色板')
})

// ── ② own-code：纯函数 ────────────────────────────────────────────────────

function loadOwnCode(globals = {}) {
  return loadPart('own-code.ts', {
    HLJS_ASSET: 'hljs',
    ensureRenderAsset: () => null,
    icon: { wrap: () => ({ icon: 'wrap' }), lines: () => ({ icon: 'lines' }) },
    MdrCopyButton: () => ({ type: 'button', props: {}, children: [] }),
    MdrLangSwitchFrom: () => ({ type: 'span', props: {}, children: [] }),
    ...globals,
  })
}

test('own-code 纯函数：行号按逻辑行、底栏说明、hljs scope → hl-* 映射', () => {
  const { exports } = loadOwnCode()
  assert.equal(exports.lineNumbersText('a\nb'), '1\n2', '两行')
  assert.equal(exports.lineNumbersText('a\n\nb'), '1\n2\n3', '空行占位')
  assert.equal(exports.lineNumbersText(''), '', '空代码无行号')
  assert.equal(exports.fenceLineNote('a\nb\nc', 'js'), '3 行 · js', '行数 · 语言')
  assert.equal(exports.fenceLineNote('x', ''), '1 行 · 未标注语言', '语言位为空不编造')
  assert.equal(exports.hlClassOf('keyword'), 'hl-key', '关键字')
  assert.equal(exports.hlClassOf('comment.line'), 'hl-com', '分级 scope 取首段')
  assert.equal(exports.hlClassOf('title.function'), 'hl-fn', '函数名')
  assert.equal(exports.hlClassOf('attr'), 'hl-prop', '属性名')
  assert.equal(exports.hlClassOf('not-a-scope'), '', '未知 scope 不包 span')
  assert.equal(exports.hlClassOf(''), '', '空 scope 无类名')
  assert.ok(exports.MAX_HIGHLIGHT_CHARS > 0, '高亮上限为正数')
})

test('own-code：hljs 未就绪 → 纯文本；令牌树 → vdom span（不拼 HTML）', () => {
  const { exports } = loadOwnCode()
  assert.equal(exports.highlightNodes('js', 'const a = 1'), null, 'hljs 未就绪返回 null（调用方纯文本）')
  const out = []
  exports.hlTokenNodes(
    {
      children: [{ scope: 'keyword', children: ['const'] }, ' a = ', { scope: 'number', children: ['1'] }],
    },
    'hl',
    out,
  )
  assert.equal(out.length, 3, '文本片段与 span 交替')
  assert.equal(out[0].type, 'span', '关键字包 span')
  assert.equal(out[0].props.className, 'hl-key', '关键字类名')
  assert.equal(out[0].children[0], 'const', 'span 文本')
  assert.equal(out[1], ' a = ', '文本原样保留')
  assert.equal(out[2].props.className, 'hl-num', '数字类名')
})

test('own-code：MdrCodeBlock 结构 = 语言胶囊 + 标题 + 行号默认关 + 底栏三态', () => {
  const { exports } = loadOwnCode()
  const block = exports.MdrCodeBlock({ lang: 'js', code: 'const a = 1', title: 'src/a.ts', view: 'code' })
  assert.equal(block.type, 'div', '卡片根')
  assert.equal(block.props.className, 'mdr-fence', '围栏卡类名')
  assert.equal(block.props['data-mdr-lines'], 'off', '行号默认关')
  assert.equal(block.props['data-mdr-wrap'], 'off', '换行默认关')
  assert.equal(block.props['data-mdr-lang'], 'js', '语言写在卡片上')
  const [head, body, foot] = block.children
  assert.equal(head.props.className, 'mdr-fence-head', '头部')
  const pill = head.children[0]
  assert.equal(pill.props.className, 'mdr-pill mdr-fence-pill', '语言胶囊（大写/字距由 CSS 负责）')
  assert.equal(pill.children[0], 'js', '真实语言 token')
  assert.equal(head.children[1].children[0], 'src/a.ts', '标题')
  assert.equal(body.props.className, 'mdr-fence-body', '主体')
  assert.equal(body.children[0].props.className, 'mdr-line-nums', '行号列始终在 DOM（默认 CSS 隐藏）')
  assert.equal(body.children[0].children[0], '1', '一行代码一个行号')
  assert.equal(body.children[1].props.className, 'mdr-fence-code', '代码 pre')
  assert.equal(foot.props.className, 'mdr-fence-foot', '底栏')
  assert.equal(foot.children[0].children[0], '1 行 · js', '底栏说明')
})

test('own-code：语言位为空 → 胶囊留空 + aria-hidden，不编造语言名', () => {
  const { exports } = loadOwnCode()
  const block = exports.MdrCodeBlock({ lang: '', code: 'attempt 1  429' })
  const pill = block.children[0].children[0]
  assert.equal(pill.children[0], '', '胶囊为空')
  assert.equal(pill.props['aria-hidden'], 'true', '空胶囊对读屏隐藏')
  assert.equal(block.children[2].children[0].children[0], '1 行 · 未标注语言', '底栏如实说明')
})

test('own-code 静态：不 innerHTML / 不 classList / 不 el.style；复制与三态走组件契约', () => {
  const code = codeOnly(readPart('own-code.ts'))
  assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(code), false, '不拼 HTML')
  assert.equal(/classList|cssText|\.style\./.test(code), false, '不写 classList / cssText / el.style')
  assert.ok(code.includes('MdrCopyButton'), '复制复用 copy.ts 的 MdrCopyButton')
  assert.ok(code.includes('MdrLangSwitchFrom('), '底栏三态复用 lang-switch.ts')
  assert.ok(code.includes("'data-mdr-lines'") && code.includes("'data-mdr-wrap'"), '状态写 data 属性')
})

// ── ③ block-render：宿主契约 / 三视图 / 幂等 ─────────────────────────────

function loadBlockRender(overrides = {}) {
  return loadPart('block-render.ts', {
    contextHash: (text) => String(text.length),
    renderAssetsReady: () => 0,
    fenceForceOf: () => undefined,
    resolveFenceLangEx: () => ({ lang: 'js', confirmed: true }),
    setFenceForce: () => {},
    isInsideRenderedMarkdown: () => false,
    renderOptions: { markdown: { textFenceMarkdown: true } },
    domRootAvailable: () => true,
    renderNodeInto: (container, node) => {
      container._node = node
      return true
    },
    renderMarkdownInto: (container, text) => {
      container._markdown = text
      return true
    },
    unmountMarkdownIn: () => {},
    MdrCodeBlock: (props) => ({ type: 'div', props, children: [] }),
    MdrLangSwitchFrom: (props) => ({ type: 'span', props, children: [] }),
    document: {
      createElement: (tag) => fakeElement(tag),
    },
    ...overrides,
  })
}

test('block-render 静态：接 div.md-code-block 契约 + mountMdrBlock 导出 + 三视图属性', () => {
  const code = codeOnly(readPart('block-render.ts'))
  assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(code), false, '不拼 HTML')
  assert.equal(/classList|cssText|\.style\./.test(code), false, '不写 classList / cssText / el.style')
  assert.ok(code.includes("'div.md-code-block'"), '宿主围栏选择器')
  assert.ok(code.includes('function mountMdrBlock('), 'mountMdrBlock 导出面')
  assert.ok(code.includes("BLOCK_VIEW_ATTR = 'data-mdr-view'"), '视图状态写在块上')
  assert.ok(code.includes("BLOCK_SWITCH_EVENT = 'mdr-lang-switch'"), '三态事件契约')
})

test('block-render：mountMdrBlock 三视图 + 幂等 + source 移除自有容器', () => {
  const { exports } = loadBlockRender()
  const host = fakeElement('div')
  host.setAttribute('data-mdr-view', 'code')
  exports.mountMdrBlock(host, 'js', 'const a = 1', 'code')
  assert.equal(host.getAttribute('data-mdr-view'), 'code', '代码视图')
  assert.equal(host.getAttribute('data-mdr-lang'), 'js', '语言写在块上')
  assert.equal(host._children.length, 1, '只追加一个自有容器')
  assert.equal(host._children[0].className, 'mdr-block', '容器类名')
  const handed = host._children[0]._node.props
  assert.equal(handed.lang, 'js', '交给 MdrCodeBlock：语言')
  assert.equal(handed.code, 'const a = 1', '交给 MdrCodeBlock：源码')
  assert.equal(handed.view, 'code', '交给 MdrCodeBlock：视图')
  const card = host._children[0]
  exports.mountMdrBlock(host, 'js', 'const a = 1', 'code')
  assert.equal(host._children.length, 1, '签名未变 → 不重建')
  assert.equal(host._children[0], card, '同一容器保持')
  exports.mountMdrBlock(host, 'js', 'const a = 1', 'markdown')
  assert.equal(host._children.length, 1, '切 markdown：替换为一个容器')
  assert.ok(String(host._children[0].className).includes('mdr-block-md'), 'markdown 卡类名')
  assert.equal(host.getAttribute('data-mdr-view'), 'markdown', 'markdown 视图')
  exports.mountMdrBlock(host, 'js', 'const a = 1', 'source')
  assert.equal(host._children.length, 0, '源码视图移除自有容器（宿主原样）')
  assert.equal(host.getAttribute('data-mdr-view'), null, '视图属性移除')
})

test('block-render：fenceKindOf 分流（text→markdown / mermaid→不接管 / 无语言确证→markdown）', () => {
  const host = fakeElement('div')
  let resolved = { lang: 'text', confirmed: true }
  const { exports, sandbox } = loadBlockRender({ resolveFenceLangEx: () => resolved })
  const site = (result) => result.kind + ':' + result.lang
  assert.equal(site(exports.fenceKindOf(host)), 'markdown:text', 'text 家族走 markdown')
  sandbox.resolveFenceLangEx = () => ({ lang: 'mermaid', confirmed: true })
  assert.equal(site(exports.fenceKindOf(host)), 'none:mermaid', '图表交给 mermaid-scan')
  sandbox.resolveFenceLangEx = () => ({ lang: '', confirmed: true })
  assert.equal(site(exports.fenceKindOf(host)), 'markdown:', '确证无语言 → markdown')
  sandbox.resolveFenceLangEx = () => ({ lang: '', confirmed: false })
  assert.equal(site(exports.fenceKindOf(host)), 'code:', '识别失败 → 代码卡（语言位留空）')
})

test('block-render：fenceSource 去尾部换行；流式块 / 超长不接管', () => {
  const { exports } = loadBlockRender()
  const host = fakeElement('div')
  const pre = fakeElement('pre')
  pre.textContent = 'a\nb\n'
  host.appendChild(pre)
  assert.equal(exports.fenceSource(host), 'a\nb', '官方 display 语义')
  const streaming = fakeElement('div')
  streaming.closest = () => fakeElement('div')
  assert.equal(exports.applyFenceBlock(streaming), undefined, '流式块直接返回')
  assert.equal(streaming._children.length, 0, '流式块不动 DOM')
})
