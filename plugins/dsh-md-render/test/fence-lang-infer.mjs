/**
 * 无语言围栏的语言推断（fence-lang-infer.ts）：内容识别 → 项目主语言兜底。
 *
 * 背景（真实会话取证，2026-10-20 android-monitor）：208 个围栏里 200 个没有语言标记，
 * 内容是 Kotlin / SQL / shell 代码。内容识别是纯函数（零 IO）；项目主语言走 host 半
 * `GET /md-render/api/project-lang`（只 stat 构建标记文件，见 test/project-lang-route.mjs）。
 *
 * 钉住的语义：
 *  · 内容识别只认**特征明确**的语言（认不出返回 ''，绝不瞎猜）；
 *  · 推断值只影响**高亮 + 胶囊 + 推断标识**，不改变 markdown/代码分流；
 *  · 项目兜底失败 / 无会话 cwd / 开关关闭 → 静默留空（行为回到修复前）；
 *  · 推断标识写在块上（data-mdr-lang-inferred=content|project）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLangIndex } from '../lib/lang-index.js'
import {
  createPage,
  createReactStub,
  createRenderStack,
  installGlobals,
  installLangFetchStub,
  loadBundle,
  makeElement,
  makeRealHostCodeBlock,
} from './support/fake-dom.mjs'

const PILL = 'span.mdr-fence-pill'
const INFER_ATTR = 'data-mdr-lang-inferred'
const VIEW_ATTR = 'data-mdr-view'
const KOTLIN = [
  'private const val GRID_COLUMNS = 6',
  '@Composable',
  'internal fun BoxScope.CategorySheet(...) {',
  '  val rows = remember(categories) { categories.chunked(GRID_COLUMNS) }',
  '}',
].join('\n')

// ── ① 纯函数：内容识别 ────────────────────────────────────────────────────
const page0 = installGlobals(createPage())
const loaded0 = loadBundle({ page: page0, react: createReactStub() })
const infer = loaded0.exports.inferLangByContent
assert.equal(typeof infer, 'function', 'inferLangByContent 由产物导出')

test('内容识别：Kotlin / Java / Python / TS / JS / SQL / JSON / shell / HTML / CSS', () => {
  const cases = [
    [KOTLIN, 'kotlin'],
    ['object AutoBookLegacyRemark {', 'kotlin'],
    ['public static void main(String[] args) {', 'java'],
    ['def aggregate(merchant, desc):\n    return parts', 'python'],
    ['interface User { id: string }', 'typescript'],
    ['const a = 1\nconsole.log(a)', 'javascript'],
    ['SELECT id, name FROM categories WHERE enabled = 1;', 'sql'],
    ['{"a": 1, "b": [1, 2]}', 'json'],
    ['adb shell am force-stop com.example.app', 'bash'],
    ['#!/usr/bin/env bash\necho hi', 'bash'],
    ['export JAVA_HOME=/opt/homebrew/opt/openjdk@21\n~/android-platform-tools/adb install -r app.apk', 'bash'],
    ['$ gradlew assembleDebug', 'bash'],
    ['<!DOCTYPE html>\n<div>hi</div>', 'html'],
    ['.foo { color: red; }', 'css'],
    ['#include <stdio.h>\nint main() {}', 'cpp'],
  ]
  for (const [code, lang] of cases) {
    assert.equal(infer(code), lang, JSON.stringify(code.slice(0, 30)) + ' → ' + lang)
  }
})

test('SQL 片段（没有 SELECT 开头）也能认：LIKE / WHERE … AND', () => {
  assert.equal(infer("\"${COL_SOURCE} LIKE 'auto\\_%' ESCAPE '\\\\' AND status = 1\""), 'sql')
  assert.equal(infer('id, name FROM categories WHERE enabled = 1 AND hidden = 0'), 'sql')
})

test('日志检测：时间戳行占多数 → 不参与项目主语言兜底', () => {
  const looksLikeLog = loaded0.exports.looksLikeLog
  assert.equal(looksLikeLog('22:57:54.890 识别到账单页面行: 账单详情\n22:57:54.899 详情页没有匹配到已记账记录'), true)
  assert.equal(looksLikeLog('2026-10-20 22:57:54.890  INFO  started\n2026-10-20 22:57:55.001  WARN  retry'), true)
  assert.equal(looksLikeLog('val rows = categories.chunked(6)\nfun render() {}'), false, '代码不是日志')
  assert.equal(looksLikeLog(''), false)
})

test('内容识别：认不出就返回空串（绝不瞎猜）', () => {
  for (const code of ['', '   ', '一句话说明，没有代码特征。', '中文笔记：今天改 6 列', '- 一\n- 二', '## 标题']) {
    assert.equal(infer(code), '', JSON.stringify(code) + ' → 留空')
  }
})

// ── ② 接入：无语言块拿到推断语言与标识 ───────────────────────────────────
/** 会话服务桩（cwd 走 binding().session.getSnapshot()）。 */
function sessionCtx(cwd, entries = []) {
  const eventSource = { getSnapshot: () => ({ entries, hasMore: false, revision: 1 }) }
  const sessions = {
    list: { getSnapshot: () => ({ byId: { s1: { id: 's1', cwd, retainedBy: { mainView: 1 } } } }) },
    binding: (id) =>
      id === 's1' ? { sessionId: 's1', eventSource, session: { getSnapshot: () => ({ cwd }) } } : undefined,
  }
  return { effect: (fn) => fn(), get: (name) => (name === 'sessions' ? sessions : undefined) }
}

