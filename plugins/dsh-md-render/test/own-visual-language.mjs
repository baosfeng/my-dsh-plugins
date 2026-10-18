/**
 * 自研**视觉语言**静态断言 —— 用户口径（最高优先级）：「全部使用我们自己的，外观也是」。
 *
 * 背景：渲染内核换成自研之后，样式表 src/client/parts/styles.ts 仍**逐像素对齐官方**
 * （--dsw-font-markdown-* 排版 shorthand、--shiki-token-* 语法调色板、--dsw-alias-accent*
 * 这些宿主里根本不存在的 token），用户看不出任何变化。本文件把「外观是插件自己的」钉死：
 *
 *  1. 取色只走宿主**语义变量**，不出现裸十六进制（硬编码会破坏深色主题）；
 *  2. 不再引用官方 markdown 排版 shorthand 与官方 shiki 调色板（那正是「照抄」的两处）；
 *  3. 自有设计 token（圆角 / 胶囊 / 等宽栈 / 强调色）与三张卡片同源；
 *  4. 代码块辨识点：语言胶囊、头部非通栏灰带、复制 hover/focus/触屏三路浮现、左侧强调竖条；
 *  5. markdown 辨识点：h1 竖条 / h2 下边框 / 引用块 / 表格 / 行内代码胶囊；
 *  6. 无障碍：自有控件都有插件强调色的可见 focus 环；
 *  7. 语法着色映射到插件自己的 --mdr-syn-*（全部由宿主语义色 color-mix 得到）。
 *
 * 反向验证：把 styles.ts 改回旧值（照抄官方）→ 本文件第 2、7 条立刻变红。
 * 断言对象同时覆盖**源码**与**构建产物**（防止「改了源码没重建」造成产物漂移）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
const SRC = readFileSync(join(here, '..', 'src', 'client', 'parts', 'styles.ts'), 'utf8')

/** 剔除块注释与行注释（与 static-assertions.mjs 同一口径：注释里提禁令不算命中）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const CODE = stripComments(RAW)
const CSS = stripComments(SRC)

test('外观取色只走宿主语义变量：样式里没有裸十六进制（深色主题不被破坏）', () => {
  const hex = [...CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
  assert.deepEqual(hex, [], '样式不得硬编码十六进制色值，颜色一律取 --dsw-* 语义变量')
  assert.ok(CSS.includes('color-mix(in srgb,var(--dsw-alias-'), '透明度 / 派生色用 color-mix 由宿主色算出来')
})

test('不再照抄官方外观：不引用官方 markdown 排版 shorthand / shiki 调色板 / 不存在的 accent token', () => {
  assert.equal(
    CSS.includes('--dsw-font-markdown-'),
    false,
    '字体 / 字号 / 行高由插件自己定义，不再取官方 markdown 排版 shorthand',
  )
  assert.equal(CSS.includes('--shiki-token-'), false, '语法着色不再逐 token 对齐官方 shiki 调色板')
  assert.equal(
    CSS.includes('--dsw-alias-accent'),
    false,
    '不引用宿主里根本不存在的 --dsw-alias-accent*（旧实现是静默失效）',
  )
})

test('自有设计 token：圆角 / 胶囊 / 线 / 强调色 / 等宽栈都是插件自己的尺度', () => {
  for (const token of [
    '--mdr-accent:',
    '--mdr-accent-text:',
    '--mdr-accent-soft:',
    '--mdr-accent-line:',
    '--mdr-tint:',
    '--mdr-code-bg:',
    '--mdr-hairline:',
    '--mdr-ok-ink:',
    '--mdr-bad-ink:',
    '--mdr-scrim:',
    '--mdr-line:',
    '--mdr-line-soft:',
    '--mdr-line-strong:',
    '--mdr-surface:',
    '--mdr-radius-sm:4px',
    '--mdr-radius-md:8px',
    '--mdr-radius-lg:10px',
    '--mdr-pill:980px',
    '--mdr-fs-h1:calc(18px',
    '--mdr-fs-h6:12px',
    '--mdr-fs-body:var(--dsh-content-font-size',
    '--mdr-space-3:12px',
    '--mdr-motion-fast:150ms',
    '--mdr-motion-base:220ms',
    '--mdr-ease:cubic-bezier(0.28,0,0.22,1)',
    '--mdr-focus-ring:',
    '--mdr-focus-ring-inset:',
    '--mdr-mono:',
  ]) {
    assert.ok(CSS.includes(token), '缺少自有设计 token ' + token)
  }
  assert.ok(
    CSS.includes('--mdr-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link))'),
    '强调色取宿主业务强调色（深浅色自动跟随），带宿主级 fallback',
  )
  assert.ok(CSS.includes('--mdr-mono:var(--ds-font-family-code'), '等宽栈取宿主代码字体，fallback 写在插件侧')
})

test('代码块辨识点：语言胶囊 + 非通栏灰带头部 + 复制三路浮现 + 左侧强调竖条 + 保真滚动', () => {
  assert.ok(CSS.includes('text-transform:uppercase'), '语言名做成大写胶囊标签（官方是 11px 灰字）')
  assert.ok(CSS.includes('.dsh-md-render-code-lang:empty{display:none}'), '语言识别失败时不留空胶囊')
  assert.ok(CSS.includes('.dsh-md-render-code-copy{opacity:0}'), '复制按钮默认隐形')
  assert.ok(
    CSS.includes(
      '.dsh-md-render-code:hover .dsh-md-render-code-copy,.dsh-md-render-code:focus-within .dsh-md-render-code-copy{opacity:1}',
    ),
    'hover 与键盘 focus-within 两路浮现',
  )
  assert.ok(
    CSS.includes('@media (hover:none){.dsh-md-render-code-copy{opacity:1}}'),
    '触屏常显（只做 hover 手机点不到）',
  )
  assert.ok(
    !CSS.includes('border-left:3px solid var(--mdr-accent)'),
    '代码卡片用统一发丝边框（重构原型去掉左侧强调竖条）',
  )
  assert.ok(
    CSS.includes('background:var(--dsw-alias-markdown-code-block-banner)'),
    '头部取宿主 banner 薄底（重构原型）',
  )
  assert.ok(
    CSS.includes('white-space:pre;overflow-wrap:normal;word-break:normal'),
    '长行横向滚动保真（官方是 pre-wrap + break-all）',
  )
  assert.ok(CSS.includes('font-size:12.5px;line-height:1.7'), '代码排版是自有尺度（官方 11px/19px）')
})

test('markdown 自有层级与形状：h1 竖条 / h2 下边框 / 引用块 / 渐隐分隔线 / 表格 / 行内代码胶囊', () => {
  assert.ok(
    CSS.includes('.tzx-md h1{') && !CSS.includes('border-left:3px solid var(--mdr-accent-line)'),
    'h1 无竖条（重构原型：标题只靠字号与字重分层）',
  )
  assert.ok(
    CSS.includes('.tzx-md h2{') && CSS.includes('border-bottom:1px solid var(--mdr-line-soft)'),
    'h2 下边框走发丝线',
  )
  assert.ok(
    CSS.includes('font-size:var(--mdr-fs-h1);line-height:1.4'),
    'h1 字号 / 行高取自有阶梯 token（重构原型 18px/1.4）',
  )
  assert.ok(CSS.includes('line-height:1.6'), '正文行高 1.6（原型 §E3 的中文正文口径）')
  assert.ok(CSS.includes('border-radius:0 7px 7px 0'), '引用块：左 2px 强调竖线 + 强调薄底 + 7px 圆角（重构原型）')
  assert.ok(
    CSS.includes('linear-gradient(90deg,transparent,var(--mdr-line) 15%'),
    '分隔线是两侧渐隐的发丝线（自有形状）',
  )
  assert.ok(
    CSS.includes(
      '.dsh-md-render-md-table-wrap{overflow-x:auto;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md)}',
    ),
    '表格：圆角外框',
  )
  assert.ok(
    CSS.includes('.dsh-md-render-md-table th{font-weight:600;background:var(--mdr-surface)}'),
    '表头中性薄底（原型口径，不再是强调色底）',
  )
  assert.ok(CSS.includes('font-size:.86em'), '行内代码胶囊（字号相对正文收敛，原型 .86em）')
  assert.ok(
    CSS.includes(
      '.dsh-md-render-md-task{position:absolute;left:0;top:6px;width:15px;height:15px;margin:0;appearance:none',
    ),
    '任务列表勾选框自绘（原生 disabled checkbox 不认 accent-color，实测恒为灰）',
  )
  assert.ok(CSS.includes(':has(>.dsh-md-render-md-task:checked)::before'), ':has() 驱动勾选态填色')
  assert.ok(CSS.includes('@supports not selector(:has(*))'), ':has() 失配时退化为原生勾选框')
  assert.ok(CSS.includes('li::marker{color:var(--mdr-accent-text)'), '列表标记染色（自有强调方式）')
})

test('统一设计系统：代码卡片 / markdown 卡片 / 图表卡片同一套边框 · 圆角 · 层次', () => {
  assert.ok(
    CSS.includes(
      '.dsh-md-render-text-md{padding:14px 16px 16px 18px;border:1px solid var(--mdr-line);border-left:2px solid var(--mdr-accent-line);border-radius:var(--mdr-radius-md)',
    ),
    'markdown 卡片与代码卡片同源（同边框 / 同圆角 / 同底色）',
  )
  assert.ok(
    CSS.includes(
      'border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)',
    ),
    '图表卡片同层次',
  )
  assert.ok(
    CSS.includes('.dsh-md-render-mermaid-card-title{') && CSS.includes('border-radius:var(--mdr-pill)'),
    '卡片标题与语言胶囊同一「标签」形态',
  )
  assert.ok(
    CSS.includes('.dsh-md-render-mermaid-view-toggle>.dsh-md-render-mermaid-vt-active'),
    '分段控件激活态走自有强调色（旧实现引用不存在的 --dsw-alias-accent）',
  )
})

test('无障碍：自有控件都有插件强调色的可见 focus 环（宿主指针模态下官方描边会被抹掉）', () => {
  for (const sel of [
    '.dsh-md-render-code-copy:focus-visible',
    '.dsh-md-render-text-toggle:focus-visible',
    '.dsh-md-render-copy:focus-visible',
    '.dsh-md-render-mermaid-eb:focus-visible',
    '.dsh-md-render-mermaid-vt:focus-visible',
    '.dsh-md-render-code-pre:focus-visible',
    '.tzx-md a:focus-visible',
    '.dsh-md-render-img-lightbox-close:focus-visible',
  ]) {
    assert.ok(CSS.includes(sel), '缺少 focus 可见样式：' + sel)
  }
  // 焦点语言统一为「强调色光晕」（原型 --focus-ring：0 0 0 4px accent 35%）；
  // 被 overflow 裁掉的滚动区用 inset 变体。旧实现是 2px outline。
  assert.ok(
    CSS.includes('--mdr-focus-ring:0 0 0 4px color-mix(in srgb,var(--mdr-accent) 35%,transparent)'),
    '焦点光晕取插件强调色 35%',
  )
  assert.ok(CSS.includes('box-shadow:var(--mdr-focus-ring)}'), '焦点可见态落到光晕上')
  assert.ok(CSS.includes('--mdr-focus-ring-inset:inset 0 0 0 4px'), '滚动区内缩变体（不被 overflow 裁掉）')
  assert.equal(CSS.includes('outline:2px solid var(--mdr-accent)'), false, '不再保留 2px outline 的旧焦点语言')
})

test('语法着色是插件自己的语义映射：每色由宿主语义色取或派生', () => {
  const decls = [...CSS.matchAll(/--mdr-syn-[a-z]+:[^;\n]+/g)].map((m) => m[0])
  assert.ok(decls.length >= 7, '语法色定义齐全（keyword / string / number / function / comment / variable / deleted）')
  for (const decl of decls) {
    assert.ok(
      /^--mdr-syn-[a-z]+:(color-mix\(in srgb,)?var\(--dsw-alias-/.test(decl),
      '语法色必须来自宿主语义变量（直接取或 color-mix 派生，深浅色自动跟随）：' + decl,
    )
  }
  const owners = [...CSS.matchAll(/\.dsh-md-render-code-pre \.hljs-[^{]*\{color:var\((--[^,)]+)\)/g)].map((m) => m[1])
  assert.ok(owners.length >= 6, 'hljs scope → 颜色的映射规则齐全')
  for (const name of owners) {
    assert.ok(
      name.startsWith('--mdr-syn-') || name === '--dsw-alias-link',
      '高亮取色只能来自插件自有映射（或宿主链接色）：' + name,
    )
  }
})

test('控件只显示图标：文字走悬停浮层（零布局位移）；每个按钮都必须有图标', () => {
  // 机制：data-dsh-md-render-tip → ::after **浮层**（absolute + 向下弹），**不是**就地撑开 ——
  // 就地撑开会把同一行相邻按钮推开，鼠标扫过整排抖动（本轮的改版理由，别再改回去）。
  assert.ok(
    CSS.includes('[data-dsh-md-render-tip]::after{content:attr(data-dsh-md-render-tip)'),
    '浮层文字来自 data-dsh-md-render-tip',
  )
  assert.ok(CSS.includes('top:calc(100% + 5px);right:0'), '浮层绝对定位、向下弹（零布局位移）')
  assert.equal(CSS.includes('.dsh-md-render-btn-label'), false, '旧的「就地撑开」机制已撤回，不得混用两套')
  assert.ok(CSS.includes('[data-dsh-md-render-tip]:hover::after'), 'hover 显示')
  assert.ok(CSS.includes('[data-dsh-md-render-tip]:focus-visible::after'), '键盘聚焦显示')
  // 状态变化不能只靠悬停才知道：复制成功 / 失败时浮层常显（配合图标换勾 + 语义色）
  assert.ok(CSS.includes('.dsh-md-render-copy[data-state="copied"]::after'), '整段复制成功态常显')
  assert.ok(CSS.includes('.dsh-md-render-code-copy[data-state="copied"]::after'), '代码块复制成功态常显')
  // 触屏没有 hover：按钮就地带文字（否则只剩图标，无从判断按钮做什么）
  assert.ok(CSS.includes('[data-dsh-md-render-tip]::before{content:attr(data-dsh-md-render-tip)'), '触屏按钮带文字常显')
  // 不写原生 title：自绘浮层是唯一的鼠标提示（两者并存会延迟 1s 重叠显示）
  // 工具条已拆到 mermaid-toolbar.ts：读两文件（等价于拆分前的整体）
  const CARD =
    readFileSync(join(here, '..', 'src', 'client', 'parts', 'mermaid-card.ts'), 'utf8') +
    readFileSync(join(here, '..', 'src', 'client', 'parts', 'mermaid-toolbar.ts'), 'utf8')
  assert.equal(/title:/.test(CARD), false, '不写原生 title（鼠标提示统一走 data-dsh-md-render-tip 浮层）')
  // 每个按钮都必须有图标（文字收起后没图标就是空按钮）—— 本轮补齐的共享图标
  const ICONS = readFileSync(join(here, '..', '..', 'dsh-shared', 'client-parts', 'icons.part.js'), 'utf8')
  for (const name of ['maximize', 'fit', 'fill', 'minus', 'wrap', 'markdown', 'eye', 'chart', 'more']) {
    assert.ok(new RegExp('^  ' + name + ': ', 'm').test(ICONS), '共享图标集要有 ' + name)
  }
  // 收纳纪律：低频操作进菜单，不再长期霸占卡片头
  assert.ok(CARD.includes("className: 'dsh-md-render-seg'"), '缩放分段在')
  assert.ok(CARD.includes("className: 'dsh-md-render-menu'"), '「更多」菜单在')
  assert.ok(CARD.includes('dsh-md-render-menu-item'), '菜单项在')
  assert.ok(CSS.includes('.dsh-md-render-menu-item'), '菜单项样式在')
})

test('构建产物里也是这套外观（源码与产物不漂移）', () => {
  for (const marker of [
    '--mdr-accent:',
    '--mdr-radius-md:8px',
    '--mdr-motion-fast:150ms',
    '.dsh-md-render-code-copy{opacity:0}',
    '.dsh-md-render-mermaid-view-toggle>.dsh-md-render-mermaid-vt-active',
  ]) {
    assert.ok(CODE.includes(marker), '产物缺少自有外观标记：' + marker)
  }
  assert.equal(CODE.includes('--shiki-token-'), false, '产物里不得残留官方 shiki 调色板引用')
  assert.equal(CODE.includes('--dsw-font-markdown-'), false, '产物里不得残留官方 markdown 排版 shorthand')
})
