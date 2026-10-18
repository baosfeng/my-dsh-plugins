/**
 * 「对齐原型」机器门禁 —— markdown 渲染外观的唯一真源 = 原型
 * （docs/md渲染/原型/08-prototype.html 的 :root 与「markdown 渲染」段，口径见 02-style.md）。
 *
 * 为什么单独一个文件：own-visual-language.mjs 管的是「外观是插件自己的、不照抄官方」；
 * 本文件管的是**另一个方向**——「外观必须落在原型上，不许静默漂移」。两者不可互相替代。
 *
 * 三条口径：
 *  1. **取值对齐**：几何（8 / 12 / 18 / 980 与 pill 胶囊）、字号阶梯（21 / 17 / 15 / 14 / 13 / 12）、
 *     间距（4 / 8 / 12 / 16 / 24）、动效（150ms / 220ms / cubic-bezier(0.28,0,0.22,1)）、
 *     线索色比例（55% 线 / 40% 链接装饰 / 6% 薄底 / 4% 行内码底 / 12% 发丝 / 35% 光晕）逐字一致；
 *  2. **结构对齐**：原型定义的排版机制（相邻兄弟加距 + 标题后紧贴、嵌套引用降级、三档对齐、
 *     :has() 勾选 + @supports 退化、表头中性薄底、末行无底线、窄视口降字号）在实现里都有；
 *  3. **取色可移植**：原型的 apple 十六进制取值**不得照搬**（照搬会破坏宿主深浅色）——
 *     颜色一律由宿主 --dsw-* 语义变量取或派生（与 own-visual-language.mjs 同一口径）。
 *
 * 有意偏离（原型的取舍不适用于「嵌在宿主对话流里」的场景）集中列在 DELIBERATE_DEVIATIONS，
 * 并逐条断言"确实按偏离后的做法实现"，避免偏离变成静默不对齐。
 *
 * 反向验证：把 styles.ts 里任一条 markdown 规则的取值改回旧值（如 h1 竖线改回实心 --mdr-accent、
 * 表头改回强调色薄底）→ 本文件立刻变红。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(here, '..')
const SRC = readFileSync(join(PLUGIN, 'src', 'client', 'parts', 'styles.ts'), 'utf8')
const BUNDLE = readFileSync(join(PLUGIN, 'lib', 'client.js'), 'utf8')
/** 原型文件（未进 CI 时不存在：期望值已抄进本文件，存在时再做一轮交叉校验）。 */
const PROTOTYPE_PATH = join(PLUGIN, '..', '..', 'docs', '原型重构', 'dsh-md-render.html')

