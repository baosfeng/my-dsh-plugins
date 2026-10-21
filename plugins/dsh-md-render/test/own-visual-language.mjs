/**
 * 自研**视觉语言**静态断言（重构 v2）—— 用户口径（最高优先级）：「全部使用我们自己的，外观也是」。
 *
 * 判据：样式按职责拆在 5 个 part，但**颜色只取宿主语义变量 / color-mix 派生**，
 * 不写裸十六进制、不用官方 shiki 调色板；控件形态与状态语言是插件自己的
 * （.mdr-* 类名 + data-mdr-* 标记 + aria 状态）。产物与源码不漂移。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(HERE, '..', 'src', 'client', 'parts', name), 'utf8')
const FILES = ['styles-base.ts', 'styles-markdown.ts', 'styles-code.ts', 'styles-mermaid.ts', 'styles-settings.ts']
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const CSS = FILES.map((name) => ({ name, css: strip(read(name)) }))
const ALL = CSS.map((entry) => entry.css).join('\n')
const ARTIFACT = strip(readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8'))

test('外观取色只走宿主语义变量：无裸十六进制 / 无官方 shiki 调色板', () => {
  for (const { name, css } of CSS) {
    const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    assert.deepEqual(hex, [], name + ': 不得硬编码十六进制色值')
    assert.equal(css.includes('--shiki-token-'), false, name + ': 不用官方 shiki 调色板')
  }
  assert.ok(ALL.includes('color-mix(in srgb,'), '透明度 / 派生色用 color-mix 由宿主色算出来')
  assert.ok(ALL.includes('var(--dsw-alias-'), '颜色取宿主 --dsw-alias-* 语义变量')
})

test('自有设计 token：色彩 / 圆角 / 字号 / 间距 / 动效都是插件自己的尺度', () => {
  for (const token of [
    '--mdr-accent:',
    '--mdr-surface:',
    '--mdr-text:',
    '--mdr-border:',
    '--mdr-radius-sm:',
    '--mdr-radius-md:',
    '--mdr-radius-pill:',
    '--mdr-motion-fast:',
    '--mdr-ease:',
  ]) {
    assert.ok(ALL.includes(token), '缺少自有设计 token ' + token)
  }
  // 语法色由插件自己的语义映射给出（hl-key / hl-str / hl-num / hl-com / hl-fn / hl-tag / hl-prop）。
  for (const scope of ['hl-key', 'hl-str', 'hl-num', 'hl-com', 'hl-fn', 'hl-tag', 'hl-prop']) {
    assert.ok(ALL.includes('.' + scope), '缺少自有语法色类 ' + scope)
  }
  for (const token of ['--mdr-frame-hl-key:', '--mdr-frame-hl-str:', '--mdr-frame-hl-num:']) {
    assert.ok(ALL.includes(token), '缺少语法色 token ' + token)
  }
  for (const { name, css } of CSS.filter((entry) => entry.name === 'styles-code.ts')) {
    const decls = [...css.matchAll(/--mdr-frame-hl-[a-z]+:[^;\n]+/g)].map((m) => m[0])
    assert.ok(decls.length >= 7, name + ': 语法色定义齐全')
    for (const decl of decls) {
      assert.ok(
        decl.includes('var(--dsw-alias-') || decl.includes('color-mix(in srgb,var(--dsw-alias-'),
        '语法色必须由宿主语义色取或派生：' + decl,
      )
    }
  }
})

test('代码卡辨识点：语言胶囊 + 24px 图标按钮 + 复制三路浮现 + 属性驱动的换行 / 行号态', () => {
  assert.ok(ALL.includes('.mdr-fence-pill'), '语言名做成胶囊标签')
  assert.ok(/\.mdr-fence-pill\{[^}]*text-transform:uppercase/.test(ALL), '语言胶囊大写')
  assert.ok(/\.mdr-icon-btn\{[^}]*width:24px/.test(ALL), '工具按钮 24×24')
  assert.ok(/\.mdr-fence-copy\{[^}]*opacity:0/.test(ALL), '复制按钮默认隐形')
  assert.ok(ALL.includes('.mdr-fence:hover .mdr-fence-copy'), 'hover 浮现复制')
  assert.ok(ALL.includes('.mdr-fence:focus-within .mdr-fence-copy'), '键盘 focus 浮现复制')
  assert.ok(ALL.includes('@media (hover:none)'), '触屏常显')
  assert.ok(ALL.includes('[data-mdr-wrap="on"]'), '换行态走属性')
  assert.ok(ALL.includes('[data-mdr-lines="on"]'), '行号态走属性')
})

test('统一设计系统：代码卡 / markdown 卡 / 图表卡同一套边框 · 圆角 · 层次', () => {
  assert.ok(/\.mdr-fence\{[^}]*border:1px solid var\(--mdr-frame-line\)/.test(ALL), '代码卡边框')
  assert.ok(/\.mdr-fence\{[^}]*border-radius:var\(--mdr-radius-lg\)/.test(ALL), '代码卡圆角')
  assert.ok(ALL.includes('.mdr-block-md'), 'markdown 卡自有类')
  assert.ok(ALL.includes('.mdr-mm-card'), '图表卡自有类')
  assert.ok(ALL.includes('--mdr-shadow'), '统一阴影 token')
})

test('无障碍：自有控件都有可见 focus 环（宿主指针模态下官方描边会被抹掉）', () => {
  for (const selector of [
    ':is(.mdr-btn,.mdr-icon-btn,.mdr-seg-btn,.mdr-switch):focus-visible',
    '.mdr-fence-action:focus-visible',
    '.mdr-fence-copy:focus-visible',
    '.mdr-md-copy:focus-visible',
    '.mdr-rm-btn:focus-visible',
  ]) {
    assert.ok(ALL.includes(selector), '缺少 focus 可见样式：' + selector)
  }
  assert.ok(ALL.includes('--mdr-focus-ring'), '焦点语言统一为强调色光晕')
})

test('控件文字走悬停浮层（零布局位移）；状态走 aria / 语义类', () => {
  assert.ok(ALL.includes('[data-mdr-tip]::after{'), '浮层伪元素存在')
  assert.ok(ALL.includes('content:attr(data-mdr-tip)'), '浮层文字来自 data-mdr-tip')
  assert.ok(ALL.includes('position:absolute'), '浮层 absolute（零布局位移）')
  assert.ok(ALL.includes('.is-on') && ALL.includes('.is-active') && ALL.includes('.is-copied'), '语义状态类')
  assert.ok(ALL.includes("aria-checked='true'") || ALL.includes('aria-checked="true"'), '开关状态走 aria-checked')
  assert.equal(/\.mdr-[^{]*\{[^}]*cursor:pointer[^}]*\}/.test(ALL), true, '可点击控件有指针手势')
})

test('构建产物里也是这套外观（源码与产物不漂移）', () => {
  for (const marker of [
    '--mdr-radius-pill:980px',
    '.mdr-fence-pill{',
    '.mdr-md{',
    '.mdr-mm-card',
    '.mdr-set-tabs',
    '[data-mdr-tip]::after{',
  ]) {
    assert.ok(ARTIFACT.includes(marker), '产物缺少自有外观标记：' + marker)
  }
  assert.equal(ARTIFACT.includes('--shiki-token-'), false, '产物里不得残留官方 shiki 调色板')
})
