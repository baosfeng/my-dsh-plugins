/**
 * 代码卡「推断语言」呈现单测（内容识别 / 项目主语言兜底）—— 不依赖整体 bundle。
 *
 * 口径（接口契约由 Lead 定）：
 *  · MdrCodeBlock 的 `inferred` = 'content' | 'project'，缺省 / 空串 = 原文有语言标注；
 *  · 推断时语言胶囊（span.mdr-pill.mdr-fence-pill）加 is-inferred + data-mdr-lang-inferred，
 *    浮层文案走 data-mdr-tip（复用 [data-mdr-tip] 机制，**不写原生 title**），胶囊文字仍是
 *    大写语言名（CSS text-transform 负责）；
 *  · 底栏说明能看出「语言是推断的」，原文标注时保持现状（不出现推断字样）；
 *  · styles-code.ts 的 .mdr-fence-pill.is-inferred 只做克制的视觉区分，颜色全取
 *    --dsw-* / --mdr-* 变量，既有 .mdr-fence-pill 几何不动。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

import { transformSync } from '@babel/core'
import presetTypescript from '@babel/preset-typescript'

const here = dirname(fileURLToPath(import.meta.url))
const partsDir = join(here, '..', 'src', 'client', 'parts')

function readPart(name) {
  return readFileSync(join(partsDir, name), 'utf8')
}

/** 剔除注释后的源码（静态断言只认代码）。 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** 用 babel 把 TS 片段转成可执行 JS，在独立 vm 沙箱里求值（片段无 import/export 语句）。 */
function loadPart(name, globals = {}) {
  const source = readPart(name)
  const compiled = transformSync(source, {
    filename: name,
    babelrc: false,
    configFile: false,
    presets: [[presetTypescript, {}]],
  }).code
  const exports = {}
  const sandbox = {
    exports,
    module: { exports },
    console,
    setTimeout,
    clearTimeout,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    ...globals,
  }
  vm.createContext(sandbox)
  vm.runInContext(compiled, sandbox)
  return { exports, sandbox }
}

function loadOwnCode(globals = {}) {
  return loadPart('own-code.ts', {
    HLJS_ASSET: 'hljs',
    ensureRenderAsset: () => null,
    icon: { wrap: () => ({ icon: 'wrap' }), lines: () => ({ icon: 'lines' }) },
    MdrCopyButton: () => ({ type: 'button', props: {}, children: [] }),
    MdrLangSwitchFrom: () => ({ type: 'span', props: {}, children: [] }),
    ...globals,
  })
}

/** 头部 / 语言胶囊 / 底栏说明的 vdom 取值（与 own-code 的固定结构一致）。 */
const pillOf = (block) => block.children[0].children[0]
const noteOf = (block) => block.children[2].children[0].children[0]

// ── ① 推断 = 'project' / 'content'：胶囊标记 + 浮层 + 底栏说明 ─────────────────

test('inferred=project：胶囊 is-inferred + data-mdr-lang-inferred + 浮层「按项目推断」', () => {
  const { exports } = loadOwnCode()
  const block = exports.MdrCodeBlock({ lang: 'kotlin', code: 'val a = 1', inferred: 'project' })
  const pill = pillOf(block)
  assert.equal(pill.type, 'span', '语言胶囊是 span')
  assert.equal(pill.props.className, 'mdr-pill mdr-fence-pill is-inferred', '胶囊加 is-inferred')
  assert.equal(pill.props['data-mdr-lang-inferred'], 'project', '推断来源写在胶囊上')
  assert.equal(pill.props['data-mdr-tip'], '按项目推断', '浮层文案 = 按项目推断')
  assert.equal(pill.props.title, undefined, '不写原生 title（复用 [data-mdr-tip]）')
  assert.equal(pill.children[0], 'kotlin', '胶囊文字仍是语言名（大写由 CSS 负责）')
  assert.equal(noteOf(block), '1 行 · kotlin · 按项目推断', '底栏写明是推断来的')
})