const entry = (seq, markdown) => ({
  type: 'event',
  event: {
    seq,
    type: 'assistant/message',
    surfaceOp: 'append',
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: markdown }] } },
  },
})

/** 装配：一个无语言围栏块 + 会话 cwd + （可选）project-lang 桩答案。 */
function setup({ code = KOTLIN, cwd = '', projectLang = '', fail = false } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const block = makeRealHostCodeBlock({ code })
  scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react, { assets: false })
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const base = installLangFetchStub(createLangIndex(), { fail })
  const baseFetch = globalThis.fetch
  const projectCalls = []
  globalThis.fetch = (url) => {
    const href = String(url)
    if (href.includes('/project-lang')) {
      projectCalls.push(href)
      if (fail) return Promise.reject(new Error('offline'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: { lang: projectLang } }) })
    }
    return baseFetch(url)
  }
  // 事件流里的围栏内容与 DOM 完全一致 → 命中「确证无语言」（走内容分流的真实路径）。
  const fence = ['```', code, '```'].join('\n')
  const ctx = sessionCtx(cwd, [entry(1, fence)])
  loaded.exports.apply(ctx)
  return { page, loaded, block, projectCalls, restore: () => base.restore() }
}

/** 等异步（project-lang 请求 + 重扫）落定。 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('无语言 + 内容像 Kotlin → 胶囊显示 KOTLIN，块带 data-mdr-lang-inferred=content', () => {
  const { block, projectCalls, restore } = setup({ code: KOTLIN })
  assert.equal(block.getAttribute(VIEW_ATTR), 'code', '仍走代码卡（分流不被推断改变）')
  assert.equal(block.getAttribute(INFER_ATTR), 'content', '推断来源 = 内容识别')
  assert.equal(block.querySelector(PILL).textContent.toLowerCase(), 'kotlin', '胶囊显示推断语言')
  assert.equal(projectCalls.length, 0, '内容识别命中 → 不请求项目语言（零 RPC）')
  restore()
})

test('无语言 + 内容认不出 + 项目主语言 kotlin → 胶囊 KOTLIN，来源=project', async () => {
  const plain = 'notes about nothing in particular\njust prose here'
  const { block, projectCalls, restore } = setup({ code: plain, cwd: '/tmp/project-a', projectLang: 'kotlin' })
  assert.equal(block.getAttribute(INFER_ATTR), null, '首个同步轮还没拿到项目语言（先留空）')
  await settle()
  assert.ok(projectCalls.length >= 1, '请求过一次项目语言')
  assert.equal(block.getAttribute(INFER_ATTR), 'project', '推断来源 = 项目主语言')
  assert.equal(block.querySelector(PILL).textContent.toLowerCase(), 'kotlin', '胶囊显示项目主语言')
  restore()
})

test('日志块 + 项目主语言可用 → 仍留空（不给日志硬贴高亮语言）', async () => {
  const log = '22:57:54.890 识别到账单页面行: 账单详情 淘宝闪购\n22:57:54.899 详情页没有匹配到已记账记录'
  const { block, restore } = setup({ code: log, cwd: '/tmp/project-log', projectLang: 'kotlin' })
  await settle()
  assert.equal(block.getAttribute(INFER_ATTR), null, '日志不推断')
  assert.equal(block.querySelector(PILL).textContent, '', '语言位留空')
  restore()
})

test('项目探测失败 / 没有 cwd → 语言位留空（静默降级）', async () => {
  const plain = 'notes about nothing in particular'
  for (const options of [
    { code: plain, cwd: '/tmp/other', projectLang: '', fail: false },
    { code: plain, cwd: '' },
  ]) {
    const { block, restore } = setup(options)
    await settle()
    assert.equal(block.getAttribute(INFER_ATTR), null, '没有推断标识')
    assert.equal(block.querySelector(PILL).textContent, '', '语言位留空')
    restore()
  }
})

test('设置开关 inferLang=false → 推断整体停用（纯函数层直接返回空）', () => {
  const { block, loaded, restore } = setup({ code: KOTLIN })
  loaded.exports.setRenderOptions({ markdown: { inferLang: false } })
  assert.deepEqual(loaded.exports.inferredFenceLang(block), { lang: '', source: '' }, '开关关闭 → 不推断')
  loaded.exports.setRenderOptions({ markdown: { inferLang: true } })
  assert.equal(loaded.exports.inferredFenceLang(block).lang, 'kotlin', '开关恢复 → 继续推断')
  restore()
})
