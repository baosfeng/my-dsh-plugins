/**
 * Step definitions for dsh-md-render Gherkin acceptance tests.
 * Loads the BUILT bundle lib/client.js (parts spliced by scripts/build.mjs)
 * against stubbed react + a fake DOM, mirroring client-render.mjs:
 * non-standard table paragraph replacement, already-rendered table skip,
 * plain paragraph untouched, stylesheet injection, reasoning-block table
 * untouched (regression).
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: tag === 'fragment' ? 11 : 1,
    children: [],
    _text: '',
    className: attrs.className || '',
    style: {},
    dataset: {},
    parentNode: null,
    _listeners: {},
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
    removeEventListener(type, fn) {
      const arr = this._listeners[type] || []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    dispatchEvent(ev) {
      ev.target = ev.target || this
      let node = ev.target
      while (node) {
        for (const fn of node._listeners[ev.type] || []) fn.call(node, ev)
        node = node.parentNode
      }
      return true
    },
    appendChild(child) {
      // 真实 DOM 语义：已存在的子节点先移除再追加（移动）
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
    },
    replaceWith(...nodes) {
      const parent = this.parentNode
      if (!parent) return
      const i = parent.children.indexOf(this)
      if (i < 0) return
      const flat = []
      for (const n of nodes) {
        if (n && n.nodeType === 11) flat.push(...n.children)
        else flat.push(n)
      }
      parent.children.splice(i, 1, ...flat)
      this.parentNode = null
      flat.forEach((n) => {
        n.parentNode = parent
      })
    },
    setAttribute(k, v) {
      this[k] = v
    },
    getAttribute(k) {
      return this[k]
    },
    removeAttribute(k) {
      delete this[k]
    },
    querySelector(sel) {
      const walk = (els) => {
        for (const e of els) {
          if (e.matchesSel && e.matchesSel(sel)) return e
          const found = walk(e.children || [])
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
          walk(e.children || [])
        }
      }
      walk(this.children)
      return out
    },
    matchesSel(sel) {
      const hasClass = (c) => this.className.split(/\s+/).includes(c)
      if (sel === 'p.tzx-p') return this.tagName === 'P' && this.className === 'tzx-p'
      if (sel === 'div.tzx-md') return this.tagName === 'DIV' && this.className === 'tzx-md'
      if (sel === 'div.md-table-wide') return this.tagName === 'DIV' && this.className === 'md-table-wide'
      if (sel === 'div.tzx-md, div.md-table-wide') {
        return (
          (this.tagName === 'DIV' && this.className === 'tzx-md') ||
          (this.tagName === 'DIV' && this.className === 'md-table-wide')
        )
      }
      if (sel === '[data-conversation-scroll]') return this.dataset.conversationScroll === '1'
      if (sel === '[data-streaming]') return this.dataset.streaming === '1'
      if (sel === 'table') return this.tagName === 'TABLE'
      if (sel === 'table.tzx-table') return this.tagName === 'TABLE' && this.className === 'tzx-table'
      if (sel === 'table.dsh-md-render-table') return this.tagName === 'TABLE' && hasClass('dsh-md-render-table')
      if (sel === 'div.dsh-md-render-table-scroll')
        return this.tagName === 'DIV' && hasClass('dsh-md-render-table-scroll')
      if (sel === '.dsh-md-render-table-scroll') return this.tagName === 'DIV' && hasClass('dsh-md-render-table-scroll')
      if (sel === 'div.dsh-md-render-scroll-hint')
        return this.tagName === 'DIV' && hasClass('dsh-md-render-scroll-hint')
      if (sel === 'button.dsh-md-render-table-fold')
        return this.tagName === 'BUTTON' && hasClass('dsh-md-render-table-fold')
      if (sel === '.dsh-md-render-table-fold') return this.tagName === 'BUTTON' && hasClass('dsh-md-render-table-fold')
      if (sel === 'tr.dsh-md-render-folded-row') return this.tagName === 'TR' && hasClass('dsh-md-render-folded-row')
      if (sel === '.dsh-md-render-sort-arrow') return this.tagName === 'SPAN' && hasClass('dsh-md-render-sort-arrow')
      if (sel === 'th[data-sort-col]') return this.tagName === 'TH' && this['data-sort-col'] !== undefined
      if (sel === 'th[data-sorted]') return this.tagName === 'TH' && this['data-sorted'] !== undefined
      if (/^[a-z]+$/.test(sel)) return this.tagName === sel.toUpperCase()
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
  Object.defineProperty(el, 'classList', {
    get() {
      return {
        add: (c) => {
          const s = new Set(el.className.split(/\s+/).filter(Boolean))
          s.add(c)
          el.className = [...s].join(' ')
        },
        remove: (c) => {
          const s = new Set(el.className.split(/\s+/).filter(Boolean))
          s.delete(c)
          el.className = [...s].join(' ')
        },
        contains: (c) => el.className.split(/\s+/).includes(c),
      }
    },
  })
  Object.defineProperty(el, 'textContent', {
    get() {
      if (this.children.length === 0) return this._text
      return this.children.map((c) => c.textContent).join('')
    },
    set(v) {
      this._text = v
      this.children = []
    },
  })
  return el
}

class World {
  constructor() {
    this.styleTags = []
    this.scrollEl = null
    this.pNonStd = null
    this.renderedTable = null
    this.pPlain = null
    this.thinkTable = null
    this.markdownView = null
    this.exportsObj = null
    this.lastMarkdown = null
  }

  /** 加载 bundle 并导出 MarkdownView（统一渲染器，不 apply）。 */
  loadMarkdownView() {
    const stubbed = {
      createElement: (type, props, ...children) => ({
        type,
        props: { ...(props || {}), children: children.flat() },
      }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useSyncExternalStore: (_s, get) => get(),
    }
    let registered = null
    global.window = {
      location: { href: 'http://127.0.0.1:3080/app', search: '' },
      __ModuleLoader__: {
        load: (reg) => {
          registered = reg
        },
      },
    }
    global.document = undefined
    global.Element = function Element() {}
    global.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    }

    eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
    assert.ok(registered, 'bundle registered')
    const exportsObj = registered.factory((spec) => {
      if (spec === 'react') return stubbed
      throw new Error('unexpected require: ' + spec)
    })
    assert.equal(typeof exportsObj.MarkdownView, 'function', 'MarkdownView exported')
    this.markdownView = exportsObj.MarkdownView
    this.exportsObj = exportsObj
  }

  /** 调用 MarkdownView 渲染文本并收集元素树（函数组件展开）。 */
  renderMarkdown(text) {
    const tags = []
    const texts = []
    const codeLangs = []
    const mdCodeBlockDataThemes = []
    let mdCodeBlockWrappers = 0
    let mathSpans = 0
    let mathErrorSpans = 0
    let mathErrorBlocks = 0
    let mathFracs = 0
    let mathSqrts = 0
    let mathSupsubs = 0
    let mathBigs = 0
    let copyButtons = 0
    let tokenSpans = 0
    let langLabels = 0
    let checkboxes = 0
    let codeCopyInHead = 0
    let codeCopyBottom = 0
    /** 展开函数组件（CopyButton 等），返回最终 DOM 元素节点或 null。 */
    const expand = (node) => {
      let cur = node
      while (cur && typeof cur === 'object' && typeof cur.type === 'function') cur = cur.type(cur.props)
      return cur
    }
    /** 统计某容器直接子元素中的代码块复制按钮（展开后）。 */
    const countDirectCopyButtons = (container) => {
      const kids = Array.isArray(container.props.children)
        ? container.props.children
        : container.props.children !== undefined && container.props.children !== null
          ? [container.props.children]
          : []
      let n = 0
      for (const k of kids) {
        const el = expand(k)
        if (
          el &&
          typeof el === 'object' &&
          el.type === 'button' &&
          typeof el.props?.className === 'string' &&
          el.props.className.includes('dsh-md-render-copy')
        ) {
          n += 1
        }
      }
      return n
    }
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
      if (typeof node.type === 'string') {
        tags.push(node.type)
        if (node.type === 'div' && props.className === 'md-code-block') {
          mdCodeBlockWrappers += 1
          if (typeof props['data-theme'] === 'string') mdCodeBlockDataThemes.push(props['data-theme'])
          codeCopyBottom += countDirectCopyButtons(node)
        }
        if (node.type === 'div' && props.className === 'dsh-md-render-code-head') {
          codeCopyInHead += countDirectCopyButtons(node)
        }
        if (node.type === 'code' && typeof props.className === 'string') codeLangs.push(props.className)
        if (node.type === 'span' && props.className === 'dsh-md-render-math') mathSpans += 1
        // issue #82：公式结构计数（分数/根号/上下标/大符号）。
        if (node.type === 'span' && props.className === 'dsh-md-render-frac') mathFracs += 1
        if (node.type === 'span' && props.className === 'dsh-md-render-sqrt') mathSqrts += 1
        if (node.type === 'span' && props.className === 'dsh-md-render-supsub') mathSupsubs += 1
        if (node.type === 'span' && props.className === 'dsh-md-render-big') mathBigs += 1
        if (node.type === 'span' && props.className === 'dsh-md-render-math-error') mathErrorSpans += 1
        if (node.type === 'div' && props.className === 'dsh-md-render-math-error') mathErrorBlocks += 1
        if (
          node.type === 'button' &&
          typeof props.className === 'string' &&
          props.className.includes('dsh-md-render-copy')
        ) {
          copyButtons += 1
        }
        if (
          node.type === 'span' &&
          typeof props.className === 'string' &&
          props.className.startsWith('dsh-md-render-tok-')
        ) {
          tokenSpans += 1
        }
        if (
          node.type === 'span' &&
          typeof props.className === 'string' &&
          props.className.includes('dsh-md-render-code-lang')
        ) {
          langLabels += 1
        }
        if (node.type === 'input' && props.type === 'checkbox') checkboxes += 1
      } else if (typeof node.type === 'function') {
        walk(node.type(node.props))
        return
      }
      walk(props.children)
    }
    walk(this.markdownView({ text }))
    this.lastMarkdown = {
      tags,
      texts,
      codeLangs,
      mdCodeBlockWrappers,
      mdCodeBlockDataThemes,
      codeCopyInHead,
      codeCopyBottom,
      mathSpans,
      mathErrorSpans,
      mathErrorBlocks,
      mathFracs,
      mathSqrts,
      mathSupsubs,
      mathBigs,
      copyButtons,
      tokenSpans,
      langLabels,
      checkboxes,
    }
  }

  /** 设置渲染开关（issue #84）：等效 client apply 读取 ctx.config）。 */
  setRenderOptions(config) {
    assert.ok(this.exportsObj, 'bundle loaded before setting render options')
    this.exportsObj.setRenderOptions(config)
  }

  buildDom() {
    const scrollEl = makeElement('div')
    scrollEl.dataset.conversationScroll = '1'

    // 不标准表格段落（无首尾管道符）
    const md1 = makeElement('div', { className: 'tzx-md' })
    const pNonStd = makeElement('p', { className: 'tzx-p' })
    pNonStd.textContent = '插件 | 版本\n--- | ---\ndsh-file-activity | 0.4.2'
    md1.appendChild(pNonStd)
    scrollEl.appendChild(md1)
    this.pNonStd = pNonStd

    // 已渲染的表格（table.tzx-table）
    const md2 = makeElement('div', { className: 'tzx-md' })
    const renderedTable = makeElement('table', { className: 'tzx-table' })
    md2.appendChild(renderedTable)
    scrollEl.appendChild(md2)
    this.renderedTable = renderedTable

    // 普通文本段落
    const md3 = makeElement('div', { className: 'tzx-md' })
    const pPlain = makeElement('p', { className: 'tzx-p' })
    pPlain.textContent = '这是一段普通文本，不含表格。'
    md3.appendChild(pPlain)
    scrollEl.appendChild(md3)
    this.pPlain = pPlain

    // 思考块内已渲染的表格（reasoning 块同款结构：tzx-md 内 table.tzx-table）
    const md4 = makeElement('div', { className: 'tzx-md' })
    const thinkTable = makeElement('table', { className: 'tzx-table' })
    md4.appendChild(thinkTable)
    scrollEl.appendChild(md4)
    this.thinkTable = thinkTable

    // 长表格段落（25 行，issue #83 折叠场景）
    const md5 = makeElement('div', { className: 'tzx-md' })
    const pLong = makeElement('p', { className: 'tzx-p' })
    const longLines = ['名称 | 数值', '--- | ---']
    for (let i = 0; i < 25; i += 1) longLines.push(`行${i} | ${((i * 7) % 25) + 1}`)
    pLong.textContent = longLines.join('\n')
    md5.appendChild(pLong)
    scrollEl.appendChild(md5)
    this.pLong = pLong

    const bodyEl = makeElement('body')
    bodyEl.appendChild(scrollEl)
    this.scrollEl = scrollEl
    return bodyEl
  }

  loadAndApply(bodyEl) {
    this.loadForApply(bodyEl)
    this.exportsObj.apply({ effect: (fn) => fn() })
  }

  /** 设置 DOM 全局 + 加载 bundle（不 apply），保留 exportsObj 供后续使用。 */
  loadForApply(bodyEl) {
    const stubbed = {
      createElement: (type, props, ...children) => ({
        type,
        props: { ...(props || {}), children: children.flat() },
      }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useSyncExternalStore: (_s, get) => get(),
    }
    const world = this
    let registered = null
    global.window = {
      location: { href: 'http://127.0.0.1:3080/app', search: '' },
      __ModuleLoader__: {
        load: (reg) => {
          registered = reg
        },
      },
    }
    global.document = {
      body: bodyEl,
      head: {
        appendChild(el) {
          world.styleTags.push(el)
          return el
        },
        removeChild() {},
      },
      createElement(tag) {
        return makeElement(tag)
      },
      createElementNS(_ns, tag) {
        return makeElement(tag)
      },
      createTextNode(text) {
        return { nodeType: 3, textContent: text }
      },
      createDocumentFragment() {
        return makeElement('fragment')
      },
    }
    global.Element = function Element() {}
    global.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    }

    eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
    assert.ok(registered, 'bundle registered')
    const exportsObj = registered.factory((spec) => {
      if (spec === 'react') return stubbed
      throw new Error('unexpected require: ' + spec)
    })
    this.exportsObj = exportsObj
  }
}

