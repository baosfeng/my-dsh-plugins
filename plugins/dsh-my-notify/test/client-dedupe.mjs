/**
 * Client dedupe test for dsh-my-notify (issue #70 重复通知):
 * evals the i18n + render + stream parts in a stubbed factory scope and
 * asserts the client-side dedupe + cross-tab coordination:
 *  - same kind:sessionId within the window is handled once (local Map),
 *  - different keys are each handled,
 *  - two tabs sharing localStorage: only the first claims (cross-tab lock),
 *  - two tabs claiming concurrently: exactly one wins (Web Locks mutex) —
 *    regression for the TOCTOU race where a non-atomic get→check→set let
 *    every tab show the notification (real-browser double popup),
 *  - after the window expires the same key is handled again,
 *  - localStorage unavailable falls back to the local window.
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

/** In-memory localStorage stub; a single instance is shared across "tabs". */
function createStorageMock() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

/** Web Locks stub: per-name promise queue serializing callbacks across "tabs". */
function createLocksStub() {
  const queues = new Map() // name -> tail promise
  return {
    request(name, callback) {
      const prev = queues.get(name) || Promise.resolve()
      const next = prev.then(() => callback())
      queues.set(
        name,
        next.catch(() => {}),
      )
      return next
    },
  }
}

/** Minimal AudioContext stub: records construction, no-op graph. */
function createAudioStub() {
  const instances = []
  function MockAudioContext() {
    instances.push(this)
    this.currentTime = 0
    this.destination = {}
    this.resume = () => Promise.resolve()
    this.createOscillator = () => ({
      type: '',
      frequency: { value: 0 },
      connect() {},
      start() {},
      stop() {},
    })
    this.createGain = () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    })
  }
  return { MockAudioContext, instances }
}

/** Notification stub: records constructed notifications. */
function createNotificationStub() {
  const created = []
  function MockNotification(title, options) {
    created.push({ title, options })
    this.close = () => {}
  }
  MockNotification.permission = 'granted'
  MockNotification.requestPermission = () => Promise.resolve('granted')
  return { MockNotification, created }
}

/** Eval the shared icons + i18n + render + stream parts in a factory scope
 *  and return handleNotice / claimNotice. Each call is one independent
 *  "tab" (own localRecent Map); pass the same storage and/or locks stub to
 *  simulate tabs sharing browser storage / the Web Locks mutex. */
function loadParts({ storage, audio, notification, locks }) {
  const iconsSrc = fs.readFileSync(new URL('../../dsh-shared/client-parts/icons.part.js', import.meta.url), 'utf8')
  const i18nSrc = fs.readFileSync(new URL('../lib/parts/i18n.js', import.meta.url), 'utf8')
  const prefsSrc = fs.readFileSync(new URL('../lib/parts/prefs.js', import.meta.url), 'utf8')
  const runtimeconfigSrc = fs.readFileSync(new URL('../lib/parts/runtime-config.js', import.meta.url), 'utf8')
  const renderSrc = fs.readFileSync(new URL('../lib/parts/render.js', import.meta.url), 'utf8')
  const audioSrc = fs.readFileSync(new URL('../lib/parts/audio.js', import.meta.url), 'utf8')
  const toastSrc = fs.readFileSync(new URL('../lib/parts/toast.js', import.meta.url), 'utf8')
  const streamSrc = fs.readFileSync(new URL('../lib/parts/stream.js', import.meta.url), 'utf8')
  const windowMock = {
    localStorage: storage,
    AudioContext: audio.MockAudioContext,
    focus() {},
  }
  const navigatorMock = { language: 'zh-CN' }
  if (locks !== undefined) navigatorMock.locks = locks
  const factory = new Function(
    'createElement',
    'document',
    'navigator',
    'window',
    'Notification',
    'exports',
    `${iconsSrc}\n${i18nSrc}\n${prefsSrc}\n${runtimeconfigSrc}\n${renderSrc}\n${audioSrc}\n${toastSrc}\n${streamSrc}\nreturn { handleNotice, claimNotice }`,
  )
  return factory(createElement, undefined, navigatorMock, windowMock, notification.MockNotification, {})
}

/** One end notice frame (the shape server emits). */
function endNotice(sessionId) {
  return { type: 'notice', kind: 'end', sessionId, title: `标题-${sessionId}` }
}

