/**
 * 设计系统底座 + markdown 内容样式 —— 静态断言（不跑构建、不依赖 bundle）。
 *
 * 口径：
 *   · 只认源码文本（src/client/parts/styles-base.ts / styles-markdown.ts）；
 *   · 颜色纪律：只能用宿主 --dsw-* 或 color-mix 派生，**禁裸十六进制 / 禁 --shiki**；
 *   · 几何 / 字号 / 动效逐项对齐原型（docs/原型重构/dsh-md-render.html 8–91、828–1035、
 *     1083–1113、1116–1321）与重构契约 §二/§三。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`../src/client/parts/${name}`, import.meta.url), 'utf8')
const base = read('styles-base.ts')
const md = read('styles-markdown.ts')

/** 只取模板字符串内容（CSS 本体），并去掉 CSS 注释 —— 注释里可以写规范说明。 */
function cssOf(text) {
  const start = text.indexOf('`') + 1
  const end = text.lastIndexOf('`')
  return text.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
}
const cssBase = cssOf(base)
const cssMd = cssOf(md)

/** 26 项色彩 token（原型 9–38 的语义位 → 宿主语义色 / color-mix 派生）。 */
const COLOR_TOKENS = [
  '--mdr-bg',
  '--mdr-bg-elevated',
  '--mdr-bg-hover',
  '--mdr-surface',
  '--mdr-surface-raised',
  '--mdr-border',
  '--mdr-border-soft',
  '--mdr-border-strong',
  '--mdr-text',
  '--mdr-text-2',
  '--mdr-text-3',
  '--mdr-accent',
  '--mdr-accent-hover',
  '--mdr-accent-soft',
  '--mdr-on-accent',
  '--mdr-success',
  '--mdr-success-soft',
  '--mdr-warn',
  '--mdr-warn-soft',
  '--mdr-danger',
  '--mdr-danger-soft',
  '--mdr-code-bg',
  '--mdr-toast-bg',
  '--mdr-overlay',
  '--mdr-shadow',
  '--mdr-focus-ring',
]

const styleText = cssBase + '\n' + cssMd

test('导出形态：两个样式文件各导出一个字符串常量（脚本模式，无 import/export）', () => {
  assert.match(base, /const STYLES_BASE: string = `/)
  assert.match(md, /const STYLES_MARKDOWN: string = `/)
  assert.doesNotMatch(base, /^\s*(import|export)\s/m, '脚本模式片段不允许 import/export')
  assert.doesNotMatch(md, /^\s*(import|export)\s/m, '脚本模式片段不允许 import/export')
})

test('token 全表：26 项色彩 token 齐备且全部取宿主变量 / color-mix 派生', () => {
  const defined = new Set([...base.matchAll(/^(--mdr-[a-z0-9-]+):(.+);$/gm)].map((m) => m[1]))
  assert.equal(COLOR_TOKENS.length, 26)
  for (const token of COLOR_TOKENS) {
    assert.ok(defined.has(token), `缺少 token：${token}`)
    const value = new RegExp(`^${token}:([^;]+);`, 'm').exec(base)?.[1] ?? ''
    assert.ok(
      value.includes('--dsw-') || value.startsWith('color-mix('),
      `${token} 必须取宿主 --dsw-* 或 color-mix 派生，实际：${value}`,
    )
  }
})

test('几何 / 字号 / 间距 / 动效 token 照原型取值', () => {
  for (const rule of [
    '--mdr-radius-sm:6px;',
    '--mdr-radius-md:12px;',
    '--mdr-radius-lg:14px;',
    '--mdr-radius-pill:980px;',
    '--mdr-fs-xs:12px;',
    '--mdr-fs-sm:14px;',
    '--mdr-fs-base:16px;',
    '--mdr-fs-lg:18px;',
    '--mdr-space-1:4px;',
    '--mdr-space-2:8px;',
    '--mdr-space-3:12px;',
    '--mdr-space-4:16px;',
    '--mdr-space-6:24px;',
    '--mdr-motion-fast:150ms;',
    '--mdr-motion-base:220ms;',
    '--mdr-ease:cubic-bezier(.28,0,.22,1);',
  ]) {
    assert.ok(base.includes(rule), `缺少 token 取值：${rule}`)
  }
})

