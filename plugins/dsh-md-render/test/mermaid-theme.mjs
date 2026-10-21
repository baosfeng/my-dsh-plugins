/**
 * mermaid 深色/浅色主题选择门禁。
 *
 * 宿主信号（参考源 deepseek-harness）：
 *  · body[data-ds-dark-theme]：packages/client/ui-layout/src/client/theme-presenter.ts:15 定义、:75-76 写；
 *  · documentElement.style.color-scheme：同文件 :71（boot-theme.ts:20-24 首屏也写）。
 * 断言：信号 → theme 名（dark / default）+ 每次渲染前置 init 指令 + 卡片材质接 Liquid Glass。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const ENGINE = read('src/client/parts/mermaid-engine.ts')
const CSS = read('src/client/parts/styles-mermaid.ts')

/** 从脚本模式片段里抽一个无参函数的源码（只用于纯函数测试）。 */
function extractFn(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, '缺少函数 ' + name)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error('函数体不闭合：' + name)
}

function schemeWith({ darkAttr = false, colorScheme = '', computedScheme = '' } = {}) {
  const clean = (src) =>
    src
      .replace(/ as HTMLElement/g, '')
      .replace(/\(([A-Za-z_$][\w$]*)\s*:\s*[^)]*\)/, '($1)')
      .replace(/\)\s*:\s*[^{]+\{/, ') {')
  const helpers = ['computedSchemeOf', 'inlineSchemeOf', 'rootColorScheme', 'isDarkScheme']
    .map((name) => clean(extractFn(ENGINE, name)))
    .join('\n')
  const fn = helpers + '\n' + clean(extractFn(ENGINE, 'mermaidSchemeOf'))
  const fakeDocument = {
    body: { hasAttribute: (name) => darkAttr && name === 'data-ds-dark-theme' },
    documentElement: {
      getAttribute: (name) => (name === 'style' && colorScheme !== '' ? 'color-scheme: ' + colorScheme : null),
    },
  }
  const fakeGetComputedStyle = () => ({ colorScheme: computedScheme })
  return new Function('document', 'getComputedStyle', fn + '\nreturn mermaidSchemeOf()')(
    fakeDocument,
    fakeGetComputedStyle,
  )
}

test('深浅信号 → mermaid theme：body 深色属性 / color-scheme / 默认浅色', () => {
  assert.equal(schemeWith({ darkAttr: true }), 'dark')
  assert.equal(schemeWith({ computedScheme: 'dark' }), 'dark')
  assert.equal(schemeWith({ colorScheme: 'dark' }), 'dark')
  assert.equal(schemeWith({}), 'light')
  assert.equal(schemeWith({ computedScheme: 'light' }), 'light')
})

test('theme 名映射：dark → dark，light → default（mermaid 12.2.0 内置主题名）', () => {
  const fn = extractFn(ENGINE, 'mermaidThemeOf').replace(
    "(scheme: 'dark' | 'light'): 'dark' | 'default' {",
    '(scheme) {',
  )
  const themeOf = new Function(fn + '\nreturn mermaidThemeOf')()
  assert.equal(themeOf('dark'), 'dark')
  assert.equal(themeOf('light'), 'default')
})

test('每次渲染前置 init 指令；源码自带 init 时原样尊重', () => {
  assert.match(ENGINE, /function mermaidThemeDirective\(/)
  assert.match(ENGINE, /'%%\{init: ' \+ JSON\.stringify\(config\) \+ '\}%%\\n'/)
  assert.match(ENGINE, /themeVariables = vars/)
  assert.match(ENGINE, /if \(source\.indexOf\('%%\{init'\) >= 0\) return source/)
  assert.match(ENGINE, /engine\.render\(entryId, decorateSource\(source, mermaidSchemeOf\(\)\), host\)/)
  assert.match(ENGINE, /engine\.initialize\(\{ \.\.\.MERMAID_INIT, theme: mermaidThemeOf\(mermaidSchemeOf\(\)\) \}\)/)
})

test('图表卡套用 Liquid Glass：材质 / 统一阴影 / 新圆角', () => {
  assert.match(CSS, /\.mdr-mm-card\{[^}]*border-radius:var\(--mdr-radius-lg,10px\)/)
  assert.match(CSS, /\.mdr-mm-card\{[^}]*backdrop-filter:var\(--mdr-material,none\)/)
  assert.match(CSS, /\.mdr-mm-card\{[^}]*box-shadow:var\(--mdr-card-shadow,var\(--mdr-mm-shadow\)\)/)
  assert.match(CSS, /--mdr-mm-surface:var\(--mdr-surface,var\(--dsw-alias-markdown-code-block\)\);/)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')), false, '不得出现裸十六进制')
})
