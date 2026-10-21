/**
 * Liquid Glass 主题门禁（用户已选定的一套外观，02-style §2 / §5 冻结）。
 *
 * 钉住四件事：
 *   a) 12 个新材质 / 排版 token 齐备且取值 = 02-style 的 Liquid Glass 表；
 *   b) 卡片容器（围栏 / 图表 / 表格 / 上下文）真的消费 --mdr-material / --mdr-card-shadow；
 *   c) 深色覆盖块存在（宿主信号 body[data-ds-dark-theme]），且只用 --dsw-* 派生；
 *   d) 可读性红线：--mdr-surface 在浅/深两态的透明度都不低于 54%。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(HERE, '..', 'src', 'client', 'parts', name), 'utf8')
const base = read('styles-base.ts')
const markdown = read('styles-markdown.ts')
const code = read('styles-code.ts')
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const cssBase = strip(base)
const cssMarkdown = strip(markdown)
const cssCode = strip(code)

test('12 个 Liquid Glass token 齐备且取 02-style 的取值', () => {
  const expected = [
    /--mdr-font-sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",/,
    /--mdr-font-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;/,
    /--mdr-material:blur\(22px\) saturate\(180%\);/,
    /--mdr-card-shadow:0 12px 32px color-mix\(in srgb,var\(--dsw-alias-label-primary\) 10%,transparent\),inset 0 1px 0 color-mix\(in srgb,var\(--dsw-alias-label-primary\) 12%,transparent\);/,
    /--mdr-hairline:var\(--mdr-border-soft\);/,
    /--mdr-heading-weight:600;/,
    /--mdr-heading-tracking:-\.015em;/,
    /--mdr-body-gap:12px;/,
    /--mdr-quote-bg:color-mix\(in srgb,var\(--dsw-alias-state-business-primary,var\(--dsw-alias-link\)\) 10%,transparent\);/,
    /--mdr-quote-border:color-mix\(in srgb,var\(--dsw-alias-state-business-primary,var\(--dsw-alias-link\)\) 55%,transparent\);/,
    /--mdr-table-head-bg:color-mix\(in srgb,var\(--dsw-alias-bg-layer-1\) 40%,transparent\);/,
    /--mdr-frame-head-bg:color-mix\(in srgb,var\(--dsw-alias-bg-layer-1\) 34%,transparent\);/,
  ]
  assert.equal(expected.length, 12)
  for (const re of expected) assert.match(cssBase, re)
})

test('Liquid Glass 的既有 token 取值：surface 66% / raised 58% / 描边 15% · 10% / 圆角 6·12·14', () => {
  assert.match(cssBase, /--mdr-surface:color-mix\(in srgb,var\(--dsw-alias-markdown-code-block\) 66%,transparent\);/)
  assert.match(
    cssBase,
    /--mdr-surface-raised:color-mix\(in srgb,var\(--dsw-alias-markdown-code-block-banner\) 58%,transparent\);/,
  )
  assert.match(cssBase, /--mdr-border:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 15%,transparent\);/)
  assert.match(cssBase, /--mdr-border-soft:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 10%,transparent\);/)
  for (const token of ['--mdr-radius-sm:6px;', '--mdr-radius-md:12px;', '--mdr-radius-lg:14px;']) {
    assert.ok(base.includes(token), '缺少 ' + token)
  }
})

test('卡片容器消费材质 token：围栏 / markdown 卡 / 表格 / 上下文块', () => {
  assert.match(
    cssCode,
    /\.mdr-fence\{[^}]*backdrop-filter:var\(--mdr-material\)[^}]*box-shadow:var\(--mdr-card-shadow\)/,
  )
  assert.match(
    cssCode,
    /\.mdr-block-md\{[^}]*backdrop-filter:var\(--mdr-material\)[^}]*box-shadow:var\(--mdr-card-shadow\)/,
  )
  assert.match(cssCode, /\.mdr-ctx\{[^}]*backdrop-filter:var\(--mdr-material\)[^}]*box-shadow:var\(--mdr-card-shadow\)/)
  assert.match(
    cssMarkdown,
    /\.mdr-md-table-wrap\{[^}]*backdrop-filter:var\(--mdr-material\)[^}]*box-shadow:var\(--mdr-card-shadow\)/,
  )
  // overflow:hidden 的卡片内部不再叠模糊：头 / 底栏 / 菜单都不加 backdrop-filter
  for (const inner of ['.mdr-fence-head{', '.mdr-fence-foot{', '.mdr-mm-menu{']) {
    const start = (cssCode + cssMarkdown).indexOf(inner)
    if (start < 0) continue
    const body = (cssCode + cssMarkdown).slice(start, (cssCode + cssMarkdown).indexOf('}', start))
    assert.equal(body.includes('backdrop-filter'), false, inner + ' 内部不得叠模糊')
  }
})

test('markdown 排版消费新 token：间距 / 标题权重字距 / 引用 / 表头 / 等宽字体', () => {
  assert.match(cssMarkdown, /\.mdr-md\{[^}]*gap:var\(--mdr-body-gap\)/)
  assert.match(
    cssMarkdown,
    /\.mdr-md h1,\.mdr-md h2[^{]*\{[^}]*font-weight:var\(--mdr-heading-weight\)[^}]*letter-spacing:var\(--mdr-heading-tracking\)/,
  )
  assert.match(
    cssMarkdown,
    /\.mdr-md blockquote\{[^}]*border-left:2px solid var\(--mdr-quote-border\)[^}]*background:var\(--mdr-quote-bg\)/,
  )
  assert.match(cssMarkdown, /\.mdr-md-table th\{[^}]*background:var\(--mdr-table-head-bg\)/)
  assert.ok(cssMarkdown.includes('font-family:var(--mdr-font-mono)'), '行内码 / 代码走 --mdr-font-mono')
  assert.match(cssCode, /\.mdr-fence-head\{[^}]*background:var\(--mdr-frame-head-bg\)/)
})

test('深色覆盖：宿主信号 body[data-ds-dark-theme]，只调透明度 / 阴影，不含裸色值', () => {
  const block = /body\[data-ds-dark-theme\] :is\(\.mdr-root,\.mdr-md\)\{([\s\S]*?)\n\}/.exec(cssBase)
  assert.ok(block, '缺少深色覆盖块')
  const body = block[1]
  assert.match(body, /--mdr-surface:color-mix\(in srgb,var\(--dsw-alias-markdown-code-block\) 62%,transparent\);/)
  assert.match(
    body,
    /--mdr-surface-raised:color-mix\(in srgb,var\(--dsw-alias-markdown-code-block-banner\) 52%,transparent\);/,
  )
  assert.match(
    body,
    /--mdr-card-shadow:0 14px 36px color-mix\(in srgb,var\(--dsw-alias-label-primary\) 22%,transparent\)/,
  )
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(body), false, '深色覆盖不得出现裸十六进制')
})

test('可读性红线：--mdr-surface 透明度浅色 / 深色都不低于 54%', () => {
  const decls = [...cssBase.matchAll(/--mdr-surface:color-mix\(in srgb,[^)]+\)\s*(\d+)%,transparent\)/g)].map((m) =>
    Number(m[1]),
  )
  assert.ok(decls.length >= 2, '应同时存在浅色与深色 --mdr-surface 声明')
  for (const alpha of decls) assert.ok(alpha >= 54, `--mdr-surface 透明度 ${alpha}% 低于 54% 红线`)
})