test('同 kind:sessionId 窗口内只处理一次（本地去重）', async () => {
  const storage = createStorageMock()
  const audio = createAudioStub()
  const notification = createNotificationStub()
  const parts = loadParts({ storage, audio, notification })
  await parts.handleNotice(endNotice('s1'), undefined)
  await parts.handleNotice(endNotice('s1'), undefined)
  assert.equal(notification.created.length, 1, 'first frame notifies')
  assert.equal(audio.instances.length, 1, 'first frame beeps once')
})

test('不同 kind:sessionId 各自处理（不去重）', async () => {
  const storage = createStorageMock()
  const audio = createAudioStub()
  const notification = createNotificationStub()
  const parts = loadParts({ storage, audio, notification })
  await parts.handleNotice(endNotice('s1'), undefined)
  await parts.handleNotice(endNotice('s2'), undefined)
  await parts.handleNotice({ type: 'notice', kind: 'ask', sessionId: 's1' }, undefined)
  assert.equal(notification.created.length, 3, 'distinct keys each notify')
})

test('多标签页共享 localStorage：同一通知只由一个标签页处理', async () => {
  const storage = createStorageMock() // 两个「标签页」共享同一存储
  const locks = createLocksStub() // 共享同一 Web Locks 互斥（真实浏览器语义）
  const audioA = createAudioStub()
  const notificationA = createNotificationStub()
  const partsA = loadParts({ storage, audio: audioA, notification: notificationA, locks })
  const audioB = createAudioStub()
  const notificationB = createNotificationStub()
  const partsB = loadParts({ storage, audio: audioB, notification: notificationB, locks })
  await partsA.handleNotice(endNotice('s1'), undefined)
  await partsB.handleNotice(endNotice('s1'), undefined)
  assert.equal(notificationA.created.length, 1, 'tab A notifies')
  assert.equal(notificationB.created.length, 0, 'tab B stays silent')
  assert.equal(audioB.instances.length, 0, 'tab B does not beep')
})

test('多标签页并发 claim：同一通知只由一个标签页处理（Web Locks 互斥）', async () => {
  // 回归：原 localStorage get→set 非原子的 TOCTOU——两个标签页几乎同时
  // 收到同一帧时双双通过检查导致双弹（真实浏览器复现）。Web Locks 序列化
  // 回调后，并发到达也只有一个标签页持有锁并通过窗口检查。
  const storage = createStorageMock()
  const locks = createLocksStub()
  const audioA = createAudioStub()
  const notificationA = createNotificationStub()
  const partsA = loadParts({ storage, audio: audioA, notification: notificationA, locks })
  const audioB = createAudioStub()
  const notificationB = createNotificationStub()
  const partsB = loadParts({ storage, audio: audioB, notification: notificationB, locks })
  await Promise.all([partsA.handleNotice(endNotice('s1'), undefined), partsB.handleNotice(endNotice('s1'), undefined)])
  assert.equal(notificationA.created.length + notificationB.created.length, 1, 'concurrent tabs notify exactly once')
  assert.equal(audioA.instances.length + audioB.instances.length, 1, 'concurrent tabs beep exactly once')
})

test('窗口过期后同一 key 重新处理', async () => {
  let fakeNow = 1_000_000
  const origNow = Date.now
  Date.now = () => fakeNow
  try {
    const storage = createStorageMock()
    const audio = createAudioStub()
    const notification = createNotificationStub()
    const parts = loadParts({ storage, audio, notification })
    await parts.handleNotice(endNotice('s1'), undefined)
    fakeNow += 3000 // 超过 2000ms 客户端窗口
    await parts.handleNotice(endNotice('s1'), undefined)
    assert.equal(notification.created.length, 2, 'after the window the same key notifies again')
  } finally {
    Date.now = origNow
  }
})

test('localStorage 不可用时本地窗口兜底', async () => {
  const storage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
  }
  const audio = createAudioStub()
  const notification = createNotificationStub()
  const parts = loadParts({ storage, audio, notification })
  await parts.handleNotice(endNotice('s1'), undefined)
  await parts.handleNotice(endNotice('s1'), undefined)
  assert.equal(notification.created.length, 1, 'local window still dedupes')
})
