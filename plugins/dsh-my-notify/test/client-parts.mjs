/**
 * Client render-path test for the dsh-my-notify toast (issue #54 UI 翻新):
 * evals the i18n + render parts in a stubbed factory scope and asserts the
 * toast DOM structure:
 *  - every class name uses the dsh-my-notify- prefix (no dn-/dns- regression),
 *  - per-kind type icons: end=clock / ask=help / approval=check / remote=external,
 *  - close button carries an aria-label and only dismisses (no session jump),
 *  - open-session button carries the external icon + label and opens the session,
 *  - dismiss plays the exit animation before removing the node.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

/** Stub createElement mirroring React's single-child / array-child semantics. */
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

/** Minimal DOM stub: enough for buildToastItem / elementToDom. */
function createDomStub() {
  const make = (tag) => ({
    tagName: tag,
    className: '',
    attrs: {},
    children: [],
    parentNode: null,
    textContent: '',
    setAttribute(k, v) {
      this.attrs[k] = String(v)
    },
    appendChild(c) {
      this.children.push(c)
      c.parentNode = this
    },
    classList: { add() {} },
    addEventListener() {},
    querySelector() {
      return null
    },
  })
  return {
    createElement: (tag) => make(tag),
    createElementNS: (_ns, tag) => make(tag),
    createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
  }
}

/** Eval the shared icons + i18n + render parts in a factory scope and
 *  return its internals. The icon set is read from the dsh-shared package
 *  (single source of truth, issue #54 阶段 0). */
function loadParts() {
  const iconsSrc = fs.readFileSync(new URL('../../dsh-shared/client-parts/icons.part.js', import.meta.url), 'utf8')
  const i18nSrc = fs.readFileSync(new URL('../lib/parts/i18n.js', import.meta.url), 'utf8')
  const runtimeconfigSrc = fs.readFileSync(new URL('../lib/parts/runtime-config.js', import.meta.url), 'utf8')
  const renderSrc = fs.readFileSync(new URL('../lib/parts/render.js', import.meta.url), 'utf8')
  const audioSrc = fs.readFileSync(new URL('../lib/parts/audio.js', import.meta.url), 'utf8')
  const toastSrc = fs.readFileSync(new URL('../lib/parts/toast.js', import.meta.url), 'utf8')
  const dom = createDomStub()
  const factory = new Function(
    'createElement',
    'document',
    'navigator',
    'window',
    `${iconsSrc}\n${i18nSrc}\n${runtimeconfigSrc}\n${renderSrc}\n${audioSrc}\n${toastSrc}\nreturn { buildToastItem, kindIcon, kindIconClass, attachToastEvents }`,
  )
  return factory(createElement, dom, { language: 'zh-CN' }, {})
}

const { buildToastItem, kindIcon, kindIconClass, attachToastEvents } = loadParts()

/** Element-type sequence of an icon's children (e.g. ['circle','path']). */
function iconShape(iconEl) {
  assert.equal(iconEl.type, 'svg', 'kind icon is an <svg> element')
  const children = Array.isArray(iconEl.props.children) ? iconEl.props.children : [iconEl.props.children]
  return children.map((c) => c.type)
}

/** Find a descendant whose className equals the given value. */
function findByClass(root, cls) {
  const walk = (el) => {
    if (el.className === cls) return el
    for (const c of el.children) {
      const hit = walk(c)
      if (hit !== null) return hit
    }
    return null
  }
  return walk(root)
}

test('toast 全部类名使用 dsh-my-notify- 前缀（无 dn-/dns- 残留）', () => {
  const item = buildToastItem({ kind: 'end', sessionId: 's1', title: '标题', note: '备注' })
  assert.equal(item.className, 'dsh-my-notify-toast')
  const walk = (el) => {
    if (el.className !== '') {
      assert.ok(el.className.startsWith('dsh-my-notify-'), `class "${el.className}" must use the dsh-my-notify- prefix`)
    }
    for (const c of el.children) walk(c)
  }
  walk(item)
})

test('类型图标映射：end=clock / ask=help / approval=check / remote=external', () => {
  assert.deepEqual(iconShape(kindIcon('end')), ['circle', 'path'], 'end → clock')
  assert.deepEqual(iconShape(kindIcon('ask')), ['circle', 'path', 'line'], 'ask → help')
  assert.deepEqual(iconShape(kindIcon('approval')), ['polyline'], 'approval → check')
  assert.deepEqual(iconShape(kindIcon('remote')), ['path', 'polyline', 'line'], 'remote → external')
  assert.deepEqual(iconShape(kindIcon('unknown')), ['path', 'polyline', 'line'], 'unknown kind falls back to external')
})

