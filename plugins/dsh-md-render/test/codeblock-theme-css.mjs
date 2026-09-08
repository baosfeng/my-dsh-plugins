import { test } from 'vitest'
/**
 * 代码块主题前景色防回归（issue #146 主题渲染 bug 修复）。
 *
 * 背景：代码主题（codeTheme）此前只定义背景色（--dsh-md-render-code-bg）
 * 与 token 色（--dsh-md-render-c-*），代码块文字 color 继承宿主 .tzx-md 的
 * --dsw-alias-label-primary。当系统 prefers-color-scheme:dark 且宿主 DSH 为
 * 浅色主题时，暗色变体把背景反转成深色（如 github-light → #0d1117），而
 * 文字仍是浅色主题的深色 → 深背景黑字，代码不可见。
 *
 * 修复：每个 data-theme（含暗色变体）定义自洽前景色
 * --dsh-md-render-code-fg，.tzx-pre 的 color 用它（fallback 宿主 primary）。
 * 本测试静态断言该契约，防止回归（纯 CSS 问题无法用 jsdom computed style
 * 可靠断言，故检查 STYLES 源字符串）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const m = src.match(/const STYLES = `([\s\S]*?)`/)
assert.ok(m, 'STYLES string found in client.js')
const STYLES = m[1]

/** 提取某个 CSS 选择器声明块的完整规则字符串。 */
function ruleFor(selectorFragment) {
  // 选择器可能出现在多行；这里只匹配单条规则（styles.part.js 主题行均为单行）。
  const lines = STYLES.split('\n')
  for (const line of lines) {
    if (line.includes(selectorFragment) && line.includes('{')) return line
  }
  return null
}

test('.tzx-pre 的 color 使用主题前景色（不纯继承宿主 label-primary）', () => {
  const preRule = ruleFor('.tzx-md .tzx-pre')
  assert.ok(preRule, '.tzx-md .tzx-pre rule present')
  assert.ok(
    preRule.includes('color:var(--dsh-md-render-code-fg'),
    '.tzx-pre color uses --dsh-md-render-code-fg (self-consistent theme fg)',
  )
  assert.ok(preRule.includes('var(--dsw-alias-label-primary)'), '.tzx-pre color falls back to host label-primary')
})

test('每个 data-theme（bright/github-light/github-dark/one-dark/nord）定义前景色 --dsh-md-render-code-fg', () => {
  const themes = ['bright', 'github-light', 'github-dark', 'one-dark', 'nord']
  for (const theme of themes) {
    const sel = theme === 'bright' ? '.md-code-block[data-theme]' : `.md-code-block[data-theme="${theme}"]`
    const rule = ruleFor(sel)
    assert.ok(rule, `${sel} rule present (base)`)
    assert.ok(rule.includes('--dsh-md-render-code-fg:'), `${theme} base rule defines --dsh-md-render-code-fg`)
  }
})

test('暗色变体（prefers-color-scheme:dark）下 bright / github-light 也定义前景色（防止深背景黑字）', () => {
  // 暗色变体在同一条 @media 注释行内（styles.part.js 单行多选择器）。
  const mediaRule = ruleFor('prefers-color-scheme:dark')
  assert.ok(mediaRule, 'dark media rule present')
  // bright（无具名 data-theme）与 github-light 在暗色下背景被反转成深色，必须补前景色。
  assert.ok(mediaRule.includes('--dsh-md-render-code-fg:#cbd5e1'), 'bright dark variant defines light fg')
  assert.ok(mediaRule.includes('--dsh-md-render-code-fg:#c9d1d9'), 'github-light dark variant defines light fg')
})

test('主题前景色与背景为互补亮暗（自洽可见）', () => {
  // 浅色背景主题（bright github-light）前景应为深色；深色背景主题（github-dark
  // one-dark nord）前景应为浅色。逐一核对 hex 亮度大致关系，防误设同色。
  const pairs = [
    { name: 'bright', sel: '.md-code-block[data-theme]', bg: '#fafaf9', fg: '#1f2328' },
    { name: 'github-light', sel: '.md-code-block[data-theme="github-light"]', bg: '#ffffff', fg: '#1f2328' },
    { name: 'github-dark', sel: '.md-code-block[data-theme="github-dark"]', bg: '#0d1117', fg: '#e6edf3' },
    { name: 'one-dark', sel: '.md-code-block[data-theme="one-dark"]', bg: '#282c34', fg: '#abb2bf' },
    { name: 'nord', sel: '.md-code-block[data-theme="nord"]', bg: '#2e3440', fg: '#d8dee9' },
  ]
  const lum = (hex) => {
    const v = hex.replace('#', '')
    const r = parseInt(v.slice(0, 2), 16)
    const g = parseInt(v.slice(2, 4), 16)
    const b = parseInt(v.slice(4, 6), 16)
    return 0.299 * r + 0.587 * g + 0.114 * b
  }
  for (const p of pairs) {
    const rule = ruleFor(p.sel)
    assert.ok(rule, `${p.name} rule present`)
    // 用规则里的实际 bg/fg 亮度差断言可读（>80 近似可见）。
    const bgV = String(p.bg)
    const fgV = String(p.fg)
    assert.ok(Math.abs(lum(bgV) - lum(fgV)) > 80, `${p.name} bg vs fg luminance contrast sufficient (${bgV}/${fgV})`, {
      bgV,
      fgV,
    })
  }
})
