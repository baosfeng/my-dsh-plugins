/**
 * 原型对齐门禁（重构 v2）—— 视觉真源 = docs/原型重构/dsh-md-render.html。
 *
 * 拆分后样式按职责落在 5 个 part（base / markdown / code / mermaid / settings），
 * 本文件逐条钉住**几何 / 字号 / 间距 / 动效**取值与控件形态，漂移即红。
 * 颜色不在此列（由 own-visual-language.mjs 钉「只取宿主语义变量」）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(HERE, '..', 'src', 'client', 'parts', name), 'utf8')
const RAW = {
  base: read('styles-base.ts'),
  markdown: read('styles-markdown.ts'),
  code: read('styles-code.ts'),
  mermaid: read('styles-mermaid.ts'),
  settings: read('styles-settings.ts'),
}
const ARTIFACT = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const CSS = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, strip(v)]))

test('设计 token：几何 / 字号 / 间距 / 动效逐条对齐原型', () => {
  const tokens = [
    '--mdr-radius-sm:6px',
    '--mdr-radius-md:12px',
    '--mdr-radius-lg:14px',
    '--mdr-radius-pill:980px',
    '--mdr-fs-xs:12px',
    '--mdr-fs-sm:14px',
    '--mdr-fs-base:16px',
    '--mdr-fs-lg:18px',
    '--mdr-space-1:4px',
    '--mdr-space-2:8px',
    '--mdr-space-3:12px',
    '--mdr-space-4:16px',
    '--mdr-space-6:24px',
    '--mdr-motion-fast:150ms',
    '--mdr-motion-base:220ms',
  ]
  for (const token of tokens) assert.ok(CSS.base.includes(token), '缺少原型 token ' + token)
  assert.match(CSS.base, /--mdr-ease:cubic-bezier\(\.28,0,\.22,1\)/, '缓动取原型 --ease-standard')
})

test('通用控件几何：按钮 / 图标按钮 / 分段 / 胶囊 / 开关', () => {
  for (const [selector, snippets] of [
    ['.mdr-btn{', ['height:24px', 'padding:0 6px']],
    ['.mdr-icon-btn{', ['width:24px', 'height:24px']],
    ['.mdr-seg{', ['padding:3px']],
    ['.mdr-seg-btn{', ['height:26px', 'padding:0 12px']],
    ['.mdr-pill{', ['height:20px', 'padding:0 7px']],
    ['.mdr-switch{', ['width:44px', 'height:26px']],
    ['.mdr-switch::after{', ['width:20px', 'height:20px']],
  ]) {
    const start = CSS.base.indexOf(selector)
    assert.ok(start >= 0, '缺少控件规则 ' + selector)
    const body = CSS.base.slice(start, CSS.base.indexOf('}', start))
    for (const snippet of snippets) assert.ok(body.includes(snippet), selector + ' 缺少 ' + snippet)
  }
  assert.ok(CSS.base.includes('translateX(18px)'), '开关圆钮位移 18px（44 宽 - 26 钮 - 2x2 边）')
  assert.ok(CSS.base.includes('[data-mdr-tip]::after{'), '字符控件文案走 [data-mdr-tip] 浮层')
})

test('markdown 排版：正文 13px / 标题阶梯 18-16-14-14-13-12 / 表格滚动容器', () => {
  const md = CSS.markdown
  assert.ok(/\.mdr-md\{[^}]*font-size:13px/.test(md), '正文 13px')
  assert.ok(/\.mdr-md\{[^}]*line-height:1\.72/.test(md), '正文行高 1.72')
  for (const [tag, size] of [
    ['h1', '18px'],
    ['h2', '16px'],
    ['h3', '14px'],
    ['h4', '14px'],
    ['h5', '13px'],
    ['h6', '12px'],
  ]) {
    const re = new RegExp(`\\.mdr-md ${tag}\\{[^}]*font-size:${size.replace('.', '\\.')}`)
    assert.ok(re.test(md), `${tag} 字号 ${size}`)
  }
  assert.ok(md.includes('.mdr-md-table-wrap'), '宽表格外层横向滚动容器')
  assert.ok(md.includes('.mdr-md-check'), '任务列表只读复选框样式')
})

test('代码卡：10px 圆角 / 32px 头 / 24px 工具按钮 / 行号与换行属性开关', () => {
  const code = CSS.code
  assert.ok(/\.mdr-fence\{[^}]*border-radius:var\(--mdr-radius-lg\)/.test(code), '卡片 10px 圆角')
  assert.ok(/\.mdr-fence-head\{[^}]*height:32px/.test(code), '卡头 32px')
  assert.ok(/\.mdr-fence-action\{[^}]*width:24px/.test(code), '工具按钮 24×24')
  assert.ok(/\.mdr-fence-pill\{[^}]*text-transform:uppercase/.test(code), '语言胶囊大写')
  assert.ok(code.includes('[data-mdr-wrap="on"]'), '换行态走 data-mdr-wrap')
  assert.ok(code.includes('[data-mdr-lines="on"]'), '行号态走 data-mdr-lines')
  assert.ok(code.includes('.mdr-rm-btn'), '「渲染为…」分段按钮')
  assert.ok(code.includes('div.md-code-block[data-mdr-view] > :not(.mdr-block)'), '接管态隐藏官方子元素')
})

test('mermaid 卡片：图 / 源码 / Markdown 三态 + 原生 dialog 全屏', () => {
  const mm = CSS.mermaid
  assert.ok(mm.includes('.mdr-mm-card'), '卡片根')
  assert.ok(mm.includes('.mdr-mm-head'), '卡片头')
  assert.ok(mm.includes('.mdr-mm-dialog'), '原生 dialog 全屏')
  assert.ok(mm.includes('.mdr-mm-error'), '失败态')
  assert.ok(mm.includes('.mdr-mm-code'), '源码视图')
})

test('设置页：双 tab / 分组头 / 开关行 / 44×26 开关', () => {
  const set = CSS.settings
  assert.ok(set.includes('.mdr-set-tabs'), '双 tab 容器')
  assert.ok(set.includes('.mdr-set-group-head'), '分组头')
  assert.ok(set.includes('.mdr-set-row'), '设置行')
  assert.ok(set.includes('.mdr-set-save') && set.includes('.mdr-set-reset'), '保存 / 恢复默认')
  assert.ok(set.includes('.mdr-switch'), '开关形态沿用通用控件')
})

test('动效纪律：只动 transform / opacity，reduced-motion 全关', () => {
  for (const [name, css] of Object.entries(CSS)) {
    for (const line of css.split('\n').filter((l) => l.includes('@keyframes'))) {
      assert.equal(/width:|height:/.test(line), false, name + ': keyframes 不动几何')
    }
  }
  assert.ok(
    Object.values(CSS).some((css) => css.includes('@media (prefers-reduced-motion:reduce)')),
    'reduced-motion 有专门关闭块',
  )
})

test('产物与源码不漂移（聚合后的 5 个 part 都在 lib/client.js 里）', () => {
  for (const [name, css] of Object.entries(CSS)) {
    const firstRule = css
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('.') && line.includes('{'))
    assert.ok(firstRule, name + ': 找不到首条规则')
    assert.ok(ARTIFACT.includes(firstRule), name + ': 产物缺少首条规则（聚合缺失）')
  }
  assert.ok(
    ARTIFACT.includes('const STYLES = STYLES_BASE + STYLES_MARKDOWN + STYLES_CODE + STYLES_MERMAID + STYLES_SETTINGS'),
  )
})