test('类型图标颜色语义类', () => {
  assert.equal(kindIconClass('end'), 'dsh-my-notify-toast-icon-end')
  assert.equal(kindIconClass('ask'), 'dsh-my-notify-toast-icon-ask')
  assert.equal(kindIconClass('approval'), 'dsh-my-notify-toast-icon-approval')
  assert.equal(kindIconClass('remote'), 'dsh-my-notify-toast-icon-remote')
})

test('toast 头部含类型图标与关闭按钮（aria-label）', () => {
  const item = buildToastItem({ kind: 'ask', sessionId: 's2', title: '需要回答', note: '' })
  const iconWrap = findByClass(item, 'dsh-my-notify-toast-icon dsh-my-notify-toast-icon-ask')
  assert.ok(iconWrap !== null, 'type icon wrapper present')
  assert.equal(iconWrap.children[0].tagName, 'svg', 'icon wrapper holds an svg')
  const closeBtn = findByClass(item, 'dsh-my-notify-toast-close')
  assert.ok(closeBtn !== null, 'close button present')
  assert.equal(closeBtn.attrs['aria-label'], '关闭通知', 'close button has aria-label')
  assert.equal(closeBtn.children[0].tagName, 'svg', 'close button holds the close icon')
})

test('toast 含打开会话操作按钮（external 图标 + 文字）', () => {
  const item = buildToastItem({ kind: 'approval', sessionId: 's3', title: '等待批准', note: 'bash' })
  const openBtn = findByClass(item, 'dsh-my-notify-toast-open')
  assert.ok(openBtn !== null, 'open-session button present')
  assert.equal(openBtn.children[0].tagName, 'svg', 'open button holds the external icon')
  assert.equal(openBtn.children[1].textContent, '打开会话', 'open button carries the label text')
})

test('关闭按钮只关闭不跳转；打开按钮跳转；退场动画后移除节点', () => {
  const timers = []
  const origSetTimeout = global.setTimeout
  const origClearTimeout = global.clearTimeout
  global.setTimeout = (fn) => {
    timers.push(fn)
    return timers.length
  }
  global.clearTimeout = () => {}
  try {
    const closeBtn = {
      handlers: {},
      addEventListener(n, f) {
        closeBtn.handlers[n] = f
      },
    }
    const openBtn = {
      handlers: {},
      addEventListener(n, f) {
        openBtn.handlers[n] = f
      },
    }
    let removed = false
    const item = {
      parentNode: {
        removeChild() {
          removed = true
        },
      },
      handlers: {},
      classes: new Set(),
      classList: { add: (c) => item.classes.add(c) },
      addEventListener(n, f) {
        item.handlers[n] = f
      },
      querySelector(sel) {
        if (sel === '.dsh-my-notify-toast-close') return closeBtn
        if (sel === '.dsh-my-notify-toast-open') return openBtn
        return null
      },
    }
    let opened = 0
    attachToastEvents(item, () => {
      opened += 1
    })
    const stop = () => {}
    const prevent = () => {}

    // 关闭按钮：只关闭不跳转，播放退场动画
    closeBtn.handlers.click({ stopPropagation: stop, preventDefault: prevent })
    assert.equal(opened, 0, 'close button must not open the session')
    assert.ok(item.classes.has('dsh-my-notify-toast-out'), 'dismiss adds the exit-animation class')
    assert.equal(timers.length, 2, 'auto-dismiss + exit-animation timers scheduled')
    timers[1]()
    assert.equal(removed, true, 'exit animation removes the toast node')

    // 打开按钮：关闭 + 跳转
    const item2 = {
      parentNode: { removeChild() {} },
      handlers: {},
      classes: new Set(),
      classList: { add: (c) => item2.classes.add(c) },
      addEventListener(n, f) {
        item2.handlers[n] = f
      },
      querySelector(sel) {
        if (sel === '.dsh-my-notify-toast-close') return closeBtn
        if (sel === '.dsh-my-notify-toast-open') return openBtn
        return null
      },
    }
    let opened2 = 0
    attachToastEvents(item2, () => {
      opened2 += 1
    })
    openBtn.handlers.click({ stopPropagation: stop, preventDefault: prevent })
    assert.equal(opened2, 1, 'open button opens the session')
    assert.ok(item2.classes.has('dsh-my-notify-toast-out'), 'open button also dismisses with the exit animation')
  } finally {
    global.setTimeout = origSetTimeout
    global.clearTimeout = origClearTimeout
  }
})
