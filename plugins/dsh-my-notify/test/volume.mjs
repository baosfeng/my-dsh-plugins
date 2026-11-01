/**
 * Sound-volume tests (issue #71).
 *
 * 问题背景：提示音峰值增益固定 0.18（18% 音量），完成时几乎听不见；
 * 且无音量配置。修复：新增 localStorage 配置 dsh-notify:volume（0~1，
 * 默认 0.6），beep() 峰值增益按配置缩放；设置面板新增音量滑杆。
 *
 * 本套件为防复发测试：断言 prefVolume 默认值/读写/非法回退、beep 峰值
 * 增益按音量缩放、设置面板音量滑杆渲染（range + 百分比）。
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

/** In-memory localStorage stub. */
function createStorageStub(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

/** Eval the i18n + render parts in a factory scope and return internals. */
function loadParts(storage, audioCtxFactory) {
  const i18nSrc = fs.readFileSync(new URL('../lib/parts/i18n.js', import.meta.url), 'utf8')
  const runtimeconfigSrc = fs.readFileSync(new URL('../lib/parts/runtime-config.js', import.meta.url), 'utf8')
  const renderSrc = fs.readFileSync(new URL('../lib/parts/render.js', import.meta.url), 'utf8')
  const audioSrc = fs.readFileSync(new URL('../lib/parts/audio.js', import.meta.url), 'utf8')
  const toastSrc = fs.readFileSync(new URL('../lib/parts/toast.js', import.meta.url), 'utf8')
  const prefsSrc = fs.readFileSync(new URL('../lib/parts/prefs.js', import.meta.url), 'utf8')
  const windowObj = { localStorage: storage }
  if (audioCtxFactory !== undefined) windowObj.AudioContext = audioCtxFactory
  const factory = new Function(
    'createElement',
    'document',
    'navigator',
    'window',
    `${i18nSrc}\n${prefsSrc}\n${runtimeconfigSrc}\n${renderSrc}\n${audioSrc}\n${toastSrc}\nreturn { prefVolume, prefOn, LS, beep, baseAudio }`,
  )
  return factory(createElement, {}, { language: 'zh-CN' }, windowObj)
}

/** Eval the settings part and return VolumeRow（片段序与 build.mjs 一致）。 */
function loadSettings(storage) {
  const order = [
    'i18n',
    'prefs',
    'runtime-config',
    'render',
    'audio',
    'toast',
    'card-preview',
    'copy-model',
    'template-editor',
    'var-tree',
    'copy-events',
    'preview-band',
    'copy-editor',
    'card-designer',
    'webhook-editor',
    'webhook-settings',
    'settings-rows',
    'present-pane',
    'secure-pane',
    'settings-styles',
    'settings',
  ]
  const sources = order.map((name) => fs.readFileSync(new URL(`../lib/parts/${name}.js`, import.meta.url), 'utf8'))
  const factory = new Function(
    'createElement',
    'document',
    'navigator',
    'window',
    `${sources.join('\n')}\nreturn { VolumeRow }`,
  )
  return factory(createElement, {}, { language: 'zh-CN' }, { localStorage: storage })
}

/** Fake AudioContext recording gain ramps. */
function createAudioStub() {
  const ramps = []
  const gain = {
    gain: {
      setValueAtTime() {},
      exponentialRampToValueAtTime(v) {
        ramps.push(v)
      },
    },
  }
  const ac = {
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
    createGain: () => gain,
  }
  return { ac, ramps }
}

test('prefVolume 默认 0.6（issue #71：0.18 太小听不见）', () => {
  const { prefVolume } = loadParts(createStorageStub())
  assert.equal(prefVolume(), 0.6)
})

test('prefVolume 读取 localStorage 配置值', () => {
  const { prefVolume } = loadParts(createStorageStub({ 'dsh-notify:volume': '0.3' }))
  assert.equal(prefVolume(), 0.3)
})

test('prefVolume 边界值 0 与 1 均合法', () => {
  const zero = loadParts(createStorageStub({ 'dsh-notify:volume': '0' }))
  assert.equal(zero.prefVolume(), 0)
  const full = loadParts(createStorageStub({ 'dsh-notify:volume': '1' }))
  assert.equal(full.prefVolume(), 1)
})

test('prefVolume 非法值回退默认 0.6（非数字/越界/存储异常）', () => {
  assert.equal(loadParts(createStorageStub({ 'dsh-notify:volume': 'abc' })).prefVolume(), 0.6)
  assert.equal(loadParts(createStorageStub({ 'dsh-notify:volume': '-1' })).prefVolume(), 0.6)
  assert.equal(loadParts(createStorageStub({ 'dsh-notify:volume': '2' })).prefVolume(), 0.6)
  assert.equal(loadParts(createStorageStub({ 'dsh-notify:volume': 'NaN' })).prefVolume(), 0.6)
  // 存储抛异常（如隐私模式）→ 回退默认
  const throwing = {
    getItem() {
      throw new Error('denied')
    },
  }
  assert.equal(loadParts(throwing).prefVolume(), 0.6)
})

test('beep 峰值增益按音量配置缩放（默认 0.6，不再固定 0.18）', async () => {
  const { ac, ramps } = createAudioStub()
  // 普通函数（非箭头）才能被 new 调用（baseAudio 中 new AC()）
  const { beep } = loadParts(createStorageStub(), function () {
    return ac
  })
  await beep()
  // 峰值 = ramps 中第一个非 0.0001 的值
  const peak = ramps.find((v) => v > 0.001)
  assert.equal(peak, 0.6, 'default peak gain must be 0.6')
})

test('beep 峰值增益跟随自定义音量（0.3）', async () => {
  const { ac, ramps } = createAudioStub()
  const { beep } = loadParts(createStorageStub({ 'dsh-notify:volume': '0.3' }), function () {
    return ac
  })
  await beep()
  const peak = ramps.find((v) => v > 0.001)
  assert.equal(peak, 0.3, 'peak gain must follow the configured volume')
})

test('设置面板音量滑杆：range 输入 + 百分比显示', () => {
  const { VolumeRow } = loadSettings(createStorageStub())
  const row = VolumeRow({ label: '提示音音量', hint: '调节提示音大小', value: 0.6, onChange: () => {} })
  assert.equal(row.type, 'div')
  assert.equal(row.props.className, 'dsh-my-notify-row')
  const children = Array.isArray(row.props.children) ? row.props.children : [row.props.children]
  const input = children.find((c) => c.type === 'input')
  assert.ok(input !== undefined, 'range input present')
  assert.equal(input.props.type, 'range')
  assert.equal(input.props.min, '0')
  assert.equal(input.props.max, '1')
  assert.equal(input.props.step, '0.05')
  assert.equal(input.props.value, '0.6')
  const valueEl = children.find((c) => c.type === 'div' && c.props.className === 'dsh-my-notify-range-value')
  assert.ok(valueEl !== undefined, 'percentage value element present')
  assert.equal(valueEl.props.children, '60%')
})

test('设置面板音量滑杆 onChange 传数值（0.65 → 65%）', () => {
  const { VolumeRow } = loadSettings(createStorageStub())
  let received = null
  const row = VolumeRow({ label: '提示音音量', hint: '', value: 0.6, onChange: (v) => (received = v) })
  const children = Array.isArray(row.props.children) ? row.props.children : [row.props.children]
  const input = children.find((c) => c.type === 'input')
  input.props.onChange({ target: { value: '0.65' } })
  assert.equal(received, 0.65, 'onChange receives the numeric volume')
})
