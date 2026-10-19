/**
 * 交互件（B 路）静态断言 + 纯函数/行为单测 —— 不依赖整体 bundle。
 *
 * 覆盖：
 *  · copy.ts：clipboard → execCommand 兜底通道、idle/copied/failed 三态文案与类名；
 *  · think.ts：只对宿主折叠行派发一次官方 click（默认展开开关、幂等、已展开不碰）；
 *  · context-markdown.ts：pre[data-context-text="true"] 契约、来源提取、哈希签名；
 *  · lang-switch.ts：图表 / Markdown / 源码 三态控件 + 点击派发块级事件；
 *  · image-lightbox.ts：原生 dialog 灯箱、图片地址安全白名单、点击代理幂等；
 *  · 全路纪律：不 classList / cssText / el.style / innerHTML，setAttribute 只用自有标记。
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

function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

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
    document: undefined,
    ...globals,
  }
  vm.createContext(sandbox)
  vm.runInContext(compiled, sandbox)
  return { exports, sandbox }
}

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
    querySelector() {
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
    contains() {
      return true
    },
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
    select() {},
    showModal() {
      this.open = true
    },
    close() {
      this.open = false
    },
  }
  return el
}

// ── ① copy：通道 / 三态 ───────────────────────────────────────────────────

test('copy：clipboard 优先；拒绝后回退 execCommand；两条都不通才 reject', async () => {
  const written = []
  const ok = loadPart('copy.ts', {
    navigator: {
      clipboard: {
        writeText(text) {
          written.push(text)
          return Promise.resolve()
        },
      },
    },
  })
  await ok.exports.copyText('abc')
  assert.deepEqual(written, ['abc'], '走 clipboard API')

  const sinkDocument = (execOk) => {
    const body = {
      appendChild(node) {
        node.parentNode = body
      },
      removeChild(node) {
        node.parentNode = null
      },
    }
    return {
      body,
      execCommand: () => execOk,
      createElement: () => ({
        value: '',
        className: '',
        parentNode: null,
        setAttribute() {},
        select() {},
      }),
    }
  }
  const fallback = loadPart('copy.ts', {
    navigator: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    document: sinkDocument(true),
  })
  await fallback.exports.copyText('xyz')
  assert.equal(fallback.sandbox.exports.fallbackCopyText('xyz'), true, 'execCommand 兜底可用')
  const denied = loadPart('copy.ts', {
    navigator: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    document: sinkDocument(false),
  })
  await assert.rejects(() => denied.exports.copyText('nope'), /copy failed/, '两条通道都失败 → reject')
})

test('copy：三态文案与类名（is-copied / is-failed，不用 classList）', () => {
  const { exports } = loadPart('copy.ts')
  assert.equal(exports.mdrCopyLabel('idle'), '复制', 'idle')
  assert.equal(exports.mdrCopyLabel('copied'), '已复制', 'copied')
  assert.equal(exports.mdrCopyLabel('failed'), '复制失败', 'failed')
  assert.equal(exports.mdrCopyClassName('idle', 'mdr-fence-copy'), 'mdr-btn mdr-copy mdr-fence-copy', '基类 + 外部类')
  assert.ok(exports.mdrCopyClassName('copied', undefined).includes('is-copied'), '成功态类')
  assert.ok(exports.mdrCopyClassName('failed', undefined).includes('is-failed'), '失败态类')
  assert.equal(exports.MDR_COPY_RESET_MS, 1600, '1.6s 后回 idle')
  assert.equal(typeof exports.MdrCopyButton, 'function', 'MdrCopyButton 导出')
})

// ── ② think：宿主折叠行派发官方 click ────────────────────────────────────

function thinkRow(expanded) {
  const row = {
    clicks: 0,
    _attrs: { 'aria-expanded': expanded ? 'true' : 'false' },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null
    },
    click() {
      this.clicks += 1
    },
    querySelectorAll() {
      return []
    },
  }
  return row
}

test('think：只对折叠行派发一次 click，已展开行与重复调用都不碰', () => {
  const folded = thinkRow(false)
  const opened = thinkRow(true)
  const rows = [folded, opened]
  const { exports } = loadPart('think.ts', {
    renderOptions: { thinking: { defaultExpanded: true } },
    document: { querySelectorAll: () => rows },
  })
  assert.ok(exports.THINK_ROW_SELECTOR.includes('[data-disclosure-row][aria-expanded]'), '官方折叠行选择器')
  assert.ok(exports.THINK_ROW_SELECTOR.includes('[data-variant="think"]'), '思考块作用域')
  exports.applyThinkExpand()
  assert.equal(folded.clicks, 1, '折叠行派发一次官方 click')
  assert.equal(opened.clicks, 0, '已展开行不碰')
  exports.applyThinkExpand()
  assert.equal(folded.clicks, 1, 'WeakSet 幂等（用户手动折叠后不再展开）')
})

test('think：默认展开开关关闭 → 零动作；支持 scanner 传入根节点', () => {
  const folded = thinkRow(false)
  const off = loadPart('think.ts', {
    renderOptions: { thinking: { defaultExpanded: false } },
    document: { querySelectorAll: () => [folded] },
  })
  off.exports.applyThinkExpand()
  assert.equal(folded.clicks, 0, '开关关闭不展开')

  const scoped = thinkRow(false)
  const on = loadPart('think.ts', {
    renderOptions: { thinking: { defaultExpanded: true } },
  })
  on.exports.applyThinkExpand({ querySelectorAll: () => [scoped] })
  assert.equal(scoped.clicks, 1, '根内新增行照常展开')
})

// ── ③ context：标注头 / 来源 / 哈希 ──────────────────────────────────────

test('context：宿主 pre 契约 + 标注头文案 + 来源来自 [data-context-source]', () => {
  const source = codeOnly(readPart('context-markdown.ts'))
  assert.ok(source.includes('pre[data-context-text="true"]'), '宿主 pre 契约选择器')
  assert.ok(source.includes('上下文注入'), '标注头文案')
  assert.ok(source.includes('[data-context-source]'), '来源读取宿主 producer 标记')
  assert.ok(source.includes("'按 markdown 渲染'"), '渲染方式徽标')
  assert.ok(source.includes('function mountMdrContext('), 'mountMdrContext 导出面')
  assert.ok(source.includes('MDR_CONTEXT_BODY_CLASS'), 'markdown 正文容器')

  const { exports } = loadPart('context-markdown.ts')
  const host = { nodeType: 1, parentNode: null, querySelector: () => null, getAttribute: () => null }
  const ancestor = { nodeType: 1, parentNode: null, querySelector: () => ({ textContent: ' code-reviewer ' }) }
  host.parentNode = ancestor
  assert.equal(exports.mdrContextSourceOf(host), 'code-reviewer', '来源取宿主 producer 名并去空白')
  assert.equal(
    exports.mdrContextSourceOf({ nodeType: 1, parentNode: null, querySelector: () => null }),
    '',
    '无来源 → 空',
  )
  assert.equal(exports.contextHash('abc'), exports.contextHash('abc'), '哈希稳定')
  assert.notEqual(exports.contextHash('abc'), exports.contextHash('abd'), '内容变化 → 签名变化')
})

// ── ④ lang-switch：三态控件 + 事件 ──────────────────────────────────────

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init !== undefined ? init.detail : undefined
    this.bubbles = init !== undefined ? init.bubbles : false
  }
}

test('lang-switch：图表 / Markdown / 源码 三态 + 点击派发块级事件', () => {
  const { exports } = loadPart('lang-switch.ts', {
    icon: { chart: () => ({ icon: 'chart' }), markdown: () => ({ icon: 'markdown' }), code: () => ({ icon: 'code' }) },
    CustomEvent: FakeCustomEvent,
  })
  assert.equal(Array.from(exports.MDR_RENDER_OPTIONS, (item) => item.label).join('/'), '图表/Markdown/源码', '三态标签')
  const control = exports.MdrLangSwitchFrom({ current: 'markdown' })
  assert.equal(control.type, 'span', '控件根')
  assert.equal(control.props.className, 'mdr-rm', '分段外框')
  assert.equal(control.children.length, 3, '三个选项')
  const active = control.children.find((item) => item.props['data-mdr-option'] === 'markdown')
  assert.ok(String(active.props.className).includes('is-active'), '当前项 .is-active')
  assert.equal(active.props['aria-pressed'], 'true', '当前项 aria-pressed')
  const idle = control.children.find((item) => item.props['data-mdr-option'] === 'source')
  assert.equal(idle.props['aria-pressed'], 'false', '非当前项 aria-pressed=false')

  const host = {
    attrs: {},
    event: null,
    setAttribute(key, value) {
      this.attrs[key] = value
    },
    dispatchEvent(event) {
      this.event = event
      return true
    },
  }
  const target = { closest: (selector) => (selector === 'div.md-code-block' ? host : null) }
  const diagram = control.children.find((item) => item.props['data-mdr-option'] === 'diagram')
  diagram.props.onClick({ currentTarget: target })
  assert.equal(host.attrs['data-mdr-switch'], 'diagram', '点击写块级标记')
  assert.equal(host.event.type, 'mdr-lang-switch', '派发块级事件')
  assert.equal(host.event.detail.value, 'diagram', '事件携带目标视图')
  assert.equal(typeof exports.MdrLangSwitch, 'function', 'MdrLangSwitch 导出')
})

// ── ⑤ image-lightbox：安全白名单 / 点击代理幂等 ─────────────────────────

test('image-lightbox：图片地址安全白名单（http(s) / 同源相对，其余拒绝）', () => {
  const { exports } = loadPart('image-lightbox.ts')
  assert.ok(exports.mdrSafeImageSrc('https://a.test/x.png').startsWith('https://'), 'https')
  assert.equal(exports.mdrSafeImageSrc('http://a.test/x.png'), 'http://a.test/x.png', 'http')
  assert.equal(exports.mdrSafeImageSrc('/assets/x.png'), '/assets/x.png', '绝对路径')
  assert.equal(exports.mdrSafeImageSrc('./x.png'), './x.png', '相对路径')
  assert.equal(exports.mdrSafeImageSrc('javascript:alert(1)'), '', '拒绝 javascript:')
  assert.equal(exports.mdrSafeImageSrc('data:image/png;base64,xx'), '', '拒绝 data:')
  assert.equal(exports.mdrSafeImageSrc(''), '', '空地址')
})

test('image-lightbox：点击代理只绑一次 + 原生 dialog 打开大图', () => {
  const body = fakeElement('body')
  const { exports } = loadPart('image-lightbox.ts', {
    document: {
      body,
      createElement: (tag) => fakeElement(tag),
    },
  })
  const host = fakeElement('div')
  exports.mountMdrLightbox(host)
  exports.mountMdrLightbox(host)
  assert.equal(host._listeners.click.length, 1, '同一容器只绑定一次')

  const img = fakeElement('img')
  img.setAttribute('src', '/assets/x.png')
  img.setAttribute('alt', '示意图')
  img.closest = (selector) => (selector === 'img' ? img : null)
  host._listeners.click[0]({ target: img })
  assert.equal(body._children.length, 1, '打开一个灯箱')
  const dialog = body._children[0]
  assert.equal(dialog.className, 'mdr-lightbox', '灯箱 dialog 类名')
  assert.equal(dialog._children[0]._children[0].src, '/assets/x.png', '大图地址')
  assert.equal(dialog.open, true, '以模态打开')
  exports.closeImageLightbox()
  assert.equal(body._children.length, 0, '关闭后移除 dialog')
})

// ── ⑥ 全路纪律：写操作只走 setAttribute 白名单 ──────────────────────────

test('B 路纪律：不 classList / cssText / el.style / innerHTML；setAttribute 只用自有标记', () => {
  const files = [
    'styles-code.ts',
    'own-code.ts',
    'block-render.ts',
    'copy.ts',
    'think.ts',
    'context-markdown.ts',
    'lang-switch.ts',
    'image-lightbox.ts',
  ]
  const allowedExact = new Set(['readonly'])
  for (const file of files) {
    const source = readPart(file)
    const code = codeOnly(source)
    assert.equal(/classList/.test(code), false, file + ' 不写 classList')
    assert.equal(/cssText/.test(code), false, file + ' 不写 cssText')
    assert.equal(/\.style\./.test(code), false, file + ' 不写 el.style')
    assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(code), false, file + ' 不拼 HTML')
    const attrs = [...code.matchAll(/\.setAttribute\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
    for (const attr of attrs) {
      assert.ok(
        attr.startsWith('data-mdr-') || attr.startsWith('aria-') || allowedExact.has(attr),
        file + ' 的 setAttribute 目标在白名单内：' + attr,
      )
    }
  }
})