test('颜色纪律：禁裸十六进制、禁 --shiki-token-*', () => {
  for (const [name, text] of [
    ['styles-base.ts', cssBase],
    ['styles-markdown.ts', cssMd],
  ]) {
    const hex = text.match(/#[0-9a-fA-F]{3,8}\b/g)
    assert.equal(hex, null, `${name} 出现裸十六进制：${hex?.join(', ')}`)
    assert.doesNotMatch(text, /--shiki/, `${name} 不得引用 --shiki-*`)
  }
})

test('通用控件：btn / icon-btn(24×24) / seg / pill / switch / toast / tip 齐备', () => {
  const rules = [
    [base, /\.mdr-btn\{[^}]*height:24px[^}]*padding:0 6px[^}]*font-size:11\.5px/],
    [cssBase, /\.mdr-icon-btn\{[^}]*width:24px;[^}]*height:24px;[^}]*border-radius:6px/],
    [base, /\.mdr-seg\{[^}]*padding:3px[^}]*border-radius:var\(--mdr-radius-md\)/],
    [base, /\.mdr-seg-btn\{[^}]*height:26px[^}]*padding:0 12px[^}]*font-size:12px/],
    [cssBase, /\.mdr-pill\{[^}]*height:20px;[^}]*padding:0 7px;[^}]*font-size:10\.5px;/],
    [base, /\.mdr-pill-accent\{color:var\(--mdr-accent\)[^}]*background:var\(--mdr-accent-soft\)/],
    [base, /\.mdr-pill-success\{color:var\(--mdr-success\)[^}]*background:var\(--mdr-success-soft\)/],
    [cssBase, /\.mdr-switch\{[^}]*width:44px;[^}]*height:26px;/],
    [cssBase, /\.mdr-switch::after\{[^}]*width:20px;[^}]*height:20px;/],
    [base, /\.mdr-switch\[aria-checked='true'\]::after\{transform:translateX\(18px\)/],
    [base, /\.mdr-toast\{/],
    [base, /\[data-mdr-tip\]::after\{[^}]*content:attr\(data-mdr-tip\)/],
  ]
  for (const [text, re] of rules) assert.match(text, re)
})

test('状态类走语义类名（is-active / is-on / is-copied），不用行内样式', () => {
  assert.match(base, /\.mdr-seg-btn\.is-active/)
  assert.match(base, /\.mdr-icon-btn\.is-on/)
  assert.match(base, /\.mdr-btn\.is-copied/)
  assert.doesNotMatch(styleText, /classList|cssText|el\.style|\.style\./)
})

