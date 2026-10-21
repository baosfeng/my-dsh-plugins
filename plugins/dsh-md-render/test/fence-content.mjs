/**
 * 无语言围栏的内容分流（fence-content.ts）：像 markdown 文档 / 像代码。
 *
 * 背景（真实会话取证，2026-10-20 android-monitor 会话 session-4fa88602）：
 * 208 个围栏里 **200 个没有语言标记**（184 个在思考块里），内容是 Kotlin / Compose
 * 代码 —— 旧口径「确证无语言 → 一律 markdown」把换行吃成一坨，代码读不了。
 *
 * 判据口径（保守，两条硬门槛）：
 *  · markdown 块级特征（标题 / 表格分隔 / 表格行 / 引用 / 列表 / 分隔线）加权 ≥ 2；
 *  · **零代码特征**（行首关键字 / 注解 / 行尾 `;{}`/`=>` / 缩进续行 / 运算符）——有任何一条即按代码卡。
 * 代价不对称：误判成代码只是「没美化」，误判成 markdown 会破坏代码结构。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createPage, createReactStub, installGlobals, loadBundle } from './support/fake-dom.mjs'

const page = installGlobals(createPage())
const loaded = loadBundle({ page, react: createReactStub() })
const looksLikeMarkdown = loaded.exports.fenceLooksLikeMarkdown
const score = loaded.exports.scoreFenceContent
assert.equal(typeof looksLikeMarkdown, 'function', 'fenceLooksLikeMarkdown 由产物导出')

/** 真实会话里的无语言围栏内容（摘自 android-monitor 会话事件流）。 */
const REAL_CODE = [
  'private const val GRID_COLUMNS = 6',
  '@Composable',
  'internal fun BoxScope.CategorySheet(...) {',
  '  if (!visible) return',
  '  val rows = remember(categories) { categories.chunked(GRID_COLUMNS) }',
  '  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(t.space2)) {',
  '    row.forEach { category -> CategoryGridCell(..., modifier = Modifier.weight(1f)) }',
  '  }',
  '}',
].join('\n')

test('真实会话里的 Kotlin 片段 → 不判 markdown（代码特征在场）', () => {
  assert.equal(looksLikeMarkdown(REAL_CODE), false)
  assert.ok(score(REAL_CODE).code > 0, '命中代码特征')
})

test('单行代码 / 日志 / SQL / shell → 不判 markdown', () => {
  const samples = [
    'val prefs by lazy { context.getSharedPreferences("finance_prefs", Context.MODE_PRIVATE) }',
    '2026-10-20 23:04:12.382  4711-4733  ActivityManager  I  Start proc com.example',
    'SELECT id, name FROM categories WHERE enabled = 1 ORDER BY sort_order;',
    'adb shell am force-stop com.example.app && adb shell monkey -p com.example.app 1',
    'diff --git a/app/src/main/java/Foo.kt b/app/src/main/java/Foo.kt',
  ]
  for (const text of samples) {
    assert.equal(looksLikeMarkdown(text), false, '不判 markdown：' + JSON.stringify(text.slice(0, 40)))
  }
})

test('markdown 文档（标题 / 列表 / 表格 / 引用）→ 判 markdown', () => {
  const samples = [
    '## 分类抽屉改 6 列\n\n- 图标 32dp\n- 间距 space2',
    '| 项 | 值 |\n| --- | --- |\n| 图标 | 32dp |',
    '> 注意：SheetShell 外取不到 LocalDesignTokens\n\n1. 先取 t\n2. 再排列',
    '# 结论\n\n正文一段，含 **加粗** 与 `行内代码`。',
    '改 6 列\n\n- 一行 6 个\n- 图标缩到 32dp',
  ]
  for (const text of samples) {
    assert.equal(looksLikeMarkdown(text), true, '判 markdown：' + JSON.stringify(text.slice(0, 40)))
  }
})

test('混合内容：markdown 里夹一行代码 → 保守判代码（宁可不变形）', () => {
  const mixed = '## 改法\n\nval rows = categories.chunked(6)\n\n- 注意间距'
  assert.equal(looksLikeMarkdown(mixed), false, '出现代码特征即不 markdown 化')
})

test('纯散文无标记 / 空内容 → 不判 markdown（按代码卡，可一键切换）', () => {
  for (const text of [
    '',
    '   ',
    '一句话说明，没有任何 markdown 标记。',
    '现在改 RecordSheets 的分类抽屉为 6 列固定网格',
  ]) {
    assert.equal(looksLikeMarkdown(text), false, '不判 markdown：' + JSON.stringify(text))
  }
})

test('分数字段可解释：markdown 分与代码分各自独立计数', () => {
  const s = score('## 标题\n\n- 一\n\nval a = 1')
  assert.ok(s.markdown >= 1, 'markdown 特征计分')
  assert.ok(s.code >= 1, '代码特征计分')
})