setWorldConstructor(World)

After(async function () {
  delete global.window
  delete global.document
  delete global.Element
  delete global.MutationObserver
})

// ── Given ─────────────────────────────────────────────────────────────────
Given('渲染插件已启动且对话含不标准表格段落', async function () {
  const bodyEl = this.buildDom()
  this.loadAndApply(bodyEl)
})

Given('渲染插件已启动且对话含已渲染的表格', async function () {
  const bodyEl = this.buildDom()
  this.loadAndApply(bodyEl)
})

Given('渲染插件已启动且对话含普通文本段落', async function () {
  const bodyEl = this.buildDom()
  this.loadAndApply(bodyEl)
})

Given('渲染插件已启动且对话含思考块内已渲染的表格', async function () {
  const bodyEl = this.buildDom()
  this.loadAndApply(bodyEl)
})

Given('统一渲染器已加载', async function () {
  this.loadMarkdownView()
})

// ── When ──────────────────────────────────────────────────────────────────
When('渲染含分隔行的文本块', async function () {
  this.renderMarkdown('| 插件 | 版本 |\n|:-----|:----:|\n| dsh-file-activity | **0.4.2** |')
})

When('渲染含 mermaid 围栏的文本块', async function () {
  this.renderMarkdown('```mermaid\nflowchart TD\n    A --> B\n```')
})

