import { test } from 'vitest'
/**
 * Settings-panel toggle style tests (issue #58).
 *
 * 问题背景：开关关闭态此前用 --dsw-alias-bg-layer-3（浅色主题下≈白色），
 * 与设置面板背景几乎融为一体、边框又淡，用户难以一眼判断开关状态
 * （issue #58）。修复：关态改灰色轨道（label-tertiary 30% 混合，与
 * dsh-my-skill-manager-switch 一致），开态圆点改对比墨色
 * （label-primary-foreground）。
 *
 * 本套件为防复发测试：断言 toggle 样式规则**必须**是灰色轨道 + 对比圆点
 * 方案，且不得回退为 bg-layer-3 白底。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

/** Eval the settings part source in a factory scope and return SETTINGS_STYLES. */
function loadSettingsStyles() {
  // 片段按 build.mjs 顺序求值：i18n（含 eventLabelOf）→ card-preview →
  // copy-editor → webhook-settings → settings（settings 顶层引用 WEBHOOK_STYLES）
  const order = [
    'i18n',
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
  const factory = new Function(`${sources.join('\n')}\nreturn { SETTINGS_STYLES }`)
  return factory().SETTINGS_STYLES
}

/** STYLES with CSS comments stripped, so prose can't trip string asserts. */
const CSS = loadSettingsStyles().replace(/\/\*[\s\S]*?\*\//g, '')

const TOGGLE = '.dsh-my-notify-toggle{'
const TOGGLE_ON = '.dsh-my-notify-toggle[data-on="true"]{'
const TOGGLE_AFTER = '.dsh-my-notify-toggle::after{'
const TOGGLE_ON_AFTER = '.dsh-my-notify-toggle[data-on="true"]::after{'

test('off-state toggle uses a visible grey track, not a white layer-3 fill (issue #58)', () => {
  const start = CSS.indexOf(TOGGLE)
  const block = CSS.slice(start, CSS.indexOf('}', start) + 1)
  assert.ok(
    block.includes('color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent)'),
    'off track must be the grey tertiary mix',
  )
  assert.ok(!block.includes('bg-layer-3'), 'off track must not fall back to the invisible white layer-3 fill')
})

test('on-state toggle keeps the success accent and clears the border (issue #58)', () => {
  const start = CSS.indexOf(TOGGLE_ON)
  const block = CSS.slice(start, CSS.indexOf('}', start) + 1)
  assert.ok(block.includes('var(--dsw-alias-state-success-primary)'), 'on track must be the success accent')
  assert.ok(block.includes('border-color:transparent'), 'on state clears the border')
})

test('thumb sits on the left in off state with primary ink (issue #58)', () => {
  const start = CSS.indexOf(TOGGLE_AFTER)
  const block = CSS.slice(start, CSS.indexOf('}', start) + 1)
  assert.ok(block.includes('var(--dsw-alias-label-primary)'), 'off thumb must use primary ink on the grey track')
  assert.ok(!block.includes('translateX'), 'off thumb must not be translated')
})

test('on-state thumb slides right and switches to contrast ink (issue #58)', () => {
  const start = CSS.indexOf(TOGGLE_ON_AFTER)
  const block = CSS.slice(start, CSS.indexOf('}', start) + 1)
  assert.ok(block.includes('translateX(14px)'), 'on thumb must slide right 14px（36×20 轨道）')
  assert.ok(
    block.includes('var(--dsw-alias-label-primary-foreground)'),
    'on thumb must use foreground ink for contrast on the accent fill',
  )
})