/** 剔除块注释与行注释（与其它静态断言同一口径：注释里提到取值不算命中）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const CSS = stripComments(SRC)
const CODE = stripComments(BUNDLE)

/** @media 块的范围（块内选择器可能与主块重名，取块时必须跳过）。 */
function mediaRanges(css) {
  const ranges = []
  const re = /@media[^{]*\{/g
  let m
  while ((m = re.exec(css)) !== null) {
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    ranges.push([m.index, i])
  }
  return ranges
}
const MEDIA = mediaRanges(CSS)

/** 取某个选择器的整条声明块（`sel{...}`）—— 比全文 includes 精确：不会把别处的同名声明算进来。
 *  两条硬要求（都踩过）：① 只认**行首**的选择器（`.tzx-md h6{` 在合并规则 `.tzx-md h1,…,h6{…}`
 *  里也出现过，裸 indexOf 会抢到那条，断言就测错了规则）；② 跳过 **@media 块内**的重复选择器
 *  （reduced-motion 块里有 3 个与主块同名，靠源码顺序取值会让断言对象随重排漂移）。 */
function rule(selector) {
  let from = 0
  for (;;) {
    const at = CSS.indexOf(selector, from)
    if (at < 0) return null
    const lineStart = CSS.lastIndexOf('\n', at) + 1
    const inMedia = MEDIA.some(([a, b]) => at > a && at < b)
    if (!inMedia && CSS.slice(lineStart, at).trim() === '') {
      const start = CSS.indexOf('{', at)
      const end = CSS.indexOf('}', start)
      return start < 0 || end < 0 ? null : CSS.slice(start + 1, end)
    }
    from = at + 1
  }
}

/** 断言：选择器存在，且声明块里逐条包含期望片段。 */
function assertRule(selector, snippets, origin) {
  const body = rule(selector)
  assert.ok(body !== null, `缺少规则 ${selector}（原型：${origin}）`)
  for (const snippet of snippets) {
    assert.ok(body.includes(snippet), `${selector} 缺少「${snippet}」—— 原型：${origin}`)
  }
}

/** 原型 token → 插件 token 的取值映射（期望值抄自 docs/原型重构/dsh-md-render.html 与设计基线的圆角/间距体系）。 */
const TOKEN_MAP = [
  ['--radius-sm', '--mdr-radius-sm', '4px', '4px'],
  ['--radius-md', '--mdr-radius-md', '8px', '8px'],
  ['--radius-lg', '--mdr-radius-lg', '10px', '10px'],
  ['--radius-pill', '--mdr-pill', '980px', '980px'],
  ['--text-xs', '--mdr-fs-xs', '12px', '12px'],
  ['--text-xs', '--mdr-fs-h6', '12px', '12px'],
  // 字号：原型取值是「正文 14px」下的基线，实现改用**宿主的字号轴**平移（跟随设置里的字号大小 12–17）
  ['--text-sm', '--mdr-fs-h4', '14px', 'var(--dsh-content-font-size,14px)'],
  ['--text-base', '--mdr-fs-h2', '16px', 'calc(16px + var(--dsh-content-font-delta,0px))'],
  ['--text-lg', '--mdr-fs-h1', '18px', 'calc(18px + var(--dsh-content-font-delta,0px))'],
  ['--space-1', '--mdr-space-1', '4px', '4px'],
  ['--space-2', '--mdr-space-2', '8px', '8px'],
  ['--space-3', '--mdr-space-3', '12px', '12px'],
  ['--space-4', '--mdr-space-4', '16px', '16px'],
  ['--space-6', '--mdr-space-6', '24px', '24px'],
  ['--motion-fast', '--mdr-motion-fast', '150ms', '150ms'],
  ['--motion-base', '--mdr-motion-base', '220ms', '220ms'],
]

test('几何 / 字号 / 间距 / 动效取值逐字对齐原型（token 级）', () => {
  for (const [protoToken, pluginToken, value, impl] of TOKEN_MAP) {
    assert.ok(CSS.includes(`${pluginToken}:${impl}`), `${pluginToken} 应为 ${value}（原型 ${protoToken}）`)
  }
  // 缓动：原型 --ease-standard（写法带空格），逐字比会误伤空白，按归一化后的取值比。
  const ease = CSS.match(/--mdr-ease:([^;\n]+)/)
  assert.ok(ease !== null, '缺少 --mdr-ease（原型 --ease-standard）')
  assert.equal(ease[1].replace(/\s+/g, ''), 'cubic-bezier(0.28,0,0.22,1)', '缓动取原型 --ease-standard')
})

test('markdown 元素规则逐条对齐原型（选择器 → 声明块）', () => {
  assertRule(
    '.tzx-md{',
    [
      'display:flex',
      'flex-direction:column',
      'gap:var(--mdr-space-3)',
      'font-size:var(--mdr-fs-body)',
      'line-height:1.6',
      'overflow-wrap:anywhere',
    ],
    '.md 容器：块间距 space-3、正文 1.6',
  )
  assertRule(
    '.tzx-md h1{',
    ['font-size:var(--mdr-fs-h1)', 'line-height:1.4', 'letter-spacing:.1px'],
    '.md h1：18px/1.4 无竖条（重构原型）',
  )
  assertRule(
    '.tzx-md h2{',
    ['font-size:var(--mdr-fs-h2)', 'line-height:1.4', 'letter-spacing:.1px'],
    '.md h2：16px 无下边框（重构原型）',
  )
  assertRule('.tzx-md h3{', ['font-size:var(--mdr-fs-h3)', 'line-height:1.4', 'letter-spacing:-.005em'], '.md h3：14px')
  assertRule(
    '.tzx-md h4{',
    ['font-size:var(--mdr-fs-h4)', 'line-height:1.4', 'color:var(--dsw-alias-label-secondary)'],
    '.md h4：14px + 次级色',
  )
  assertRule(
    '.tzx-md h5{',
    [
      'font-size:var(--mdr-fs-h5)',
      'line-height:1.45',
      'letter-spacing:.01em',
      'color:var(--dsw-alias-label-secondary)',
    ],
    '.md h5：13px + 次级色',
  )
  assertRule(
    '.tzx-md h6{',
    ['font-size:var(--mdr-fs-h6)', 'line-height:1.5', 'letter-spacing:.08em', 'text-transform:uppercase'],
    '.md h6：12px 大写小字标签',
  )
  assertRule('.tzx-md>*+h1{', ['margin-top:var(--mdr-space-3)'], '.md>*+h1：标题前加 space-3')
  assertRule('.tzx-md>*+h2{', ['margin-top:var(--mdr-space-3)'], '.md>*+h2：标题前加 space-3')
  assertRule('.tzx-md>*+h3{', ['margin-top:var(--mdr-space-2)'], '.md>*+h3：标题前加 space-2')
  assertRule('.tzx-md h1+*', ['margin-top:0'], '标题后紧贴（h1+* / h2+* … margin-top 0）')
  assertRule(
    '.tzx-md ul,.tzx-md ol{',
    ['padding-left:var(--mdr-space-6)', 'gap:var(--mdr-space-1)'],
    '.md ul,ol：24px 缩进 + 4px 项间距',
  )
  assertRule('.tzx-md ul ul,', ['margin-top:var(--mdr-space-1)', 'gap:var(--mdr-space-1)'], '嵌套列表间距同源')
  assertRule('.tzx-md li::marker{', ['color:var(--mdr-accent-text)', 'font-weight:600'], '.md li::marker：标记染线索色')
  assertRule('.tzx-md ol>li::marker{', ['font-variant-numeric:tabular-nums'], '.md ol>li::marker：等宽数字')
  assertRule(
    '.tzx-md blockquote{',
    [
      'padding:6px var(--mdr-space-3)',
      'border-left:2px solid var(--mdr-accent)',
      'border-radius:0 7px 7px 0',
      'background:var(--mdr-accent-soft)',
    ],
    '.md blockquote：6/12 内边距 + 2px 强调竖条 + 7px 圆角 + 强调薄底（重构原型）',
  )
  assertRule(
    '.tzx-md blockquote blockquote{',
    ['border-left-color:var(--mdr-line)', 'color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)'],
    '嵌套引用降级：竖线转中性、底色更淡',
  )
  assertRule(
    '.tzx-md hr{',
    [
      'height:1px',
      'margin:var(--mdr-space-2) 0',
      'linear-gradient(90deg,transparent,var(--mdr-line) 15%,var(--mdr-line) 85%,transparent)',
    ],
    '.md hr：两侧渐隐发丝线',
  )
  assertRule(
    '.tzx-md a{',
    [
      'color:var(--dsw-alias-link)',
      'text-decoration-color:color-mix(in srgb,var(--dsw-alias-link) 40%,transparent)',
      'text-decoration-thickness:1px',
      'text-underline-offset:3px',
    ],
    '.md a：链接色 + 40% 装饰色 + 1px / 3px 偏移',
  )
  assertRule('.tzx-md a:hover{', ['text-decoration-color:currentColor'], '.md a:hover：下划线转实色')
  assertRule('.tzx-md a:active{', ['color:var(--dsw-alias-label-primary)'], '.md a:active')
  assertRule(
    '.tzx-md a:focus-visible{',
    ['outline:none', 'box-shadow:var(--mdr-focus-ring)'],
    '.md a:focus-visible：4px 光晕',
  )
  assertRule(
    '.tzx-md code.dsh-md-render-md-code{',
    [
      'padding:2px 6px',
      'border:1px solid var(--mdr-hairline)',
      'border-radius:var(--mdr-radius-sm)',
      'background:var(--mdr-code-bg)',
      'font-size:.86em',
      'color:var(--mdr-accent-text)',
    ],
    '.md code：2/6 内边距 + 8px 圆角 + 发丝边 + 4% 底 + .86em',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-link-plain{',
    ['text-decoration:underline dotted'],
    '.md .md-link-plain：点状下划线',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-html{',
    ['color:var(--dsw-alias-label-secondary)'],
    '.md .md-html：字面文本走 muted',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-img-alt{',
    ['color:var(--dsw-alias-label-secondary)', 'font-size:var(--mdr-fs-xs)'],
    '.md-img-alt：muted + 12px（原型实测 meta 一档只有 3.62:1）',
  )
  assertRule(
    '.tzx-md img.dsh-md-render-md-img{',
    ['max-width:100%', 'border:1px solid var(--mdr-line-soft)', 'border-radius:var(--mdr-radius-md)'],
    '.md img：发丝边 + 12px 圆角',
  )
  assertRule(
    '.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom{',
    ['cursor:zoom-in', 'transition:border-color var(--mdr-motion-fast) var(--mdr-ease)'],
    '.md img：可放大光标 + 150ms 过渡',
  )
  assertRule(
    '.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom:hover{',
    ['border-color:var(--mdr-accent-line)'],
    '.md img:hover：边框转线索色',
  )
  assertRule(
    '.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom:focus-visible{',
    ['box-shadow:var(--mdr-focus-ring)'],
    '.md img:focus-visible：4px 光晕',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-plain{',
    [
      'padding:var(--mdr-space-3) var(--mdr-space-4)',
      'border-radius:var(--mdr-radius-md)',
      'font-size:var(--mdr-fs-xs)',
      'white-space:pre-wrap',
    ],
    '.md .md-plain：12/16 内边距 + 圆角 + 12px 等宽',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-task{',
    ['left:0', 'top:6px', 'width:15px', 'height:15px', 'opacity:0'],
    '任务框：15×15 自绘，真实 input 只留无障碍树',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-task-item{',
    [
      'position:relative',
      'list-style:none',
      'margin-left:calc(-1 * var(--mdr-space-6))',
      'padding-left:var(--mdr-space-6)',
    ],
    '任务项：负缩进 + 24px 内缩（block 模型，与原型同构）',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-task-item::before{',
    [
      'border:1.5px solid var(--dsw-alias-label-tertiary)',
      'border-radius:5px',
      'transition:background-color var(--mdr-motion-fast) var(--mdr-ease)',
    ],
    '未勾选方框：1.5px 中性描边 + 5px 圆角 + 150ms 过渡',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-task-item:hover::before{',
    ['border-color:var(--dsw-alias-label-secondary)'],
    '任务框 hover：描边加深',
  )
  // 任务框**只读**（own-markdown.ts 渲染 disabled+readOnly）：不得出现 cursor / :focus-within
  // 这类永不触发的死规则（独立核验曾指出「写了 cursor:pointer + 焦点光环，而 input 点不动」）。
  assert.equal(
    CSS.includes('.dsh-md-render-md-task-item:focus-within'),
    false,
    '任务框不可聚焦：不得写 focus-within 光晕',
  )
  assert.equal(/dsh-md-render-md-task\{[^}]*cursor:/.test(CSS), false, '任务框不可点击：不得写 cursor')
  assertRule(
    '.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::before{',
    ['border-color:var(--mdr-accent)', 'background-color:var(--mdr-accent)'],
    '勾选态：强调色填充',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-task-item::after{',
    ['transform:rotate(45deg) scale(.6)', 'opacity:0', 'transition:transform var(--mdr-motion-fast) var(--mdr-ease)'],
    '勾形初始态：scale .6 / opacity 0（150ms 只动 transform / opacity）',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{',
    ['transform:rotate(45deg) scale(1)', 'opacity:1'],
    '勾选态：勾形弹到 scale 1',
  )
  assert.ok(CSS.includes('@supports not selector(:has(*))'), ':has() 失配时退化为原生控件（原型 @supports 块）')
  assertRule(
    '.tzx-md .dsh-md-render-md-table-wrap{',
    ['overflow-x:auto', 'border:1px solid var(--mdr-line-soft)', 'border-radius:var(--mdr-radius-md)'],
    '.md-table-wrap：横向滚动 + 发丝外框 + 12px 圆角',
  )
  assertRule(
    '.tzx-md table.dsh-md-render-md-table{',
    ['border-collapse:collapse', 'width:100%', 'font-size:var(--mdr-fs-body)', 'line-height:1.55'],
    '.md table：14px / 1.55',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-table th,.tzx-md .dsh-md-render-md-table td{',
    [
      'padding:var(--mdr-space-2) var(--mdr-space-3)',
      'text-align:left',
      'vertical-align:top',
      'border-bottom:1px solid var(--mdr-line-soft)',
    ],
    '表格单元格：8/12 内边距 + 发丝行线',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-table th{',
    ['font-weight:600', 'background:var(--mdr-surface)'],
    '表头：中立薄底（不再是强调色底）',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-table tbody tr td{',
    ['transition:background-color var(--mdr-motion-fast) var(--mdr-ease)'],
    '表格行：150ms 高频反馈',
  )
  assertRule(
    '.tzx-md .dsh-md-render-md-table tbody tr:hover td{',
    ['background:var(--mdr-tint)'],
    '行 hover：强调色 6% 薄底',
  )
  assertRule('.tzx-md .dsh-md-render-md-table tbody tr:last-child td{', ['border-bottom:0'], '末行无底线')
  for (const align of ['left', 'center', 'right']) {
    assertRule(`.tzx-md .dsh-md-render-md-${align}{`, [`text-align:${align}`], `三档对齐 class .md-${align}`)
  }
  assert.ok(
    CSS.includes('@media (max-width:768px){.tzx-md table.dsh-md-render-md-table{font-size:var(--mdr-fs-xs)}}'),
    '窄视口表格降字号（原型 768 断点同款）',
  )
})

test('markdown 耦合交互对齐原型：整段复制三态 + 图片放大浮窗', () => {
  assertRule(
    '.dsh-md-render-copy[data-state="copied"],.dsh-md-render-copy-done{',
    ['color:var(--mdr-ok-ink)', 'border-color:var(--mdr-ok-ink)'],
    '.md-copy[copied]：文字级成功色',
  )
  assertRule(
    '.dsh-md-render-copy[data-state="failed"]{',
    ['color:var(--mdr-bad-ink)'],
    '.md-copy[failed]：文字级失败色',
  )
  assertRule(
    '.dsh-md-render-copy-ico{',
    ['transition:transform var(--mdr-motion-fast) var(--mdr-ease)'],
    '复制图标 150ms 过渡',
  )
  assertRule(
    '.dsh-md-render-copy[data-state="copied"] .dsh-md-render-copy-ico{',
    ['transform:scale(1.12)'],
    '复制成功：图标 scale(1.12)',
  )
  assertRule(
    '.dsh-md-render-img-lightbox::backdrop{',
    ['background:var(--mdr-scrim)'],
    '浮窗遮罩走 --scrim token（深色不成浅灰）',
  )
  assertRule(
    '.dsh-md-render-img-lightbox{',
    ['width:92vw', 'height:92vh', 'border:0', 'background:transparent'],
    '浮窗本体透明无边框（图片直接浮在遮罩上，原型同口径）',
  )
  assertRule(
    '.dsh-md-render-img-lightbox-img{',
    ['border:1px solid var(--mdr-line)', 'border-radius:var(--mdr-radius-md)', 'box-shadow:var(--dsw-shadow-lv2)'],
    '浮窗大图：发丝边 + 12px 圆角 + 浮起阴影（原型 --elev-raised）',
  )
  assertRule(
    '.dsh-md-render-img-lightbox-wrap{',
    ['position:relative'],
    '浮窗内容包装层（关闭按钮定位锚点，同原型 .dlg-wrap）',
  )
  assertRule(
    '.dsh-md-render-img-lightbox-close{',
    ['position:absolute', 'top:-14px', 'right:-14px', 'width:32px', 'height:32px', 'border-radius:var(--mdr-pill)'],
    '关闭按钮：32px 圆形挂右上角外侧',
  )
  assertRule(
    '.dsh-md-render-img-lightbox-close::before,.dsh-md-render-img-lightbox-close::after{',
    ['width:14px', 'height:1.8px', 'background:currentColor'],
    '叉线：两条 1.8px 圆角线（等价原型 1.8 stroke path）',
  )
  assertRule(
    '.dsh-md-render-img-lightbox-close:focus-visible{',
    ['box-shadow:var(--mdr-focus-ring)'],
    '关闭按钮焦点光晕',
  )
  assertRule(
    '.dsh-md-render-img-lightbox[open]{',
    ['animation:dsh-md-render-dlg-in var(--mdr-motion-base) var(--mdr-ease)'],
    '浮窗进入 220ms',
  )
  assert.ok(
    CSS.includes(
      '@keyframes dsh-md-render-dlg-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}',
    ),
    '进入动效：opacity + scale(.985→1)',
  )
  assert.ok(CSS.includes('@keyframes dsh-md-render-dlg-backdrop-in{from{opacity:0}to{opacity:1}}'), '遮罩淡入')
})

test('动效纪律：只动 transform / opacity，且 prefers-reduced-motion 全关（不做妥协式缩短）', () => {
  assert.ok(CSS.includes('@media (prefers-reduced-motion:reduce){'), 'reduced-motion 有专门关闭块')
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion:reduce){'))
  assert.ok(
    reduced.includes('.tzx-md .dsh-md-render-md-task-item::after{transform:rotate(45deg);opacity:0;transition:none}'),
    '任务勾形在 reduced-motion 下不动，只保留终态',
  )
  assert.ok(
    reduced.includes(
      '.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{transform:rotate(45deg);opacity:1}',
    ),
    '勾选终态在 reduced-motion 下仍成立（动画不是唯一信号）',
  )
  assert.ok(
    reduced.includes('.dsh-md-render-img-lightbox[open],.dsh-md-render-img-lightbox[open]::backdrop{animation:none}'),
    '浮窗进入动效在 reduced-motion 下关掉',
  )
  assert.ok(reduced.includes('.dsh-md-render-copy,.dsh-md-render-copy-ico,'), '复制状态过渡在 reduced-motion 下关掉')
  assert.equal(CSS.includes('transition-duration:.01ms'), false, '不做「缩短到 1ms」的妥协式处理')
})

const DELIBERATE_DEVIATIONS = [
  '字号走**宿主的内容字号轴**：原型取值是「正文 14px」下的基线，实现让正文 / 表格读 --dsh-content-font-size、h1–h3 用 calc(基线 + --dsh-content-font-delta) 平移，跟随「设置 → 外观 → 字号大小」（12–17）；h5 / h6 / 小字档不缩放（与宿主对 dense secondary text 的策略一致）。原型 17px 正文是独立网页尺度，不适用于内嵌对话流',
  '整段复制按钮默认隐形（hover / focus-within / 触屏三路浮现）：样张里常显是为了看样，对话流里常显会干扰阅读',
  '颜色一律由宿主 --dsw-* 语义变量取或 color-mix 派生，不照搬原型 apple 十六进制（照搬会破宿主深浅色）',
  '插值空间用 srgb（仓库既有口径），原型用 oklab；两者在本用途下观感一致，不混用两种空间',
  '字体栈不硬编码 SF Pro：宿主已提供系统 UI 字体栈，硬编码会在非 macOS 平台掉到 Helvetica/Arial',
  '内容列宽（原型 720px）与平滑滚动归宿主消息区与宿主容器，插件不对宿主元素写规则',
  '卡片 / 代码块 / mermaid / 思考块的形状规则不在本轮范围（原型明确只覆盖 markdown 内容）',
  '阴影取宿主层级 token（--dsw-shadow-lv1/lv2）而不是原型的 --elev-raised 字面值：阴影是宿主主题资产，深色下更弱',
  '颜色类取值一律宿主语义 token（遮罩 / 行内码底 / 发丝边 / 阴影），既不照搬原型十六进制也不按原型比例混色：按比例混色的**方向**在深色态会反转（遮罩用 label-primary 55% 会得到白雾）',
  '任务框**只读**（disabled + readOnly）：原型样张可勾选是为了演示勾选态；插件里 markdown 是模型输出快照、勾选无法持久 —— 勾选态由 :has(:checked) 跟随原文 - [x] 呈现，样式里因此不写 cursor / :focus-within（防死规则）',
  '灰阶四档并三档：原型的 fg-2 与 muted 都落到宿主 label-secondary（次级的对比度安全档），meta 落到 label-tertiary（只给非文字元素如任务框描边）—— 宿主只有三档，且原型自己实测过更浅那档对 12px 小字不达 4.5:1',
  '复制按钮**不再有可见文案**：文字走 data-dsh-md-render-tip 悬停浮层（原型 .md-copy 是「图标 + 文字」的 28px 胶囊 —— 本轮按用户口径「文字默认不显示、只展示图标」改为 26px 图标按钮），完整语义留在 aria-label「复制整段 markdown」',
]

test('有意偏离逐条落实（偏离必须显式，不能静默不对齐）', () => {
  assert.ok(CSS.includes('--mdr-fs-body:var(--dsh-content-font-size,14px)'), DELIBERATE_DEVIATIONS[0])
  assert.equal(CSS.includes('--mdr-fs-body:17px'), false, '不照搬原型 17px 正文尺度')
  assert.ok(CSS.includes('.dsh-md-render-copy{opacity:0}'), DELIBERATE_DEVIATIONS[1])
  assert.deepEqual(
    [...CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]),
    [],
    DELIBERATE_DEVIATIONS[2],
  )
  assert.ok(CSS.includes('color-mix(in srgb,'), '派生色走 srgb')
  assert.equal(CSS.includes('color-mix(in oklab'), false, DELIBERATE_DEVIATIONS[3])
  assert.equal(CSS.includes('SF Pro'), false, DELIBERATE_DEVIATIONS[4])
  assert.equal(/\.tzx-md\{[^}]*max-width/.test(CSS), false, DELIBERATE_DEVIATIONS[5])
  assert.ok(CSS.includes('box-shadow:var(--dsw-shadow-lv2)'), DELIBERATE_DEVIATIONS[6])
})

test('核验补强：原型字面值 / 块体完整性 / 取值来源 / 只读行为一致性', () => {
  // ── G1 原型**字面值**（不在 :root token 里的 h3/h5 字号：此前漏测，探针改成 19px 仍全绿）──
  assert.ok(
    CSS.includes('--mdr-fs-h3:calc(14px + var(--dsh-content-font-delta,0px))'),
    '--mdr-fs-h3 基线 14px + 宿主字号增量（重构原型 .md-body h3 字面值 14px）',
  )
  assert.ok(
    CSS.includes('--mdr-fs-h5:13px'),
    '--mdr-fs-h5 基线 13px 且**不缩放**（小字档按宿主 dense-secondary 策略固定）',
  )
  // 标题间距机制：原型 4 条「加距」+ 6 条「紧贴」是一整套，逐条断言
  assertRule('.tzx-md>*+h3{', ['margin-top:var(--mdr-space-2)'], '.md>*+h3：space-2')
  assertRule('.tzx-md>*+h4,.tzx-md>*+h5,.tzx-md>*+h6{', ['margin-top:var(--mdr-space-1)'], '.md>*+h4/h5/h6：space-1')
  assertRule('.tzx-md h1+*', ['margin-top:0'], '标题后紧贴（原型 h1+* … h6+* 共 6 条）')
  for (const tag of ['h2', 'h3', 'h4', 'h5', 'h6']) {
    assert.ok(CSS.includes('.tzx-md ' + tag + '+*'), tag + '+* 紧贴规则要在（原型是 6 条一套）')
  }

  // ── G2 @supports 退化块的**块体**（此前只查了 at-rule 字符串）──
  const supports = CSS.slice(CSS.indexOf('@supports not selector(:has(*))'))
  assert.ok(
    supports.includes('.dsh-md-render-md-task{position:static;width:auto;height:auto;opacity:1;appearance:auto}'),
    '退化时真实 checkbox 恢复原生外观（不是只留一个空 @supports）',
  )
  assert.ok(
    supports.includes(
      '.tzx-md .dsh-md-render-md-task-item::before,.tzx-md .dsh-md-render-md-task-item::after{display:none}',
    ),
    '退化时不画自绘方框与勾',
  )
  // ── G2 reduced-motion 复制 / 控件组要**整串**（此前只查前缀）──
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion:reduce){'))
  assert.ok(
    reduced.includes(
      '.dsh-md-render-copy,.dsh-md-render-copy-ico,.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-text-toggle,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{transition:none}',
    ),
    '复制 / 控件组在 reduced-motion 下过渡全关（整串比对）',
  )
  // ── G2 failed 态两条都要（原型 L227：color + border-color）──
  assertRule(
    '.dsh-md-render-copy[data-state="failed"]{',
    ['color:var(--mdr-bad-ink)', 'border-color:var(--mdr-bad-ink)'],
    '.md-copy[failed]：文字与边框都走失败色',
  )

  // ── 颜色类取**宿主语义 token**（不按原型比例混色：混色方向在深色态会反转）──
  assert.ok(
    CSS.includes('--mdr-scrim:var(--dsw-alias-bg-mask-3)'),
    '遮罩取宿主固定黑遮罩 token —— 按 label-primary 比例混会在深色态变成 55% 白雾（独立核验判定的高危项）',
  )
  assert.ok(
    CSS.includes('--mdr-code-bg:var(--dsw-alias-markdown-inline-code)'),
    '行内码底色取宿主专用 token（深色态自动跟随，不会淡一档）',
  )
  assert.ok(CSS.includes('--mdr-hairline:var(--dsw-alias-border-l1)'), '发丝描边取宿主最淡边线 token')

  // ── 浮窗大图留出关闭按钮的悬挑余量（原型 86vh，不是 100%）──
  assertRule('.dsh-md-render-img-lightbox-img{', ['max-height:86vh'], '原型 img 的 86vh：关闭按钮 -14px 悬挑需要余量')
})

test('范围纪律：工具条控件层已纳入原型（本轮扩围）—— 共享控件是 26px 方格图标按钮', () => {
  // 踩过的坑：上一轮把「控件统一 28px **文字胶囊**」写进下面的共享规则后，图表卡片头变松、
  // 按钮换行、「MERMAID 图表」标题胶囊被挤到折行 —— 那是原型范围外的越界改动。
  // 本轮起卡片工具条**纳入**原型范围（08-prototype.html §sec-toolbar），但形态是
  // 「26px 方格图标按钮 + data-dsh-md-render-tip 浮层」：文字胶囊不许回来。
  const shared = rule(
    '.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{',
  )
  assert.ok(shared !== null, '共享控件规则必须在')
  assert.ok(
    shared.includes('width:26px') && shared.includes('height:26px') && shared.includes('padding:0'),
    '共享控件是 26px 方格（对齐原型 .ctl）',
  )
  assert.ok(shared.includes('justify-content:center'), '图标在方格内居中')
  assert.ok(
    shared.includes('position:relative'),
    'position:relative 是 data-dsh-md-render-tip 浮层的定位锚点（丢了浮层会飘到卡片外）',
  )
  assert.equal(shared.includes('height:28px'), false, '不许回到 28px 文字胶囊')
  assertRule('.dsh-md-render-mermaid-card-title{', ['white-space:nowrap'], '卡片标题胶囊不折行')
  assertRule('.dsh-md-render-mermaid-card-title{', ['text-overflow:ellipsis'], '头部强制一行时标题可被压缩')
})

test('工具条对齐（原型 §sec-toolbar）：常驻四项、头部一行、不重复、菜单收纳低频', () => {
  // 原型口径：卡片头常驻只剩「视图切换 + 缩放分段 + 更多」；低频（缩放模式 / 导出）进「更多」菜单。
  // 用户口径「外面有的，里面就别再有」→ 菜单里不再有「渲染为 Markdown / 源码」（与「预览 / 代码」重复）。
  // 工具条已拆到 mermaid-toolbar.ts（单文件行数门禁）：断言读两文件，等价于拆分前的整体
  const CARD =
    readFileSync(join(PLUGIN, 'src', 'client', 'parts', 'mermaid-card.ts'), 'utf8') +
    readFileSync(join(PLUGIN, 'src', 'client', 'parts', 'mermaid-toolbar.ts'), 'utf8')

  // ① 常驻四项（用户口径：全屏浮窗要「放在外面」，不藏进「更多」）
  assert.ok(CARD.includes('createElement(ViewToggle, '), '常驻：视图切换（预览 / 代码）')
  assert.ok(CARD.includes('createElement(ZoomSeg, '), '常驻：缩放分段')
  assert.ok(CARD.includes('createElement(FullscreenButton, '), '常驻：全屏浮窗')
  assert.ok(CARD.includes('createElement(CardMenu, '), '常驻：「更多」菜单')
  assert.equal(CARD.includes("item('全屏浮窗'"), false, '菜单里不再有全屏浮窗（外面有了，里面不重复）')
  assert.equal(CARD.includes('ExportButtons'), false, '导出不再是常驻按钮组（已收进菜单）')
  assert.equal(CARD.includes('CardLangSwitch'), false, '卡片头不再有「渲染为…」（与视图切换重复，防被加回来）')

  // ② 缩放三项收进**一个**胶囊（原型 .ctl-seg）：− / 百分比 / +
  assertRule('.dsh-md-render-seg{', ['display:inline-flex', 'border-radius:var(--mdr-pill)'], '缩放分段是一个胶囊')
  assert.ok(
    CARD.includes("className: 'dsh-md-render-mermaid-zoom-pct'"),
    '分段中间的百分比显示值仍在（zoom-math.ts 更新它的 textContent）',
  )

  // ③ 头部**最多一行**（原型 .mcard-head{flex-wrap:nowrap}）
  assertRule('.dsh-md-render-mermaid-card-head{', ['flex-wrap:nowrap'], '卡片头不换行')
  assertRule(
    '.dsh-md-render-mermaid-card-actions{',
    ['flex-wrap:nowrap', 'position:relative'],
    '工具条不换行 + 菜单定位锚点',
  )

  // ④ 菜单：结构与样式都在（低频操作的收纳处）
  assertRule('.dsh-md-render-menu{', ['position:absolute', 'right:0'], '菜单贴到工具条右下方')
  assert.ok(CARD.includes("className: 'dsh-md-render-menu-item'"), '菜单项')
  assert.ok(CARD.includes("role: 'menuitem'"), '菜单项语义')
  assert.ok(CARD.includes("'aria-haspopup': 'menu'"), '触发器有 aria-haspopup')

  // ⑤ 关闭路径：再点触发按钮 / 点菜单外 / Esc（Esc 归还焦点给触发按钮 —— 键盘用户不丢位置）
  assert.ok(CARD.includes("addEventListener('click', onDoc)"), '点菜单外关闭')
  assert.ok(CARD.includes("e.key !== 'Escape'"), 'Esc 关闭')
  assert.ok(CARD.includes('MENU_BTN_ATTR'), 'Esc 时按标记找回触发按钮归还焦点')

  // ⑥ 不写原生 title：自绘浮层是唯一的鼠标提示
  assert.equal(/title:/.test(CARD), false, '不写原生 title（避免与浮层重叠显示）')

  // ⑦ 极窄兜底用**容器查询**：可用宽度 = 消息列宽，不是视口
  assert.ok(CSS.includes('@container (max-width:359px)'), '极窄时百分比值让位（@container，不是 @media）')

  // ⑧ 原型侧交叉校验（原型文件存在时）
  if (existsSync(PROTOTYPE_PATH)) {
    const proto = readFileSync(PROTOTYPE_PATH, 'utf8')
    assert.ok(proto.includes('fence-actions'), '原型里有围栏块工具条（.fence-actions，实现的依据）')
    assert.ok(proto.includes('--radius-lg'), '原型里有通用设计 token 块（几何取值的唯一真源）')
  }
})

test('宿主适配：字号跟随宿主的「内容字号轴」，不许写死 px', () => {
  assert.ok(
    CSS.includes('--mdr-fs-body:var(--dsh-content-font-size,14px)'),
    '正文读宿主字号（默认 14，用户可设 12–17）',
  )
  assert.ok(CSS.includes('--mdr-fs-h4:var(--dsh-content-font-size,14px)'), 'h4 与正文同号（原型 --text-sm 就是正文档）')
  for (const [token, base] of [
    ['--mdr-fs-h1', '18px'],
    ['--mdr-fs-h2', '16px'],
    ['--mdr-fs-h3', '14px'],
  ]) {
    assert.ok(
      CSS.includes(`${token}:calc(${base} + var(--dsh-content-font-delta,0px))`),
      `${token} 必须是「原型基线 ${base} + 宿主字号增量」（宿主官方 markdown 同款写法）`,
    )
  }
  for (const token of ['--mdr-fs-h5', '--mdr-fs-h6', '--mdr-fs-xs']) {
    assert.equal(
      CSS.split(token + ':')[1]
        .split(';')[0]
        .includes('calc'),
      false,
      `${token} 小字档不缩放`,
    )
  }
  assert.ok(rule('.tzx-md{').includes('line-height:1.6'), '正文行高是相对倍数（随字号自动跟随，不需要 calc 补丁）')
})

test('构建产物与源码不漂移（原型对齐标记在 lib/client.js 里同样成立）', () => {
  for (const marker of [
    '--mdr-radius-sm:4px',
    '--mdr-radius-md:8px',
    '--mdr-radius-lg:10px',
    '--mdr-pill:980px',
    '--mdr-fs-h1:calc(18px',
    '--mdr-motion-base:220ms',
    '--mdr-scrim:',
    '.dsh-md-render-copy[data-state="copied"]',
    '.dsh-md-render-img-lightbox-close::before',
    '@keyframes dsh-md-render-dlg-in',
    '@media (prefers-reduced-motion:reduce){',
  ]) {
    assert.ok(CODE.includes(marker), '产物缺少原型对齐标记：' + marker)
  }
})

test.skipIf(!existsSync(PROTOTYPE_PATH))('本文件抄录的原型取值与原型文件一致（防期望值漂移）', () => {
  const proto = readFileSync(PROTOTYPE_PATH, 'utf8')
  for (const [protoToken, pluginToken, value, impl] of TOKEN_MAP) {
    const re = new RegExp(protoToken + '\\s*:\\s*' + value.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
    assert.ok(re.test(proto), `原型文件里 ${protoToken} 不是 ${value} —— 本测试的期望值该更新了`)
    assert.ok(CSS.includes(`${pluginToken}:${impl}`), `插件里 ${pluginToken} 不是 ${impl}`)
  }
})
