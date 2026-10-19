/**
 * 设置页（C 路）静态断言 + 纯函数单测。
 *
 * 判据来源：docs/md渲染/重构契约.md §一（注册不变）/§四/§五 + 原型
 * （docs/原型重构/dsh-md-render.html 3843–4064 + CSS 2070–2356）。
 *
 * 覆盖：
 *  · STYLES_SETTINGS：双 tab、分组头（图标 + 计数徽标）、开关行（.mdr-switch 44×26）、
 *    说明块、底部保存 / 恢复默认 / 已保存；颜色只取宿主语义变量；
 *  · MdrSettingsView 导出、渲染/关于双 tab、三组开关覆盖全部配置键、PUT 保存、恢复默认；
 *  · 注册契约不变：id='md-render-settings' / order=90 / key='dsh-md-render'；
 *  · 交互纪律：不写 classList / cssText / el.style，不新增右侧栏页签；
 *  · 纯函数：开关取值默认开、默认草稿全覆盖。不依赖 lib/client.js。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const SETTINGS_FILES = [
  'src/client/parts/styles-settings.ts',
  'src/client/settings/strings.ts',
  'src/client/settings/view.ts',
  'src/client/settings/index.ts',
]
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const RAW = SETTINGS_FILES.map(read).join('\n')
const CODE = SETTINGS_FILES.map((file) => stripComments(read(file))).join('\n')
const SETTINGS_CSS = read('src/client/parts/styles-settings.ts')
const VIEW = read('src/client/settings/view.ts')
const INDEX = read('src/client/settings/index.ts')

// ── 纯函数抽取（与 mdr-mermaid.mjs 同一手法：只取纯函数体做等价执行）───────
function balancedIndex(source, start, open, close) {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const c = source[i]
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  throw new Error('unbalanced ' + open + ' from ' + String(start))
}

function stripParamTypes(params) {
  let out = ''
  let depth = 0
  let current = ''
  const flush = () => {
    const trimmed = current.trim()
    if (trimmed !== '') {
      const colon = trimmed.indexOf(':')
      out += (out === '' ? '' : ', ') + (colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed)
    }
  }
  for (const ch of params) {
    if (ch === '{' || ch === '(' || ch === '[') depth += 1
    if (ch === '}' || ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      flush()
      current = ''
      continue
    }
    current += ch
  }
  flush()
  return out
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, 'function ' + name + ' not found')
  const parenStart = source.indexOf('(', start)
  const parenEnd = balancedIndex(source, parenStart, '(', ')')
  // 返回类型可能是对象字面量（如 : { w: number; h: number }）：跳过类型里的花括号。
  let braceStart = source.indexOf('{', parenEnd)
  let braceEnd = balancedIndex(source, braceStart, '{', '}')
  let next = braceEnd + 1
  while (next < source.length && /\s/.test(source[next])) next += 1
  if (source[next] === '{') {
    braceStart = next
    braceEnd = balancedIndex(source, braceStart, '{', '}')
  }
  const params = stripParamTypes(source.slice(parenStart + 1, parenEnd))
  return 'function ' + name + '(' + params + ') ' + source.slice(braceStart, braceEnd + 1)
}

function loadPure(functionNames, source) {
  const code = functionNames.map((name) => extractFunction(source, name)).join('\n')
  return new Function(code + '\nreturn { ' + functionNames.join(', ') + ' }')()
}

// ── 样式几何与配色口径 ──────────────────────────────────────────────────
test('styles-settings：导出 STYLES_SETTINGS 且关键几何照原型', () => {
  assert.match(SETTINGS_CSS, /const STYLES_SETTINGS: string = `/)
  const required = [
    '.mdr-set-head{display:flex;align-items:flex-start;gap:10px;padding:14px 20px 12px',
    '.mdr-set-tabs{display:flex;align-items:center;gap:12px;padding:10px 20px',
    '.mdr-set-group-head{display:flex;align-items:center;gap:8px;padding:10px 14px',
    '.mdr-set-group-head .mdr-pill{margin-left:auto}',
    '.mdr-set-row{display:flex;align-items:flex-start;gap:12px;padding:10px 14px',
    '.mdr-set-row .mdr-switch{width:44px;height:26px',
    '.mdr-set-note{',
    '.mdr-set-actions{',
    '.mdr-set-save{',
    '.mdr-set-reset{',
    '.mdr-set-saved{',
    '.mdr-set-panel[hidden]{display:none}',
  ]
  for (const snippet of required) assert.ok(SETTINGS_CSS.includes(snippet), 'missing css: ' + snippet)
})

test('styles-settings：颜色只取宿主语义变量（无裸十六进制）', () => {
  assert.equal(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/.test(SETTINGS_CSS), false, 'no bare hex colors')
  assert.equal(SETTINGS_CSS.includes('--shiki-token-'), false, 'no shiki palette')
  assert.ok(SETTINGS_CSS.includes('var(--dsw-alias-'), 'uses host semantic tokens')
})

test('交互纪律：不写 classList / cssText / el.style / 新 sidebarRightTabs', () => {
  assert.equal(/classList\.(add|remove|toggle|contains)/.test(CODE), false, 'no classList mutation')
  assert.equal(CODE.includes('cssText'), false, 'no cssText writes')
  assert.equal(/\b[A-Za-z_$][\w$]*\.style\./.test(CODE), false, 'no inline style writes')
  assert.equal(CODE.includes('sidebarRightTabs'), false, 'no right-sidebar tabs')
})

// ── 视图结构 ───────────────────────────────────────────────────────────
test('视图：MdrSettingsView 导出 + 渲染 / 关于 双 tab', () => {
  assert.ok(VIEW.includes('function MdrSettingsView(): unknown'))
  assert.ok(VIEW.includes('exports.MdrSettingsView = MdrSettingsView'))
  assert.ok(VIEW.includes("useState<'render' | 'about'>('render')"))
  assert.ok(VIEW.includes("'data-mdr-set-tab': value"))
  assert.ok(VIEW.includes("role: 'tablist'"))
  assert.ok(VIEW.includes("role: 'tabpanel'"))
  assert.ok(VIEW.includes('tab === ' + "'about'"), 'about panel is tab-gated')
})

test('视图：三组开关覆盖 host 半 schema 的每个布尔键', () => {
  const keys = ['copyButton', 'textFenceMarkdown', 'contextMarkdown', 'defaultExpanded', 'injectPrompt', 'render']
  const groups = VIEW.split('MD_RENDER_SWITCH_GROUPS: MdRenderSwitchGroup[] = [')
  assert.equal(groups.length, 2, 'single group table')
  const table = groups[1].split('/** 取开关当前值')[0]
  for (const key of keys) assert.ok(table.includes("'" + key + "'"), 'switch missing: ' + key)
  assert.equal((table.match(/icon: '/g) || []).length, 3, 'three groups')
  assert.ok(VIEW.includes("role: 'switch'"), 'switches are role=switch')
  assert.ok(VIEW.includes("'aria-checked': props.on"), 'switch exposes aria-checked')
  assert.ok(VIEW.includes("className: 'mdr-switch'"), 'uses shared .mdr-switch control')
  assert.ok(VIEW.includes('mdr-pill mdr-pill-'), 'count badges use pill modifiers')
})

test('视图：保存走 PUT 且立即生效；恢复默认写回默认值；已保存行', () => {
  // 传输层（GET / PUT）与注册同属模块入口，落在 settings/index.ts
  assert.ok(RAW.includes("method: 'PUT'"))
  assert.ok(RAW.includes('JSON.stringify(draft)'))
  assert.ok(RAW.includes('setRenderOptions(draft)'), 'applies saved config immediately')
  assert.ok(VIEW.includes('const reset = (): void =>'), 'reset handler exists')
  assert.ok(VIEW.includes('const defaults = mdrDefaultDraft()'))
  assert.ok(VIEW.includes('save(defaults)'), 'reset persists the defaults')
  assert.ok(VIEW.includes('MD_RENDER_STRINGS.saved()'), 'saved line rendered')
  assert.ok(VIEW.includes('MD_RENDER_STRINGS.reset()'), 'reset button rendered')
})

test('视图：加载失败按原因给提示 + 重试', () => {
  assert.ok(VIEW.includes("props.kind === 'http:404'"))
  assert.ok(VIEW.includes("props.kind === 'http:403'"))
  assert.ok(VIEW.includes('MD_RENDER_STRINGS.retry()'))
  assert.ok(RAW.includes('fetch(CONFIG_API_URL)'))
})

test('注册契约不变：id / order / keyed slot key', () => {
  assert.ok(INDEX.includes("const MD_RENDER_SETTINGS_TAB_ID = 'md-render-settings'"))
  assert.ok(INDEX.includes('const MD_RENDER_SETTINGS_TAB_ORDER = 90'))
  assert.ok(INDEX.includes("slots.inject('settings.plugins.tab'"))
  assert.ok(INDEX.includes("slots.inject('plugins.bundle.config'"))
  assert.ok(INDEX.includes("const MD_RENDER_PACKAGE_NAME = 'dsh-md-render'"))
  assert.ok(INDEX.includes('key: MD_RENDER_PACKAGE_NAME'))
  assert.ok(INDEX.includes("ctx.get('slots', false)"))
  assert.ok(
    read('src/client/parts/styles.ts').includes('STYLES_CODE + STYLES_MERMAID + STYLES_SETTINGS'),
    'aggregates STYLES_SETTINGS',
  )
  assert.equal(INDEX.includes('installStyles('), false, 'styles injected once from apply.ts (no duplicate sheet)')
  assert.ok(INDEX.includes('label: MD_RENDER_STRINGS.tab'), 'lazy label')
})

test('设置页文案表存在且为惰性函数；样式不再塞在 strings.ts', () => {
  assert.ok(RAW.includes('const MD_RENDER_STRINGS = {'))
  for (const key of [
    'headTitle',
    'headSub',
    'tabRender',
    'tabAbout',
    'groupMarkdown',
    'groupThinking',
    'groupMermaid',
    'save',
    'reset',
    'saved',
  ]) {
    assert.ok(RAW.includes(key + ':'), 'strings key missing: ' + key)
  }
  assert.equal(/const STYLES/.test(read('src/client/settings/strings.ts')), false, 'styles live in their own part')
})

// ── 纯函数 ─────────────────────────────────────────────────────────────
test('纯函数：开关取值默认开、显式 false 关', () => {
  const api = loadPure(['mdrSwitchOn'], VIEW)
  assert.equal(api.mdrSwitchOn({}, 'markdown', 'copyButton'), true)
  assert.equal(api.mdrSwitchOn(null, 'mermaid', 'render'), true)
  assert.equal(api.mdrSwitchOn({ markdown: undefined }, 'markdown', 'copyButton'), true)
  assert.equal(api.mdrSwitchOn({ markdown: { copyButton: false } }, 'markdown', 'copyButton'), false)
  assert.equal(api.mdrSwitchOn({ thinking: { defaultExpanded: false } }, 'thinking', 'defaultExpanded'), false)
})

test('纯函数：默认草稿覆盖全部 schema 键且全开', () => {
  const api = loadPure(['mdrDefaultDraft'], VIEW)
  const draft = api.mdrDefaultDraft()
  assert.deepEqual(draft, {
    markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true },
    thinking: { defaultExpanded: true },
    mermaid: { injectPrompt: true, render: true },
  })
})