test('动效纪律：150/220ms + cubic-bezier(.28,0,.22,1) + reduced-motion 全关 + 焦点环 + 滚动条', () => {
  assert.match(base, /transition:[^;]*var\(--mdr-motion-fast\) var\(--mdr-ease\)/)
  assert.match(base, /transition:[^;]*var\(--mdr-motion-base\) var\(--mdr-ease\)/)
  assert.match(base, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*transition:none!important/)
  assert.match(base, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*animation:none!important/)
  assert.match(base, /focus-visible\{[^}]*outline:2px solid var\(--mdr-focus-ring\)/)
  assert.match(base, /\.mdr-scroll::-webkit-scrollbar\{width:8px;height:8px\}/)
  assert.match(md, /@media \(prefers-reduced-motion:reduce\)\{/)
})

test('markdown 正文：13px/1.72 + h1–h6 阶梯 18/16/14/14/13/12', () => {
  assert.match(md, /\.mdr-md\{[^}]*font-size:13px[^}]*line-height:1\.72/)
  const sizes = [...md.matchAll(/\.mdr-md h([1-6])\{font-size:(\d+)px/g)].map((m) => m[2])
  assert.deepEqual(sizes, ['18', '16', '14', '14', '13', '12'])
})

test('列表 / 任务列表：::marker、14px 方框、1px 边、4px 圆角、勾形 150ms、完成项灰字删除线', () => {
  assert.match(md, /\.mdr-md ul,\.mdr-md ol\{[^}]*padding-left:20px[^}]*gap:3px/)
  assert.match(md, /\.mdr-md li::marker\{color:var\(--mdr-text-3\)\}/)
  assert.match(
    cssMd,
    /\.mdr-md-check\{[^}]*width:14px;[^}]*height:14px;[^}]*border:1px solid var\(--mdr-border\);[^}]*border-radius:var\(--mdr-radius-sm\)/,
  )
  assert.match(md, /\.mdr-md-task-item:has\(>\.mdr-md-check:checked\)::after\{opacity:1\}/)
  assert.match(md, /\.mdr-md-task-item::after\{[\s\S]*?transition:opacity var\(--mdr-motion-fast\) var\(--mdr-ease\)/)
  assert.match(md, /\.mdr-md-task-item\.is-done[^{]*\{[^}]*color:var\(--mdr-text-3\)[^}]*text-decoration:line-through/)
})

test('表格：圆角外框 + 中性表头 + 行 hover + 12px/420px 基线', () => {
  assert.match(
    md,
    /\.mdr-md-table-wrap\{[^}]*border:1px solid var\(--mdr-border\)[^}]*border-radius:var\(--mdr-radius-md\)/,
  )
  assert.match(md, /\.mdr-md-table\{[^}]*font-size:12px[^}]*min-width:420px/)
  assert.match(md, /\.mdr-md-table th\{[^}]*background:var\(--mdr-table-head-bg\)[^}]*padding:7px 10px/)
  assert.match(md, /\.mdr-md-table td\{[^}]*padding:7px 10px/)
  assert.match(md, /\.mdr-md-table tbody tr:hover td\{background:var\(--mdr-bg-hover\)\}/)
})

test('引用 / 分隔线 / 链接 / 图片 / 行内码 / 整段复制按钮', () => {
  assert.match(
    md,
    /\.mdr-md blockquote\{[^}]*border-left:2px solid var\(--mdr-quote-border\)[^}]*border-radius:0 7px 7px 0/,
  )
  assert.match(md, /\.mdr-md blockquote blockquote\{[^}]*background:transparent/)
  assert.match(md, /\.mdr-md hr\{[^}]*border-top:1px solid var\(--mdr-border-soft\)/)
  assert.match(
    md,
    /\.mdr-md a\{[^}]*color:var\(--mdr-accent\)[^}]*border-bottom:1px solid color-mix\(in srgb,var\(--mdr-accent\) 35%,transparent\)/,
  )
  assert.match(md, /\.mdr-md img\{[^}]*max-width:100%[^}]*border-radius:var\(--mdr-radius-md\)/)
  assert.match(
    md,
    /\.mdr-md :not\(pre\)>code\{[^}]*border:1px solid var\(--mdr-border-soft\)[^}]*border-radius:var\(--mdr-radius-sm\)[^}]*background:var\(--mdr-code-bg\)[^}]*color:var\(--mdr-accent\)/,
  )
  assert.match(md, /\.mdr-md-copy\{[^}]*position:absolute[^}]*top:-2px[^}]*right:0[^}]*opacity:0/)
  assert.match(md, /\.mdr-md:hover \.mdr-md-copy,\.mdr-md-copy:focus-visible\{opacity:1\}/)
  assert.match(md, /\.mdr-md \.mdr-md-copy\.is-copied\{opacity:1;color:var\(--mdr-success\)\}/)
})
