import { test } from 'vitest'
/**
 * Client render-path test for dsh-mermaid-render: loads the BUILT bundle
 * lib/client.js (lib/parts/*.part.js spliced + vendored base64 engine
 * injected by scripts/build.mjs) against stubbed react + a fake DOM, then
 * verifies:
 *  - the bundle registers and apply() injects the stylesheet,
 *  - the scanner detects a mermaid md-code-block and mounts a card
 *    (react-dom/client.createRoot captured),
 *  - the card renders its shell (preview/code toggle + loading state),
 *  - a non-mermaid block is ignored.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── minimal react stub (self-contained: no react install needed, so the
//    test also runs in CI where the dsh react path does not exist) ────────
function createElement(type, props, ...children) {
  // Mirror react's shape: children live under props.children (flattened),
  // so tree-walking code written against react works unchanged.
  return { type, props: { ...(props || {}), children: children.flat() } }
}

// useState 按组件调用顺序维护状态槽（支持 setter 更新后重渲染验证）；
// useEffect 同步执行回调（promise 链仍走微任务，同步 walk 时状态不变）。
let hookCall = 0
const hookSlots = []
const stubbed = {
  createElement,
  useState: (initial) => {
    const i = hookCall++
    if (hookSlots[i] === undefined) hookSlots[i] = typeof initial === 'function' ? initial() : initial
    const set = (v) => {
      hookSlots[i] = typeof v === 'function' ? v(hookSlots[i]) : v
    }
    return [hookSlots[i], set]
  },
  useEffect: (fn) => fn(),
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, get) => get(),
}
let capturedRender = null
const stubbedReactDomClient = {
  createRoot: (_container) => ({
    render: (el) => {
      capturedRender = el
    },
    unmount: () => {},
  }),
}

// ── fake DOM ─────────────────────────────────────────────────────────────
function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    textContent: '',
    className: attrs.className || '',
    style: {},
    dataset: {},
    parentNode: null,
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
      this.textContent += child.textContent
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
    },
    setAttribute(k, v) {
      this[k] = v
    },
    getAttribute(k) {
      return this[k]
    },
    querySelector(sel) {
      const walk = (els) => {
        for (const e of els) {
          if (e.matchesSel && e.matchesSel(sel)) return e
          const found = walk(e.children)
          if (found) return found
        }
        return null
      }
      return walk(this.children)
    },
    querySelectorAll(sel) {
      const out = []
      const walk = (els) => {
        for (const e of els) {
          if (e.matchesSel && e.matchesSel(sel)) out.push(e)
          walk(e.children)
        }
      }
      walk(this.children)
      return out
    },
    matchesSel(sel) {
      if (sel === 'pre') return this.tagName === 'PRE'
      if (sel === 'code') return this.tagName === 'CODE'
      if (sel === 'svg') return this.tagName === 'SVG'
      if (sel === '[data-conversation-scroll]') return this.dataset.conversationScroll === '1'
      if (sel === '[data-streaming]') return this.dataset.streaming === '1'
      if (sel === 'div.md-code-block') return this.tagName === 'DIV' && this.className === 'md-code-block'
      const entryMatch = /^\[data-dsh-mermaid-render-entry="([^"]+)"\]$/.exec(sel)
      if (entryMatch) return this.dataset.dshMermaidRenderEntry === entryMatch[1]
      return false
    },
    closest(sel) {
      let node = this
      while (node) {
        if (node.matchesSel && node.matchesSel(sel)) return node
        node = node.parentNode
      }
      return null
    },
  }
  return el
}

// conversation-scroll container holding one mermaid block and one js block
const scrollEl = makeElement('div')
scrollEl.dataset.conversationScroll = '1'
const mermaidBlock = makeElement('div', { className: 'md-code-block' })
const mermaidPre = makeElement('pre')
const mermaidCode = makeElement('code', { className: 'language-mermaid' })
mermaidCode.textContent = 'flowchart TD\n  A --> B'
mermaidPre.appendChild(mermaidCode)
mermaidBlock.appendChild(mermaidPre)
const jsBlock = makeElement('div', { className: 'md-code-block' })
const jsPre = makeElement('pre')
const jsCode = makeElement('code', { className: 'language-js' })
jsCode.textContent = 'const x = 1'
jsPre.appendChild(jsCode)
jsBlock.appendChild(jsPre)
scrollEl.appendChild(mermaidBlock)
scrollEl.appendChild(jsBlock)
// streaming 中的 mermaid 块（祖先带 data-streaming）：issue #195 起按「内容稳定窗口
// （STREAM_SETTLE_MS）+ 连续观察」判定闭合，稳定窗口未到时不得挂载——此处验证初始不挂载
// （稳定窗口到期后的挂载、内容变化时的自愈卸载、零炸弹图见 client-stream-bomb.mjs）
const streamingRow = makeElement('div')
streamingRow.dataset.streaming = '1'
const streamingBlock = makeElement('div', { className: 'md-code-block' })
const streamingPre = makeElement('pre')
const streamingCode = makeElement('code', { className: 'language-mermaid' })
streamingCode.textContent = 'flowchart TD\n  A --> B'
streamingPre.appendChild(streamingCode)
streamingBlock.appendChild(streamingPre)
streamingRow.appendChild(streamingBlock)
scrollEl.appendChild(streamingRow)

const styleTags = []
const bodyEl = makeElement('body')
bodyEl.appendChild(scrollEl)
global.window = {
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  mermaid: {
    initialize: () => {},
    render: async (id, _src) => ({ svg: `<svg id="${id}" width="100%"></svg>` }),
  },
}
global.document = {
  body: bodyEl,
  head: {
    appendChild(el) {
      styleTags.push(el)
      return el
    },
    removeChild() {},
  },
  createElement(tag) {
    return makeElement(tag)
  },
  querySelector(sel) {
    return bodyEl.querySelector(sel)
  },
  querySelectorAll(sel) {
    return bodyEl.querySelectorAll(sel)
  },
  execCommand() {
    return true
  },
}
global.Element = function Element() {}
global.MutationObserver = class {
  constructor() {}
  observe() {}
  disconnect() {}
}
global.NodeFilter = { SHOW_TEXT: 4 }

// ── load bundle ───────────────────────────────────────────────────────────
let registered = null
global.window.__ModuleLoader__ = {
  load: (reg) => {
    registered = reg
  },
}

// P2 parts 化后 client.src.js 是含 __PART_*__ 占位符的模板，不可直接
// eval；这里加载构建产物 lib/client.js（与 dsh-file-activity /
// dsh-think-zh-expand 的 client-render 测试一致）。
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === 'react-dom/client') return stubbedReactDomClient
  throw new Error('unexpected require: ' + spec)
})
assert.deepEqual(exportsObj.inject, [])
assert.equal(typeof exportsObj.apply, 'function')

// ── apply with a mock ctx (effects run immediately) ───────────────────────
const effects = []
const ctx = {
  effect: (fn, label) => {
    effects.push(label)
    return fn()
  },
}
exportsObj.apply(ctx)

try {
  // stylesheet injected first
  assert.ok(styleTags.length === 1, 'stylesheet injected')
  assert.ok(styleTags[0].textContent.includes('.dsh-mermaid-render-card'), 'stylesheet has card rules')

  // scanner mounted a card for the mermaid block (createRoot captured)
  assert.ok(capturedRender, 'card element captured via createRoot')
  const cardEl = capturedRender
  assert.equal(cardEl.type.name, 'MermaidCard', 'captured element is the card')
  assert.ok(cardEl.props.source.includes('flowchart TD'), 'card got the mermaid source')
  assert.ok(cardEl.props.entryId.startsWith('dsh-mermaid-'), 'card entry id assigned')
  // the original pre is hidden
  assert.equal(mermaidPre.style.display, 'none', 'original pre hidden after mount')

  // non-mermaid md-code-block was NOT mounted (only one card captured)
  // (scanner ran synchronously over the fake DOM before the card render)
  assert.equal(jsPre.style.display, undefined, '非 mermaid 块的 pre 未被隐藏')
  // streaming 中的 mermaid 块初始不挂载（等稳定窗口确认闭合，issue #195）
  assert.equal(streamingPre.style.display, undefined, '流式中的 mermaid 块 pre 未被隐藏')
  assert.equal(streamingBlock.querySelector('.dsh-mermaid-render-card-host'), null, '流式中的 mermaid 块未挂载卡片')
  const cardTree = cardEl.type(cardEl.props)
  const texts = []
  const classNames = []
  const svgIcons = []
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const c of node) walk(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      walk(node.type(props))
      return
    }
    if (node.type === 'svg') svgIcons.push(node)
    if (props.className) classNames.push(props.className)
    walk(props.children)
  }
  /** 图标形状签名：svg 子元素的 d/points 拼接（区分 file/code/refresh/alert）。 */
  function iconShapesOf() {
    return svgIcons.map((s) => {
      const kids = Array.isArray(s.props.children) ? s.props.children : [s.props.children]
      return kids.map((c) => (c && c.props ? c.props.d || c.props.points || '' : '')).join('|')
    })
  }
  walk(cardTree)
  assert.ok(texts.includes('渲染中…'), 'loading state shown initially')
  assert.ok(texts.includes('预览') && texts.includes('代码'), 'preview/code toggle present')
  // 全部类名使用 dsh-mermaid-render- 前缀（无 dmr- 残留，issue #54）
  for (const cls of classNames) {
    assert.ok(cls.startsWith('dsh-mermaid-render-'), `class "${cls}" must use the dsh-mermaid-render- prefix`)
  }
  // 切换按钮带图标：预览=file / 代码=code（共享图标系统）
  const iconShapes = iconShapesOf()
  assert.ok(
    iconShapes.some((d) => d.includes('M14 2H6')),
    'preview button shows file icon',
  )
  assert.ok(
    iconShapes.some((d) => d.includes('16 18 22 12 16 6')),
    'code button shows code icon',
  )
  // loading 状态显示旋转 refresh 图标
  assert.ok(
    iconShapes.some((d) => d.includes('M21 12a9')),
    'loading shows refresh icon',
  )

  // 错误渲染兜底：mermaid.render 失败 → 卡片显示错误横幅（不崩溃、保留原始块）
  hookCall = 0
  global.window.mermaid.render = async () => {
    throw new Error('render boom')
  }
  cardEl.type(cardEl.props) // 第二次渲染：effect 同步执行 → render reject（微任务）
  await new Promise((r) => setTimeout(r, 0)) // 等 catch 回调（setError/setStatus）执行
  hookCall = 0
  const errorTree = cardEl.type(cardEl.props) // 第三次渲染：error 状态
  walk(errorTree) // walk 闭包写入 texts（与 cardTree 同一数组）
  assert.ok(
    texts.some((t) => t.includes('render boom')),
    '错误信息显示在卡片中',
  )
  assert.ok(
    texts.some((t) => t.includes('渲染失败') || t.includes('失败')),
    '错误横幅出现',
  )
  // 错误状态含 alert 图标（层级化：图标 + 标题 + 信息）
  assert.ok(
    iconShapesOf().some((d) => d.includes('M10.29 3.86')),
    'error shows alert icon',
  )

  // ── 导出功能（issue #85）：按钮存在 + 序列化/文件名/复制/PNG 行为 ──
  // 模拟渲染完成的卡片 DOM（带 entryId 的容器 + svg 元素），供 findCardSvg 定位
  const exportHost = makeElement('div')
  exportHost.dataset.dshMermaidRenderEntry = 'dsh-mermaid-1'
  const exportSvgWrap = makeElement('div', { className: 'dsh-mermaid-render-svg' })
  const exportSvgEl = makeElement('svg')
  exportSvgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  exportSvgEl.setAttribute('width', '100')
  exportSvgEl.setAttribute('height', '50')
  exportSvgWrap.appendChild(exportSvgEl)
  exportHost.appendChild(exportSvgWrap)
  scrollEl.appendChild(exportHost)

  // 浏览器导出 API mock
  const serializerCalls = []
  global.XMLSerializer = class {
    serializeToString(el) {
      serializerCalls.push(el)
      return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>'
    }
  }
  const createdUrls = []
  const revokedUrls = []
  global.URL = {
    createObjectURL: (blob) => {
      createdUrls.push(blob)
      return 'blob:mock-' + createdUrls.length
    },
    revokeObjectURL: (u) => revokedUrls.push(u),
  }
  let lastImage = null
  global.Image = class {
    constructor() {
      this.onload = null
      this.onerror = null
      this.src = ''
      this.width = 100
      this.height = 50
      lastImage = this
    }
  }
  const createdAnchors = []
  const canvasDraws = []
  const canvasToBlobs = []
  const baseCreateElement = global.document.createElement
  global.document.createElement = (tag) => {
    const el = baseCreateElement(tag)
    if (tag === 'a') createdAnchors.push(el)
    if (tag === 'canvas') {
      el.getContext = () => ({
        drawImage: (...args) => canvasDraws.push(args),
      })
      el.toBlob = (cb) => {
        canvasToBlobs.push(el)
        cb(new Blob(['png'], { type: 'image/png' }))
      }
    }
    return el
  }
  const clipboardWrites = []
  Object.defineProperty(global, 'navigator', {
    value: {
      clipboard: {
        writeText: async (text) => {
          clipboardWrites.push(text)
        },
      },
    },
    configurable: true,
  })

  // 恢复渲染成功 → 卡片 status ok（下载按钮可用）
  hookCall = 0
  global.window.mermaid.render = async (id, _src) => ({ svg: `<svg id="${id}" width="100%" height="50"></svg>` })
  cardEl.type(cardEl.props)
  await new Promise((r) => setTimeout(r, 0))
  hookCall = 0
  const exportTree = cardEl.type(cardEl.props)
  const exportButtons = []
  function walkButtons(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') return
    if (Array.isArray(node)) {
      for (const c of node) walkButtons(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      walkButtons(node.type(props))
      return
    }
    if (node.type === 'button') exportButtons.push(node)
    walkButtons(props.children)
  }
  walkButtons(exportTree)
  const btnByLabel = (label) => exportButtons.find((b) => (b.props['aria-label'] || '') === label)
  const pngBtn = btnByLabel('下载 PNG')
  const svgBtn = btnByLabel('下载 SVG')
  const copyBtn = btnByLabel('复制代码')
  assert.ok(pngBtn && svgBtn && copyBtn, '导出按钮组存在（下载 PNG / 下载 SVG / 复制代码）')
  assert.equal(pngBtn.props.disabled, false, '渲染成功后下载按钮可用')
  assert.equal(copyBtn.props.disabled, undefined, '复制按钮始终可用')

  // 下载 SVG：序列化 + 文件名 + Blob 下载
  svgBtn.props.onClick()
  assert.ok(serializerCalls.length >= 1, 'XMLSerializer 序列化 SVG DOM')
  assert.equal(serializerCalls[serializerCalls.length - 1], exportSvgEl, '序列化的是卡片内 SVG 元素')
  assert.ok(createdUrls.length >= 1, 'URL.createObjectURL 被调用')
  assert.equal(createdUrls[createdUrls.length - 1].type, 'image/svg+xml;charset=utf-8', 'SVG blob MIME 正确')
  assert.equal(createdAnchors[createdAnchors.length - 1].download, 'mermaid-1.svg', 'SVG 文件名 mermaid-<序号>.svg')

  // 复制代码：clipboard.writeText 收到 mermaid 源码
  copyBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 0))
  assert.ok(clipboardWrites.length === 1, 'clipboard.writeText 被调用')
  assert.equal(clipboardWrites[0], 'flowchart TD\n  A --> B', '复制内容为 mermaid 源码')

  // 下载 PNG：Image 加载 → canvas 2x 绘制 → toBlob → 下载
  pngBtn.props.onClick()
  assert.ok(lastImage, 'Image 实例创建（SVG → PNG 转换）')
  lastImage.onload()
  assert.ok(canvasDraws.length >= 1, 'canvas drawImage 被调用')
  const pngCanvas = canvasToBlobs[canvasToBlobs.length - 1]
  assert.equal(pngCanvas.width, 200, 'canvas 宽度 = SVG 宽度 × 2')
  assert.equal(pngCanvas.height, 100, 'canvas 高度 = SVG 高度 × 2')
  assert.equal(createdAnchors[createdAnchors.length - 1].download, 'mermaid-1.png', 'PNG 文件名 mermaid-<序号>.png')

  // 失败路径：无 SVG 可导出 → 错误提示（不静默）
  scrollEl.removeChild(exportHost)
  hookCall = 0
  const failTree = cardEl.type(cardEl.props)
  const failButtons = []
  function walkFailButtons(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') return
    if (Array.isArray(node)) {
      for (const c of node) walkFailButtons(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      walkFailButtons(node.type(props))
      return
    }
    if (node.type === 'button') failButtons.push(node)
    walkFailButtons(props.children)
  }
  walkFailButtons(failTree)
  const failPngBtn = failButtons.find((b) => (b.props['aria-label'] || '') === '下载 PNG')
  failPngBtn.props.onClick()
  hookCall = 0
  const noticeTree = cardEl.type(cardEl.props)
  const noticeTexts = []
  function walkTexts(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      noticeTexts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const c of node) walkTexts(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      walkTexts(node.type(props))
      return
    }
    walkTexts(props.children)
  }
  walkTexts(noticeTree)
  assert.ok(
    noticeTexts.some((t) => t.includes('无法导出 PNG')),
    '无 SVG 时点击下载 PNG 显示错误提示（不静默）',
  )

  console.log('ALL CLIENT RENDER-PATH TESTS PASSED')
} finally {
  delete global.window
  delete global.document
  delete global.Element
  delete global.MutationObserver
  delete global.Node
  delete global.XMLSerializer
  delete global.URL
  delete global.Image
  delete global.navigator
}

test('script-style suite (assertions ran at module load)', () => {})
