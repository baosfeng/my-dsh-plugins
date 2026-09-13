import { test } from 'vitest'
/**
 * Regression tests for the sidebar tab selected-state styling (issues #25/#60).
 *
 * issue #25 曾给侧边栏页签选中态注入品牌蓝覆盖，使用全局子串选择器
 * `[class*="tab"][class*="tabActive"]`。该规则会误伤宿主（DSH 官方 GUI）中
 * 任何 class 名含 "tab"/"tabActive" 的元素——包括对话/工作区 tab 的选中态，
 * 出现用户不想要的蓝色高亮（issue #60）。issue #60 决定移除该覆盖，页签
 * 选中态回归宿主原生样式（issue #187 批 2：本插件不再覆盖）。
 *
 * 本套件是 issue #60 的防复发测试：断言 STYLES **不包含**任何针对
 * tab/tabActive 的品牌蓝覆盖规则。若未来重新引入此类全局覆盖，测试即红灯。
 *
 * The parts are plain text spliced into the client bundle factory scope, so
 * this suite evals the styles part source and asserts on the CSS text.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

/** Eval the styles part source in a factory scope and return STYLES. */
function loadStyles() {
  const src = fs.readFileSync(new URL('../lib/parts/styles.part.js', import.meta.url), 'utf8')
  const factory = new Function(`${src}\nreturn { STYLES }`)
  return factory().STYLES
}

const STYLES = loadStyles()

/** STYLES with CSS comments stripped, so prose can't trip string asserts. */
const CSS = STYLES.replace(/\/\*[\s\S]*?\*\//g, '')

test('no brand-blue override targets any element with tab/tabActive class (issue #60)', () => {
  // issue #60: 全局子串选择器会误伤宿主对话/工作区 tab 选中态（蓝色高亮）。
  // 任何针对 tab/tabActive 的背景/颜色覆盖都禁止出现。
  assert.ok(
    !/\[class\*="tab"\]/.test(CSS),
    'no global [class*="tab"] rule allowed (it bleeds into host tab selected states)',
  )
  assert.ok(
    !/\[class\*="tabActive"\]/.test(CSS),
    'no global [class*="tabActive"] rule allowed (it bleeds into host tab selected states)',
  )
})

test('no brand fill (business-primary) remains in the stylesheet (issue #60)', () => {
  // 品牌蓝填充随 #25 的覆盖一起移除；残留的 business-primary 背景规则
  // 说明旧覆盖又回来了。
  const rules = CSS.split('}').filter((chunk) => chunk.includes('business-primary'))
  assert.equal(rules.length, 0, 'no business-primary background/color rules remain')
})

test('no !important sneaks into the stylesheet (issue #25 spirit)', () => {
  // 保持 #25 的工程约束：无 !important，样式覆盖一律靠选择器结构。
  assert.ok(!CSS.includes('!important'), 'no !important in file-activity styles')
})