When('渲染含行内公式的文本块', async function () {
  this.renderMarkdown('公式 $x^2 + y^2$ 测试')
})

When('渲染含分数命令的文本块', async function () {
  this.renderMarkdown('公式 $\\frac{a}{b}$ 与 $\\frac{x+1}{y-1}$')
})

When('渲染含根号命令的文本块', async function () {
  this.renderMarkdown('公式 $\\sqrt{x}$ 与 $\\sqrt{a+b}$')
})

When('渲染含上下标命令的文本块', async function () {
  this.renderMarkdown('公式 $x^2 + x_i + x_i^2$')
})

When('渲染含求和命令的文本块', async function () {
  this.renderMarkdown('公式 $\\sum_{i=1}^{n} i$ 与 $\\int_0^1 x dx$')
})

When('渲染含希腊字母命令的文本块', async function () {
  this.renderMarkdown('公式 $\\alpha + \\beta$ 与 $\\omega$')
})

When('渲染含无法解析公式的文本块', async function () {
  this.renderMarkdown('公式 $\\frac{a}{b$ 测试')
})

When('渲染含未闭合公式的文本块', async function () {
  this.renderMarkdown('公式 $x^2 测试')
})

When('渲染含空公式的文本块', async function () {
  this.renderMarkdown('$$\n$$')
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('段落被替换为表格元素', async function () {
  assert.equal(this.pNonStd.parentNode, null, 'original paragraph detached')
  const table = this.scrollEl.querySelector('table.dsh-md-render-table')
  assert.ok(table, 'table element rendered')
})

Then('表格包含表头与数据行', async function () {
  const table = this.scrollEl.querySelector('table.dsh-md-render-table')
  assert.ok(table, 'table element present')
  const thead = table.querySelector('thead')
  const tbody = table.querySelector('tbody')
  assert.ok(thead, 'thead rendered')
  assert.ok(tbody, 'tbody rendered')
  assert.equal(thead.querySelectorAll('th').length, 2, '2 header cells')
  assert.equal(tbody.querySelectorAll('td').length, 2, '2 data cells')
})

Then('表格外层有横向滚动容器', async function () {
  const scroll = this.scrollEl.querySelector('div.dsh-md-render-table-scroll')
  assert.ok(scroll, 'scroll container present')
  assert.ok(scroll.querySelector('table.dsh-md-render-table'), 'table inside scroll container')
})

Then('已渲染的表格保持原样', async function () {
  assert.equal(
    this.renderedTable.parentNode,
    this.scrollEl.querySelectorAll('div.tzx-md')[1],
    'rendered table untouched',
  )
})

Then('普通文本段落保持原样', async function () {
  assert.equal(this.pPlain.parentNode, this.scrollEl.querySelectorAll('div.tzx-md')[2], 'plain paragraph untouched')
  assert.equal(this.pPlain.textContent, '这是一段普通文本，不含表格。', 'plain paragraph text intact')
})

Then('页面注入包含表格规则的样式', async function () {
  assert.ok(this.styleTags.length === 1, 'stylesheet injected')
  assert.ok(this.styleTags[0].textContent.includes('.dsh-md-render-table'), 'stylesheet has table rules')
})

Then('思考块内的表格保持原样', async function () {
  assert.equal(
    this.thinkTable.parentNode,
    this.scrollEl.querySelectorAll('div.tzx-md')[3],
    'reasoning-block table untouched',
  )
})

Then('输出包含 table 标签', async function () {
  assert.ok(this.lastMarkdown.tags.includes('table'), `tags: ${this.lastMarkdown.tags.join(',')}`)
})

Then('输出包含表头与数据行', async function () {
  assert.ok(this.lastMarkdown.tags.includes('thead'), 'thead rendered')
  assert.ok(this.lastMarkdown.tags.includes('tbody'), 'tbody rendered')
  assert.ok(this.lastMarkdown.texts.includes('插件'), 'header cell text')
  assert.ok(this.lastMarkdown.texts.includes('dsh-file-activity'), 'data cell text')
})

Then('输出包含 md-code-block 容器', async function () {
  assert.ok(this.lastMarkdown.mdCodeBlockWrappers >= 1, 'md-code-block container rendered')
})

Then('代码块保留语言标记', async function () {
  assert.ok(this.lastMarkdown.codeLangs.includes('language-mermaid'), 'language class kept')
})

Then('输出包含公式元素', async function () {
  assert.equal(this.lastMarkdown.mathSpans, 1, 'inline math span rendered')
  // issue #82：x^2 渲染为上标结构（文本递归收集拼接保留内容）。
  assert.ok(this.lastMarkdown.texts.join('').includes('x2 + y2'), 'math content kept (flattened)')
})

Then('输出包含分数结构', async function () {
  assert.ok(this.lastMarkdown.mathFracs >= 1, 'frac structure rendered')
  assert.ok(this.lastMarkdown.texts.join('').includes('a'), 'frac numerator content kept')
  assert.ok(this.lastMarkdown.texts.join('').includes('b'), 'frac denominator content kept')
})

Then('输出包含根号结构', async function () {
  assert.ok(this.lastMarkdown.mathSqrts >= 1, 'sqrt structure rendered')
  assert.ok(this.lastMarkdown.texts.includes('√'), 'sqrt symbol rendered')
})

Then('输出包含上下标结构', async function () {
  assert.ok(this.lastMarkdown.mathSupsubs >= 3, 'sup/sub structures rendered')
  assert.ok(this.lastMarkdown.texts.join('').includes('x2'), 'superscript content kept')
  assert.ok(this.lastMarkdown.texts.join('').includes('xi'), 'subscript content kept')
})

Then('输出包含大符号结构', async function () {
  assert.ok(this.lastMarkdown.mathBigs >= 2, 'sum/int big structures rendered')
  assert.ok(this.lastMarkdown.texts.includes('∑'), 'sum symbol rendered')
  assert.ok(this.lastMarkdown.texts.includes('∫'), 'integral symbol rendered')
})

Then('输出包含希腊字母符号', async function () {
  const flat = this.lastMarkdown.texts.join('')
  assert.ok(flat.includes('α'), 'alpha symbol rendered')
  assert.ok(flat.includes('β'), 'beta symbol rendered')
  assert.ok(flat.includes('ω'), 'omega symbol rendered')
})

Then('输出不包含分数结构', async function () {
  assert.equal(this.lastMarkdown.mathFracs, 0, 'no frac structure for unparseable math')
})

Then('无法解析的公式原文保留', async function () {
  assert.ok(this.lastMarkdown.texts.join('').includes('\\frac{a}{b'), 'unparseable formula keeps original text')
})

Then('输出包含公式错误标记', async function () {
  assert.ok(
    this.lastMarkdown.mathErrorSpans > 0 || this.lastMarkdown.mathErrorBlocks > 0,
    `math error marker rendered (spans=${this.lastMarkdown.mathErrorSpans}, blocks=${this.lastMarkdown.mathErrorBlocks})`,
  )
})

Then('原始公式文本保留', async function () {
  assert.ok(
    this.lastMarkdown.texts.some((t) => t.includes('$x^2 测试')),
    'original formula text kept',
  )
})

Then('输出包含复制按钮', async function () {
  assert.ok(this.lastMarkdown.copyButtons >= 1, 'copy button rendered')
  assert.ok(this.lastMarkdown.texts.includes('复制'), 'button label 复制 rendered')
})

// ── issue #83：表头排序 + 长表格折叠 ─────────────────────────────────────
Given('渲染插件已启动且对话含超过 20 行的表格段落', async function () {
  const bodyEl = this.buildDom()
  this.loadAndApply(bodyEl)
})

When('点击展开按钮', async function () {
  const btn = this.scrollEl.querySelector('button.dsh-md-render-table-fold')
  assert.ok(btn, 'fold button present')
  btn.dispatchEvent({ type: 'click', target: btn })
})

When('点击表头', async function () {
  // 长表格是 buildDom 中最后渲染的表格（md5，25 行）
  const tables = this.scrollEl.querySelectorAll('table.dsh-md-render-table')
  const table = tables[tables.length - 1]
  assert.ok(table, 'long table present')
  const th = table.querySelector('th[data-sort-col]')
  assert.ok(th, 'sortable header present')
  th.dispatchEvent({ type: 'click', target: th })
})

Then('表格默认只显示前 20 行', async function () {
  const folded = this.scrollEl.querySelectorAll('tr.dsh-md-render-folded-row')
  assert.equal(folded.length, 5, '5 rows folded beyond the 20-row limit')
})

Then('表格下方有展开按钮', async function () {
  const btn = this.scrollEl.querySelector('button.dsh-md-render-table-fold')
  assert.ok(btn, 'fold button present')
  assert.ok(btn.textContent.includes('展开全部'), `button label: ${btn.textContent}`)
})

Then('表格显示全部行', async function () {
  const folded = this.scrollEl.querySelectorAll('tr.dsh-md-render-folded-row')
  assert.equal(folded.length, 0, 'no folded rows after expand')
})

Then('表格行按该列排序', async function () {
  const tables = this.scrollEl.querySelectorAll('table.dsh-md-render-table')
  const table = tables[tables.length - 1]
  const tbody = table.querySelector('tbody')
  const trs = tbody.querySelectorAll('tr')
  const first = trs[0].querySelectorAll('td')[1].textContent
  assert.equal(first, '1', 'ascending by numeric column')
})

Then('表头显示排序指示', async function () {
  const th = this.scrollEl.querySelector('th[data-sorted]')
  assert.ok(th, 'sorted header marked')
  const arrow = th.querySelector('.dsh-md-render-sort-arrow')
  assert.ok(arrow, 'sort arrow present')
  assert.equal(arrow.textContent, '↑', 'asc arrow')
})

// ── issue #84：渲染增强开关（设置页配置化）────────────────────────────
Given('渲染插件已启动且渲染开关 {string}', async function (spec) {
  this.loadMarkdownView()
  const [key, value] = parseSwitch(spec)
  this.setRenderOptions({ [key]: value })
})

Given('渲染插件已启动且渲染开关 {string} 且对话含超过 20 行的表格段落', async function (spec) {
  const bodyEl = this.buildDom()
  // 先加载 bundle（不 apply），设置开关，再 apply——扫描路径按新开关渲染
  this.loadForApply(bodyEl)
  const [key, value] = parseSwitch(spec)
  this.setRenderOptions({ [key]: value })
  this.exportsObj.apply({ effect: (fn) => fn() })
})

When('渲染含 js 代码块的文本块', async function () {
  this.renderMarkdown('```js\nconst x = "hi" // comment\n```')
})

When('渲染含任务列表标记的文本块', async function () {
  this.renderMarkdown('- [x] 已完成任务\n- [ ] 待办任务')
})

Then('输出不包含语法高亮 token span', async function () {
  assert.equal(this.lastMarkdown.tokenSpans, 0, 'no syntax highlight token spans')
})

Then('输出包含语法高亮 token span', async function () {
  assert.ok(this.lastMarkdown.tokenSpans > 0, 'syntax highlight token spans rendered')
})

Then('语言标签仍渲染', async function () {
  assert.ok(this.lastMarkdown.langLabels >= 1, 'language label still rendered')
})

Then('输出不包含复制按钮', async function () {
  assert.equal(this.lastMarkdown.copyButtons, 0, 'no copy buttons')
})

// ── issue #146：代码块复制按钮位置 + 代码主题 ───────────────────────
Then('代码块复制按钮位于代码块右下角', async function () {
  assert.ok(this.lastMarkdown.codeCopyBottom >= 1, 'copy button is a direct md-code-block child (bottom-right)')
})

Then('代码块复制按钮位于头部', async function () {
  assert.ok(this.lastMarkdown.codeCopyInHead >= 1, 'copy button in header (with language label)')
})

Then('代码块复制按钮不在头部', async function () {
  assert.equal(this.lastMarkdown.codeCopyInHead, 0, 'copy button not in header by default')
})

Then('代码块携带对应主题标记 data-theme={string}', async function (theme) {
  assert.ok(
    this.lastMarkdown.mdCodeBlockDataThemes.includes(theme),
    `md-code-block carries data-theme="${theme}" (got ${this.lastMarkdown.mdCodeBlockDataThemes.join(',')})`,
  )
})

Then('代码块不携带主题标记', async function () {
  assert.equal(this.lastMarkdown.mdCodeBlockDataThemes.length, 0, 'no data-theme on plain-text code block')
})

Then('输出不包含 checkbox', async function () {
  assert.equal(this.lastMarkdown.checkboxes, 0, 'no task checkboxes')
})

Then('任务标记文本保留', async function () {
  assert.ok(
    this.lastMarkdown.texts.some((t) => t.includes('[x]')),
    'task marker kept as literal text',
  )
})

Then('输出不包含公式元素', async function () {
  assert.equal(this.lastMarkdown.mathSpans, 0, 'no inline math span')
  assert.equal(this.lastMarkdown.mathErrorSpans, 0, 'no math error span')
  assert.equal(this.lastMarkdown.mathErrorBlocks, 0, 'no math error block')
})

Then('公式原文保留', async function () {
  assert.ok(
    this.lastMarkdown.texts.some((t) => t.includes('$x^2 + y^2$')),
    'formula text kept',
  )
})

Then('表格不渲染折叠行', async function () {
  const folded = this.scrollEl.querySelectorAll('tr.dsh-md-render-folded-row')
  assert.equal(folded.length, 0, 'no folded rows')
})

Then('表格不渲染展开按钮', async function () {
  const btn = this.scrollEl.querySelector('button.dsh-md-render-table-fold')
  assert.equal(btn, null, 'no fold button')
})

/**
 * 解析开关描述字符串（如 "syntaxHighlight=false" → ['syntaxHighlight',
 * false]）。issue #146：选择项（如 "codeTheme=one-dark"）传字符串原值。
 */
function parseSwitch(spec) {
  const eq = spec.indexOf('=')
  if (eq === -1) throw new Error(`bad switch spec: ${spec}`)
  const key = spec.slice(0, eq)
  const value = spec.slice(eq + 1)
  if (value === 'true') return [key, true]
  if (value === 'false') return [key, false]
  return [key, value]
}
