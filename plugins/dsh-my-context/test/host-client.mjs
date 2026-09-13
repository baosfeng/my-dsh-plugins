/**
 * Client bundle smoke test (issue #87).
 *
 * 客户端 lib/client.js 是 __ModuleLoader__ 格式构建产物（client.src.js +
 * lib/parts/ 片段经 scripts/build.mjs 拼接）。本测试用最小 React 桩加载
 * bundle、校验注册契约，并用组件工厂生成本地渲染树——确保 4 个片段拼接
 * 后无符号引用错误、页签注册成功、面板顶层结构可渲染。完整 GUI 渲染依赖
 * 真实浏览器（见需求清单 R10 手动验证），此处不模拟 hooks/fetch。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 最小 React 桩：捕获元素，不执行 hooks（useEffect 不触发副作用）。 */
function reactStub() {
  function createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  }
  function useState(initial) {
    return [initial, () => {}]
  }
  function useEffect() {
    return undefined
  }
  return { createElement, useEffect, useState }
}

test('client bundle: loads, injects native sidebar services, registers tab type, renders panel root', () => {
  const seen = {}
  const windowMock = {
    __ModuleLoader__: {
      load: (def) => {
        seen.def = def
      },
    },
  }
  globalThis.window = windowMock

  const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
  new Function('window', code)(windowMock)

  assert.ok(seen.def, 'module loader load called')
  assert.equal(seen.def.id, 'dsh-my-context')
  const exports = seen.def.factory(reactStub)
  assert.deepEqual(exports.inject, ['slots', 'sidebarRightTabs'])

  const disposers = []
  let type
  let body
  const ctx = {
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    slots: {
      inject: (name, factory) => factory(),
      register(descriptor, component) {
        if (descriptor.name === 'sidebar.right.pane.tab') body = component
        return () => {}
      },
    },
    sidebarRightTabs: {
      register(definition) {
        type = definition
        return () => {}
      },
    },
  }
  // 不抛错，样式注入在无 document 时降级为 noop；页签类型与席位注册成功。
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(type.id, 'dsh-my-context')
  assert.equal(type.kind, 'dsh-my-context:context')

  // 原生席位适配层生成 ContextPanel 元素；渲染函数组件本体，顶层为 dso-panel div。
  const element = body({ sessionId: 'sess-1', useTabInfo: () => ({ tab: { visible: true } }) })
  assert.equal(typeof element.type, 'function')
  const tree = element.type(element.props)
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'dso-panel')

  // 溢出预警 UI 片段已拼接进 bundle（防 build.mjs/parts 组装回归）。
  const bundleSrc = readFileSync(join(root, 'lib/client.js'), 'utf8')
  for (const fn of [
    'function ContextUsageCard',
    'function CompressSuggestions',
    'function OverflowSection',
    'function OverflowSettings',
  ]) {
    assert.ok(bundleSrc.includes(fn), `bundle should include ${fn}`)
  }
  assert.ok(bundleSrc.includes('dso-usage-fill'), 'overflow usage style class present')
  assert.ok(bundleSrc.includes('dso-overflow-alert'), 'overflow level badge class present')

  for (const dispose of disposers) dispose()
  delete globalThis.window
})
