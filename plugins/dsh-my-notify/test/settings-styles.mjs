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
    'panel-styles',
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

/**
 * 防复发：样式表结构完整性（真实事故，提交 ae5b9085 引入）。
 *
 * 简版面板改造时删掉了结尾的一个 }，浏览器把其后大量规则当成未闭合块内部
 * 内容；实测 CSSOM：修复前 97 条规则、@media 内 167 条、.dsh-my-notify-p-head
 * 计算样式退回 display:block（整页无样式）；修复后 249 条规则、@media 内 16 条、
 * head 恢复 display:flex;gap:24px。
 *
 * 既有 4 条断言只查单条规则内容（indexOf + slice），少一个 } 时全绿，
 * 所以「整段被吞」必须靠结构级断言守。
 */
test('样式表花括号严格配平，且没有多余的 }', () => {
  const styles = loadSettingsStyles().replace(/\/\*[\s\S]*?\*\//g, '')
  const stack = []
  for (let i = 0; i < styles.length; i += 1) {
    if (styles[i] === '{') stack.push(i)
    else if (styles[i] === '}') {
      assert.ok(stack.length > 0, `第 ${i} 个字符处出现多余的 }，其后的规则会被吞进上一个块`)
      stack.pop()
    }
  }
  assert.equal(stack.length, 0, `有 ${stack.length} 个未闭合的 {，样式会被浏览器截断`)
  assert.equal((styles.match(/{/g) ?? []).length, (styles.match(/}/g) ?? []).length, '{ 与 } 数量必须相等')
})

test('每个 @media / @container 块都能在样式表内闭合', () => {
  const styles = loadSettingsStyles().replace(/\/\*[\s\S]*?\*\//g, '')
  const atRules = [...styles.matchAll(/@(media|container)\b[^{]*/g)].map((m) => ({ at: m.index, head: m[0].trim() }))
  assert.ok(atRules.length > 0, '样式表里应当有 at-rule 块')
  for (const { at, head } of atRules) {
    let inner = 0
    let closed = -1
    for (let i = at; i < styles.length; i += 1) {
      if (styles[i] === '{') inner += 1
      else if (styles[i] === '}') {
        inner -= 1
        if (inner === 0) {
          closed = i
          break
        }
      }
    }
    assert.ok(closed > at, `${head} 未在样式表内闭合（后续规则会被全部吞进该块）`)
  }
})

test('简版面板关键规则位于顶层（没被未闭合的 at-rule 吞掉）', () => {
  const styles = loadSettingsStyles().replace(/\/\*[\s\S]*?\*\//g, '')
  // 事故特征：这些顶层规则曾被吞进 @media(max-width:900px) 内部
  const wanted = [
    '.dsh-my-notify-p-head{',
    '.dsh-my-notify-p-tabs{',
    '.dsh-my-notify-p-grid{',
    '.dsh-my-notify-p-preview{',
    '.dsh-my-notify-p-actions{',
    '.dsh-my-notify-row{',
    '.dsh-my-notify-btn{',
    '.dsh-my-notify-toggle{',
  ]
  for (const sel of wanted) {
    const at = styles.indexOf(sel)
    assert.ok(at >= 0, `${sel} 必须存在于样式表`)
    let depth = 0
    for (let i = 0; i < at; i += 1) {
      if (styles[i] === '{') depth += 1
      else if (styles[i] === '}') depth -= 1
    }
    assert.equal(depth, 0, `${sel} 必须位于顶层（实际深度 ${depth}，说明被前面的 at-rule 吞了）`)
  }
})
