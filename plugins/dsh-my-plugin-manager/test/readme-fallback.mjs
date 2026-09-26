/**
 * README 渲染内核的取用契约（issue #299 / #428）。
 *
 * 迁移前的三级链是 dsh-md-render → 平台官方 MarkdownText → 本插件 <pre>，其中第一级
 * 属于**跨特性插件取值**：官方明令禁止（packages/client/AGENTS.md:37）特性插件
 * runtime-import 彼此的值，也禁止用 dsh.client.external 获取。本插件与 #428 一致，
 * 把外部内核级显式旁路（external 指向平台模块 + 不存在的导出名），只留两级真降级：
 *   1) 宿主 staticModules 的官方 MarkdownText（平台 seed 模块，零安装零体积）
 *   2) 本插件 <pre class="dsh-my-plugin-manager-readme-plain">（原文不丢、不抛错）
 *
 * 这里断言的是「产物到底 require 了什么」——即防复发的关键面。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const CLIENT_SRC = fs.readFileSync(new URL('../lib/client.src.js', import.meta.url), 'utf8')
const CLIENT_OUT = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const PLATFORM_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

global.window = {
  __ModuleLoader__: { load: (registration) => (global.__registered = registration) },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
eval(CLIENT_OUT)
const factory = global.__registered.factory

/** 记录 factory 真实请求过的模块名；dsh-md-render 若被请求则返回一个可辨识的 stub。 */
function bootFactory({ platform, mdRender } = {}) {
  const required = []
  const exportsObj = factory((spec) => {
    required.push(spec)
    if (spec === 'react') return { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} }
    if (spec === PLATFORM_MODULE) {
      if (platform instanceof Error) throw platform
      return platform
    }
    if (spec === 'dsh-md-render') return mdRender
    throw new Error('unexpected require: ' + spec)
  })
  return { required, exportsObj }
}

const PLATFORM_STUB = { MarkdownText: (props) => props }

test('渲染内核只取官方 baseline 模块，绝不跨插件 require 特性插件', () => {
  const mdCalls = []
  const { required } = bootFactory({
    platform: PLATFORM_STUB,
    mdRender: { MarkdownView: (props) => mdCalls.push(props) },
  })
  assert.ok(required.includes(PLATFORM_MODULE), '请求了平台 seed 模块')
  assert.ok(!required.includes('dsh-md-render'), '即使宿主装了 dsh-md-render 也不请求（官方禁止跨插件取值）')
  assert.equal(mdCalls.length, 0, 'dsh-md-render 的 MarkdownView 未被触碰')
})

test('平台模块缺失时 factory 仍能加载（真降级，不是加载期抛错）', () => {
  const { required, exportsObj } = bootFactory({
    platform: new Error("Cannot find module '" + PLATFORM_MODULE + "'"),
  })
  assert.ok(required.includes(PLATFORM_MODULE), '尝试过平台模块')
  assert.equal(typeof exportsObj.apply, 'function', 'factory 仍导出 apply（缺内核不挂加载）')
  assert.ok(!required.includes('dsh-md-render'), '降级路径不再回落到跨插件内核')
})

test('产物源码不含 dsh-md-render 的 require，也不含 dsh.client.external 声明', () => {
  for (const [label, source] of [
    ['client.src.js', CLIENT_SRC],
    ['client.js', CLIENT_OUT],
  ]) {
    assert.ok(!source.includes("require('dsh-md-render')"), `${label} 不含 dsh-md-render require`)
    assert.ok(!source.includes('externalDegraded'), `${label} 不含非官方字段 externalDegraded`)
  }
  assert.ok(CLIENT_SRC.includes("externalExport: 'externalRendererDisabled'"), '共享件的跨插件内核级被显式旁路')
})

test('产物保留本插件自己的兜底契约（<pre> 标记 + class）', () => {
  assert.ok(CLIENT_OUT.includes('data-dsh-my-plugin-manager-fallback'), '兜底标记属性注入产物')
  assert.ok(CLIENT_OUT.includes('dsh-my-plugin-manager-readme-plain'), '兜底 class 注入产物')
})