test('inferred=content：胶囊 is-inferred + data-mdr-lang-inferred + 浮层「按内容推断」', () => {
  const { exports } = loadOwnCode()
  const block = exports.MdrCodeBlock({ lang: 'python', code: 'print(1)\nprint(2)', inferred: 'content' })
  const pill = pillOf(block)
  assert.equal(pill.props.className, 'mdr-pill mdr-fence-pill is-inferred', '胶囊加 is-inferred')
  assert.equal(pill.props['data-mdr-lang-inferred'], 'content', '推断来源写在胶囊上')
  assert.equal(pill.props['data-mdr-tip'], '按内容推断', '浮层文案 = 按内容推断')
  assert.equal(pill.props.title, undefined, '不写原生 title')
  assert.equal(pill.children[0], 'python', '胶囊文字仍是语言名')
  assert.equal(noteOf(block), '2 行 · python · 按内容推断', '底栏写明是推断来的')
})

test('推断 + 语言位为空（防御）：胶囊留空仍对读屏隐藏，底栏只写推断来源', () => {
  const { exports } = loadOwnCode()
  const block = exports.MdrCodeBlock({ lang: '', code: 'x', inferred: 'project' })
  const pill = pillOf(block)
  assert.equal(pill.props['aria-hidden'], 'true', '空胶囊对读屏隐藏')
  assert.equal(pill.children[0], '', '不编造语言名')
  assert.equal(pill.props['data-mdr-lang-inferred'], 'project', '推断来源仍可查')
  assert.equal(noteOf(block), '1 行 · 按项目推断', '底栏只有推断来源')
})

// ── ② 非推断：现状不变（不出现任何推断标识）────────────────────────────────

test('非推断（缺省 / 空串 / 未知值）：胶囊与底栏保持现状，不出现推断标识', () => {
  const { exports } = loadOwnCode()
  for (const inferred of [undefined, '', 'guessed']) {
    const props = { lang: 'js', code: 'const a = 1' }
    if (inferred !== undefined) props.inferred = inferred
    const block = exports.MdrCodeBlock(props)
    const pill = pillOf(block)
    const tag = String(inferred)
    assert.equal(pill.props.className, 'mdr-pill mdr-fence-pill', tag + ': 胶囊类名与现状一致')
    assert.equal(pill.props['data-mdr-lang-inferred'], undefined, tag + ': 无推断来源属性')
    assert.equal(pill.props['data-mdr-tip'], undefined, tag + ': 无推断浮层')
    assert.equal(pill.props.title, undefined, tag + ': 无原生 title')
    assert.equal(pill.children[0], 'js', tag + ': 语言名原样')
    assert.equal(noteOf(block), '1 行 · js', tag + ': 底栏不出现推断字样')
  }
})

test('非推断：底栏两条既有文案（有语言 / 未标注语言）逐字不变', () => {
  const { exports } = loadOwnCode()
  assert.equal(noteOf(exports.MdrCodeBlock({ lang: 'js', code: 'a\nb\nc' })), '3 行 · js', '原文标注：行数 · 语言')
  assert.equal(noteOf(exports.MdrCodeBlock({ lang: '', code: 'x' })), '1 行 · 未标注语言', '未标注语言不编造')
})

// ── ③ 纯函数 / 属性口径 ───────────────────────────────────────────────────

