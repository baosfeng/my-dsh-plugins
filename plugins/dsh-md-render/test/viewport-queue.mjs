/**
 * 增量渲染：视口队列（viewport-queue.ts）
 *
 * 判据（全部走真产物 lib/client.js 导出的函数）：
 *  · 无 IntersectionObserver → 同步降级（老宿主 / 精简环境行为与改造前一致）；
 *  · 有 IO → 只登记不渲染，元素进入视口才执行；
 *  · 同一元素同一 key 覆盖（内容变了只渲染最新一次），不同 key 按登记顺序执行；
 *  · 已在视口内的元素再次登记 → **同步**执行（流式块零延迟）；
 *  · 元素脱离文档 / dispose 之后 → 不执行；dispose 会断开 observer。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createPage,
  createReactStub,
  createRenderStack,
  installGlobals,
  loadBundle,
  makeElement,
} from './support/fake-dom.mjs'

/** 假 IntersectionObserver：记录实例与观察目标，测试里手动派发 entries。 */
function installIoStub() {
  const instances = []
  globalThis.IntersectionObserver = class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.targets = new Set()
      this.disconnected = false
      instances.push(this)
    }
    observe(target) {
      this.targets.add(target)
    }
    unobserve(target) {
      this.targets.delete(target)
    }
    disconnect() {
      this.disconnected = true
      this.targets.clear()
    }
    fire(entries) {
      this.callback(entries)
    }
  }
  return instances
}

/** 启动一份 bundle（真实产物）。 */
function boot() {
  const page = createPage(makeElement('body'))
  installGlobals(page)
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  return { page, exports: loaded.exports }
}

test('① 没有 IntersectionObserver 时同步降级（老宿主行为不变）', () => {
  delete globalThis.IntersectionObserver
  const { exports } = boot()
  exports.installViewportQueue()
  const ran = []
  exports.enqueueWhenVisible(makeElement('div'), 'fence', () => ran.push('fence'))
  assert.deepEqual(ran, ['fence'], '降级路径必须同步执行')
  exports.disposeViewportQueue()
})

test('② 有 IO 时只登记不渲染，进入视口才执行一次', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  assert.equal(instances.length, 1, '单例 observer')
  assert.equal(instances[0].options.rootMargin, '400px 0px', '预取边距')
  assert.equal(instances[0].options.root, null, '以视口为根（滚动容器裁剪会被算进 intersectionRect）')

  const block = makeElement('div')
  const ran = []
  exports.enqueueWhenVisible(block, 'fence', () => ran.push(1))
  assert.deepEqual(ran, [], '未进入视口前不渲染')
  assert.equal(instances[0].targets.has(block), true, '已登记观察')

  instances[0].fire([{ target: block, isIntersecting: true }])
  assert.deepEqual(ran, [1], '进入视口执行一次')
  exports.disposeViewportQueue()
})

test('③ 同一元素同一 key 覆盖，不同 key 按登记顺序执行', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  const block = makeElement('div')
  const order = []
  exports.enqueueWhenVisible(block, 'fence', () => order.push('fence-old'))
  exports.enqueueWhenVisible(block, 'fence', () => order.push('fence-new'))
  exports.enqueueWhenVisible(block, 'lang', () => order.push('lang'))

  instances[0].fire([{ target: block, isIntersecting: true }])
  assert.deepEqual(order, ['fence-new', 'lang'], '同 key 覆盖、跨 key 保持登记顺序')
  exports.disposeViewportQueue()
})

test('④ 已在视口内的元素再次登记 → 同步执行（流式块零延迟）', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  const block = makeElement('div')
  let count = 0
  exports.enqueueWhenVisible(block, 'fence', () => (count += 1))
  instances[0].fire([{ target: block, isIntersecting: true }])
  assert.equal(count, 1)

  exports.enqueueWhenVisible(block, 'fence', () => (count += 1))
  assert.equal(count, 2, '可见态的再次登记不再等一帧')
  exports.disposeViewportQueue()
})

test('⑤ 单块渲染抛错不影响同批其它块', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  const a = makeElement('div')
  const b = makeElement('div')
  const ran = []
  exports.enqueueWhenVisible(a, 'fence', () => {
    throw new Error('boom')
  })
  exports.enqueueWhenVisible(b, 'fence', () => ran.push('b'))
  instances[0].fire([
    { target: a, isIntersecting: true },
    { target: b, isIntersecting: true },
  ])
  assert.deepEqual(ran, ['b'], '一个块失败不能拦住后面的块')
  exports.disposeViewportQueue()
})

test('⑥ 元素脱离文档 / dispose 之后不再执行', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  const gone = makeElement('div')
  gone.isConnected = false
  const ran = []
  exports.enqueueWhenVisible(gone, 'fence', () => ran.push('gone'))
  instances[0].fire([{ target: gone, isIntersecting: true }])
  assert.deepEqual(ran, [], '脱离文档的元素不渲染')

  const alive = makeElement('div')
  exports.enqueueWhenVisible(alive, 'fence', () => ran.push('alive'))
  exports.disposeViewportQueue()
  assert.equal(instances[0].disconnected, true, 'dispose 断开 observer')
  instances[0].fire([{ target: alive, isIntersecting: true }])
  assert.deepEqual(ran, [], 'dispose 之后不再渲染')

  exports.enqueueWhenVisible(makeElement('div'), 'fence', () => ran.push('late'))
  assert.deepEqual(ran, [], 'teardown 后的新登记直接丢弃（不回写 DOM）')
})

test('⑤ 滚出视口再滚回：会重新登记并再次渲染', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  const block = makeElement('div')
  let count = 0
  exports.enqueueWhenVisible(block, 'fence', () => (count += 1))
  instances[0].fire([{ target: block, isIntersecting: true }])
  assert.equal(count, 1)
  // 滚出视口：可见集合移除，但不 unregister（observer 仍观察）
  instances[0].fire([{ target: block, isIntersecting: false }])
  // 内容变化后重新登记 → 不可见，先挂起
  exports.enqueueWhenVisible(block, 'fence', () => (count += 1))
  assert.equal(count, 1, '离开视口后重新登记不立刻渲染')
  instances[0].fire([{ target: block, isIntersecting: true }])
  assert.equal(count, 2, '滚回视口后补渲染')
  exports.disposeViewportQueue()
})

test('⑥ 双挂载：引用计数保证旧 fiber 的 teardown 不会拆掉新 fiber 的队列', () => {
  const instances = installIoStub()
  const { exports } = boot()
  exports.installViewportQueue()
  exports.installViewportQueue() // 新 fiber 装配
  exports.disposeViewportQueue() // 旧 fiber 卸载
  const block = makeElement('div')
  let count = 0
  exports.enqueueWhenVisible(block, 'fence', () => (count += 1))
  instances[0].fire([{ target: block, isIntersecting: true }])
  assert.equal(count, 1, '队列仍工作')
  exports.disposeViewportQueue()
  assert.equal(instances[0].disconnected, true, '最后一个持有者释放才断开')
})
