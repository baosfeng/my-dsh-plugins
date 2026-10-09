/**
 * 合并后的硬约束静态断言（issue #463，机器可校验）。
 *
 * 用户硬约束（最高优先级）：「合并后**只做 markdown 内容的渲染**……其他一律保持
 * 官方默认样式」。本文件把可机器校验的部分钉死，防止后续改动悄悄越界：
 *
 *  1. **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  2. **不读 React fiber 私有属性**（__reactFiber$ / memoizedProps）；
 *  3. **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  4. **单 MutationObserver**（合并前 md-render 与 mermaid 各装一个）；
 *  5. 不出现自绘助手节点 / 自绘思考块（ThinkBlock / AssistantStepView）。
 *
 * 断言对象是**构建产物** lib/client.js：注释先剔除（避免「注释里写了禁令」被误判），
 * 剩余文本同时覆盖代码与字符串字面量 —— 本文件的断言正是靠字面量命中。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** 剔除块注释与行注释后的产物文本。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const CODE = stripComments(RAW)

test('client bundle：不注册任何 conversation.chat.node 节点级 seat', () => {
  assert.equal(CODE.includes('conversation.chat.node'), false, 'must not register node-level seats')
  assert.equal(CODE.includes('assistant-step'), false, 'must not shadow the assistant-step renderer')
  // slots 扩展点只允许 settings.plugins.tab（list / replaceRisk none）
  const injected = [...CODE.matchAll(/inject\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(injected, ['settings.plugins.tab'], 'only the additive settings tab seat is injected')
})

test('client bundle：不读 React fiber 私有属性', () => {
  assert.equal(CODE.includes('__reactFiber'), false, 'no React fiber private property reads')
  assert.equal(CODE.includes('memoizedProps'), false, 'no memoizedProps reads')
  assert.equal(CODE.includes('fiberKeys'), false, 'no fiber walking helpers')
})

test('client bundle：不对官方元素写 style / class / aria', () => {
  // style 写入只允许插件自建的 textarea（复制兜底）
  const styleWrites = [...CODE.matchAll(/\b([A-Za-z_$][\w$]*)\.style\./g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(styleWrites)],
    ['ta'],
    'the only inline style target is the plugin-owned fallback textarea',
  )
  assert.equal(CODE.includes('cssText'), false, 'no cssText writes (offscreen host uses a class)')
  assert.equal(/classList\.(add|remove|toggle)/.test(CODE), false, 'no classList mutation anywhere')
  // setAttribute 目标白名单：插件自有 data-* 标记 + 自有组件属性
  const attrs = [...CODE.matchAll(/\.setAttribute\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  const allowed = new Set([
    'data-context-text',
    'data-dsh-md-render-context',
    'data-dsh-md-render-context-body',
    'data-signature',
    'data-dsh-md-render-text-view',
    'data-dsh-md-render-text-sig',
    'data-dsh-md-render-mermaid',
    'data-dsh-md-render-mermaid-state',
    'data-dsh-md-render-mermaid-view',
    'data-dsh-md-render-offscreen',
    'data-dsh-md-render-settings',
    'data-dsh-md-render',
    'aria-pressed',
    'aria-label',
    'aria-checked',
    'aria-hidden',
    'role',
    'readonly',
  ])
  for (const name of attrs) assert.ok(allowed.has(name), 'unexpected setAttribute target: ' + name)
  // 官方 pre 的隐藏改由自有 CSS 规则完成（类选择器），不再写 el.style.display
  assert.equal(CODE.includes('style.display'), false, 'official <pre> is hidden by plugin CSS, not inline style')
})

test('client bundle：单 MutationObserver（合并前两路观察收敛为一路）', () => {
  assert.equal((RAW.match(/new MutationObserver/g) ?? []).length, 1, 'exactly one MutationObserver')
  assert.equal((CODE.match(/function installDomScanner\(/g) ?? []).length, 1, 'exactly one scanner skeleton')
  assert.equal((CODE.match(/function installScanner\(/g) ?? []).length, 1, 'exactly one scanner assembly')
})

test('client bundle：不含自绘助手节点 / 自绘思考块 / 旧包名', () => {
  for (const banned of ['ThinkBlock', 'AssistantStepView', 'stripControlTags', 'renderBlocks', 'dsh-think-zh-expand']) {
    assert.equal(CODE.includes(banned), false, 'must not contain ' + banned)
  }
  assert.equal(CODE.includes('applyThinkExpand'), true, 'think expand is present')
  assert.ok(CODE.includes('.click'), 'think expand dispatches a real click')
  assert.equal(CODE.includes('applyThinkExpand(el)'), true, 'the scanner calls the think expander')
})

test('client bundle：不内联 mermaid 引擎（走 assets 静态路由）', () => {
  assert.equal(CODE.includes('/md-render/assets/mermaid-10.9.3.min.js'), true, 'engine served from the assets route')
})