test('langInferredOf / fencePillProps / fenceLineNote：只认 content | project', () => {
  const { exports } = loadOwnCode()
  assert.equal(exports.langInferredOf('content'), 'content', 'content 保留')
  assert.equal(exports.langInferredOf('project'), 'project', 'project 保留')
  assert.equal(exports.langInferredOf(''), '', '空串 = 非推断')
  assert.equal(exports.langInferredOf(undefined), '', '缺省 = 非推断')
  assert.equal(exports.langInferredOf('content '), '', '不猜近似值')
  // vm 沙箱里的对象原型与主 realm 不同，逐字段比较（不用 deepEqual）。
  assert.equal(exports.MDR_INFERRED_LABEL.content, '按内容推断', '内容推断短标签')
  assert.equal(exports.MDR_INFERRED_LABEL.project, '按项目推断', '项目推断短标签')
  const inferredProps = exports.fencePillProps('go', 'content')
  assert.equal(inferredProps.className, 'mdr-pill mdr-fence-pill is-inferred', '类名口径')
  assert.equal(inferredProps['data-mdr-tip'], '按内容推断', '浮层口径')
  assert.equal(inferredProps['aria-hidden'], undefined, '有语言时不隐藏')
  const plainProps = exports.fencePillProps('', '')
  assert.equal(plainProps.className, 'mdr-pill mdr-fence-pill', '非推断类名不变')
  assert.equal(plainProps['aria-hidden'], 'true', '空语言胶囊对读屏隐藏')
  assert.equal(plainProps['data-mdr-lang-inferred'], undefined, '非推断无来源属性')
  assert.equal(plainProps['data-mdr-tip'], undefined, '非推断无浮层')
  assert.equal(exports.fenceLineNote('a\nb', 'js', 'project'), '2 行 · js · 按项目推断', '底栏推断分支')
  assert.equal(exports.fenceLineNote('a', 'js'), '1 行 · js', '底栏原文标注分支（缺省推断参数）')
})

// ── ④ 样式：推断态克制区分 + 既有胶囊几何不动 + 零裸色值 ──────────────────────

test('styles-code：.mdr-fence-pill.is-inferred 虚线边区分，既有胶囊几何与字号不动', () => {
  const css = codeOnly(readPart('styles-code.ts'))
  const inferred = /\.mdr-fence-pill\.is-inferred\{([^}]*)\}/.exec(css)
  assert.ok(inferred, '推断态有独立规则')
  const body = inferred[1]
  assert.ok(body.includes('border:1px dashed'), '虚线边（克制的视觉区分）')
  assert.ok(body.includes('box-sizing:border-box'), '边框收进既有 19px 高，不改胶囊占位')
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(body), false, '推断态不写裸十六进制')
  assert.ok(
    body.includes('var(--mdr-frame-') || body.includes('color-mix(in srgb,var(--mdr-frame-'),
    '颜色取自有 --mdr-* 变量',
  )
  // 既有 .mdr-fence-pill 几何 / 字号 / 大写保持原值（门禁已在 mdr-styles / prototype-alignment 钉住）
  const base = /\.mdr-fence-pill\{([^}]*)\}/.exec(css)
  assert.ok(base, '既有语言胶囊规则仍在')
  for (const snippet of [
    'height:19px',
    'padding:0 7px',
    'border-radius:var(--mdr-radius-sm)',
    'font-size:10px',
    'font-weight:600',
    'letter-spacing:0.06em',
    'text-transform:uppercase',
  ]) {
    assert.ok(base[1].includes(snippet), '既有胶囊取值不变：' + snippet)
  }
  assert.equal(base[1].includes('border:'), false, '既有胶囊不加边框（几何不动，改动只落在 is-inferred）')
  // 卡是 overflow:hidden（头高 32px），浮层朝上会被裁掉 → 推断胶囊的浮层朝下（同一套 [data-mdr-tip] 机制）。
  const tipRule = /\.mdr-fence-pill\.is-inferred\[data-mdr-tip\]::after\{([^}]*)\}/.exec(css)
  assert.ok(tipRule, '推断胶囊浮层有定位规则')
  assert.ok(tipRule[1].includes('top:calc(100% + 6px)'), '浮层朝下，落在卡片可视区内')
  assert.ok(tipRule[1].includes('bottom:auto'), '覆盖默认的朝上定位')
})

test('own-code 静态：推断标识复用既有机制（CSS 类 + data-mdr-* + [data-mdr-tip]）', () => {
  const code = codeOnly(readPart('own-code.ts'))
  assert.ok(code.includes("MDR_FENCE_PILL_INFERRED = 'is-inferred'"), '状态类名集中定义')
  assert.ok(code.includes("'data-mdr-lang-inferred'"), '推断来源属性')
  assert.ok(code.includes("'data-mdr-tip'"), '浮层走既有 data-mdr-tip')
  assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(code), false, '不拼 HTML')
  assert.equal(/classList|cssText|\.style\./.test(code), false, '不写 classList / cssText / el.style')
})
