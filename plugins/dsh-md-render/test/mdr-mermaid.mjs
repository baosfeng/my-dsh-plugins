/**
 * mermaid 卡片（C 路）静态断言 + 纯函数单测。
 *
 * 判据来源：docs/md渲染/重构契约.md §二/§四/§五/§七 + 原型
 * （docs/原型重构/dsh-md-render.html 3203–3361 / 3811–3841 / CSS 1617–1937）。
 *
 * 覆盖：
 *  · STYLES_MERMAID 的关键几何（卡头 7/8/7/10、标题胶囊 22/6/11/600/40%、kind 10px、
 *    工具条 24×24、缩放分段、菜单分组标签与勾、卡体 14/190/点阵、全屏 90vw×85vh + 遮罩、
 *    失败态），且颜色只走宿主变量（无裸十六进制、无 --shiki-token-*）；
 *  · 交互纪律：不写 classList / cssText / el.style，不新增 sidebarRightTabs；
 *  · 契约签名 MdrMermaidCard({source,kind,title})、原生 <dialog> 全屏、底栏三态常显；
 *  · 解析层懒加载（mermaid / panzoom 都不进 bundle）；
 *  · 纯函数：类型 / 标题提取、导出文件名、缩放夹逼、降级引擎尺寸。
 * 不依赖 lib/client.js（共享工作树里有他路中间态）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const MERMAID_FILES = [
  'src/client/parts/styles-mermaid.ts',
  'src/client/parts/mermaid-engine.ts',
  'src/client/parts/mermaid-card.ts',
  'src/client/parts/mermaid-toolbar.ts',
  'src/client/parts/mermaid-scan.ts',
  'src/client/parts/mermaid-export.ts',
  'src/client/parts/mermaid-zoom.ts',
  'src/client/parts/zoom-math.ts',
  'src/client/parts/zoom-fallback.ts',
]

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const CODE = MERMAID_FILES.map((file) => stripComments(read(file))).join('\n')
const MERMAID_CSS = stripComments(read('src/client/parts/styles-mermaid.ts'))

// ── 纯函数抽取（TS 片段无 import/export，测试只取纯函数体做等价执行）──────
function balancedIndex(source, start, open, close) {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const c = source[i]
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  throw new Error('unbalanced ' + open + ' from ' + String(start))
}

function stripParamTypes(params) {
  let out = ''
  let depth = 0
  let current = ''
  const flush = () => {
    const trimmed = current.trim()
    if (trimmed !== '') {
      const colon = trimmed.indexOf(':')
      out += (out === '' ? '' : ', ') + (colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed)
    }
  }
  for (const ch of params) {
    if (ch === '{' || ch === '(' || ch === '[') depth += 1
    if (ch === '}' || ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      flush()
      current = ''
      continue
    }
    current += ch
  }
  flush()
  return out
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, 'function ' + name + ' not found')
  const parenStart = source.indexOf('(', start)
  const parenEnd = balancedIndex(source, parenStart, '(', ')')
  // 返回类型可能是对象字面量（如 : { w: number; h: number }）：跳过类型里的花括号。
  let braceStart = source.indexOf('{', parenEnd)
  let braceEnd = balancedIndex(source, braceStart, '{', '}')
  let next = braceEnd + 1
  while (next < source.length && /\s/.test(source[next])) next += 1
  if (source[next] === '{') {
    braceStart = next
    braceEnd = balancedIndex(source, braceStart, '{', '}')
  }
  const params = stripParamTypes(source.slice(parenStart + 1, parenEnd))
  return 'function ' + name + '(' + params + ') ' + source.slice(braceStart, braceEnd + 1)
}

function extractConst(source, name) {
  const start = source.indexOf('const ' + name)
  assert.notEqual(start, -1, 'const ' + name + ' not found')
  const eq = source.indexOf('=', start)
  let valueStart = eq + 1
  while (valueStart < source.length && /\s/.test(source[valueStart])) valueStart += 1
  const first = source[valueStart]
  if (first === '[' || first === '{') {
    const end = balancedIndex(source, valueStart, first, first === '[' ? ']' : '}')
    return 'const ' + name + ' = ' + source.slice(valueStart, end + 1)
  }
  return 'const ' + name + ' = ' + source.slice(valueStart, source.indexOf('\n', valueStart)).trim()
}

function loadPure(functionNames, constNames, source) {
  const code = constNames
    .map((name) => extractConst(source, name))
    .concat(functionNames.map((name) => extractFunction(source, name)))
    .join('\n')
  return new Function(code + '\nreturn { ' + functionNames.join(', ') + ' }')()
}

// ── 样式几何与配色口径 ──────────────────────────────────────────────────
test('styles-mermaid：导出 STYLES_MERMAID 且关键几何照原型', () => {
  assert.match(MERMAID_CSS, /const STYLES_MERMAID: string = `/)
  const required = [
    '.mdr-mm-head{display:flex;align-items:center;gap:7px;padding:7px 8px 7px 10px;border-bottom:1px solid var(--mdr-mm-line-soft)',
    '.mdr-mm-title{',
    'height:22px',
    'border-radius:6px',
    'font-size:11px',
    'font-weight:600',
    'max-width:40%',
    '.mdr-mm-kind{font-size:10px',
    '.mdr-mm-toolbar .mdr-icon-btn{width:24px;height:24px}',
    '.mdr-mm-zoom{display:inline-flex;align-items:center;gap:0;height:24px',
    '.mdr-mm-zoom-val{min-width:42px',
    '.mdr-mm-menu-label{',
    '.mdr-mm-menu-item[aria-checked="true"]',
    '.mdr-mm-body{padding:14px',
    'min-height:190px',
    'radial-gradient(circle at 1px 1px',
    '.mdr-mm-foot{',
    '.mdr-mm-modes{',
    '.mdr-mm-error{',
    '.mdr-mm-dialog{width:90vw;height:85vh',
    '.mdr-mm-dialog::backdrop{background:var(--mdr-mm-scrim)',
    '.md-code-block[data-dsh-md-render-mermaid-view] pre',
  ]
  for (const snippet of required) assert.ok(MERMAID_CSS.includes(snippet), 'missing css: ' + snippet)
})

test('styles-mermaid：颜色只取宿主语义变量（无裸十六进制 / 无 shiki token）', () => {
  assert.equal(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/.test(MERMAID_CSS), false, 'no bare hex colors')
  assert.equal(MERMAID_CSS.includes('--shiki-token-'), false, 'no shiki palette')
  assert.ok(MERMAID_CSS.includes('var(--dsw-alias-'), 'uses host semantic tokens')
  assert.ok(MERMAID_CSS.includes('color-mix(in srgb'), 'derives colors with color-mix')
})

test('交互纪律：不写 classList / cssText / el.style / 新 sidebarRightTabs', () => {
  assert.equal(/classList\.(add|remove|toggle|contains)/.test(CODE), false, 'no classList mutation')
  assert.equal(CODE.includes('cssText'), false, 'no cssText writes')
  assert.equal(/\b[A-Za-z_$][\w$]*\.style\./.test(CODE), false, 'no inline style writes')
  assert.equal(CODE.includes('sidebarRightTabs'), false, 'no right-sidebar tabs')
  // setAttribute 只写自有 data-* 标记或 SVG 几何属性
  const literalAttrs = [...CODE.matchAll(/\.setAttribute\(\s*'([^']+)'/g)].map((m) => m[1])
  const allowed = new Set(['aria-hidden', 'width', 'height', 'data-mdr-mm-engine'])
  for (const attr of new Set(literalAttrs)) assert.ok(allowed.has(attr), 'unexpected setAttribute: ' + attr)
  for (const constant of ['MERMAID_VIEW_ATTR', 'MERMAID_ENTRY_ATTR', 'MERMAID_STATE_ATTR', 'OFFSCREEN_ATTR']) {
    assert.ok(
      CODE.includes('setAttribute(' + constant) || CODE.includes('exports.' + constant),
      'attr used: ' + constant,
    )
  }
})

test('卡片契约：MdrMermaidCard({source,kind,title}) 与原生 dialog 全屏', () => {
  const card = read('src/client/parts/mermaid-card.ts')
  assert.ok(card.includes('function MdrMermaidCard(props: { source: string; kind: string; title: string }): unknown'))
  assert.ok(card.includes('exports.MdrMermaidCard = MdrMermaidCard'))
  assert.ok(card.includes("createElement(\n    'dialog'") || card.includes("'dialog'"), 'native dialog element')
  assert.ok(card.includes('showModal'), 'uses native modal dialog')
  assert.ok(card.includes("aria-label': 'mermaid 全屏'"), 'dialog labelled')
  // 底栏三态常显（图表 / Markdown / 源码）+ 「渲染为…」标签
  const toolbar = read('src/client/parts/mermaid-toolbar.ts')
  for (const label of ["'渲染为…'", "'图表'", "'Markdown'", "'源码'"]) {
    assert.ok(toolbar.includes(label), 'mode label missing: ' + label)
  }
  assert.ok(toolbar.includes("aria-pressed': props.view === value"), 'mode buttons expose pressed state')
  assert.ok(toolbar.includes("'缩放模式'"), 'menu group label 缩放模式')
  assert.ok(toolbar.includes("role: 'menuitemradio'"), 'zoom fit items are menuitemradio')
})

test('解析层懒加载：mermaid / panzoom 走运行时脚本，不进 bundle', () => {
  const engine = read('src/client/parts/mermaid-engine.ts')
  assert.ok(engine.includes('ensureRenderAsset(MERMAID_ASSET)'), 'prefers render-assets channel')
  assert.ok(engine.includes('fetch(MERMAID_ENGINE_URL)'), 'fetches vendored engine lazily')
  assert.equal(/require\(['"]mermaid['"]\)/.test(engine), false, 'no bundled mermaid')
  const zoom = read('src/client/parts/mermaid-zoom.ts')
  assert.ok(zoom.includes('fetch(PANZOOM_SCRIPT_URL)'), 'fetches panzoom lazily')
  assert.equal(/require\(['"]panzoom['"]\)/.test(zoom), false, 'no bundled panzoom')
  // 离屏渲染失败容器（mermaid 10.9.3 的错误图形只落在这里）
  assert.ok(engine.includes('function renderSvg(') && engine.includes('dropOffscreen'))
})

test('流式稳定窗口与扫描导出保持（scanner 契约）', () => {
  const scan = read('src/client/parts/mermaid-scan.ts')
  assert.ok(scan.includes('const STREAM_SETTLE_MS = 400'))
  assert.ok(scan.includes('exports.scanMermaidBlocks = scanMermaidBlocks'))
  assert.ok(scan.includes('exports.teardownMermaid = teardownMermaid'))
  assert.ok(
    scan.includes('createElement(MdrMermaidCard, { source: source, kind: kind, title: mermaidTitleOf(source, kind) })'),
  )
})

// ── 纯函数 ─────────────────────────────────────────────────────────────
test('纯函数：mermaid 类型 / 标题提取', () => {
  const scan = read('src/client/parts/mermaid-scan.ts')
  const api = loadPure(
    ['mermaidKindOf', 'mermaidTitleOf', 'mmCanonicalKind', 'mmSkipKindLine'],
    ['MM_KIND_NAMES'],
    scan,
  )
  assert.equal(api.mermaidKindOf('flowchart TD\n  A-->B'), 'flowchart')
  assert.equal(api.mermaidKindOf('graph LR\n  A-->B'), 'flowchart')
  assert.equal(api.mermaidKindOf('sequenceDiagram\n  A->>B: hi'), 'sequenceDiagram')
  assert.equal(api.mermaidKindOf('stateDiagram-v2\n  [*] --> A'), 'stateDiagram')
  assert.equal(api.mermaidKindOf('%%{init: {"theme":"dark"}}%%\nflowchart LR\n  A-->B'), 'flowchart')
  assert.equal(api.mermaidKindOf('plain words'), 'mermaid')
  assert.equal(api.mermaidTitleOf('---\ntitle: 重试流程图\n---\nflowchart TD\n  A-->B', 'flowchart'), '重试流程图')
  assert.equal(api.mermaidTitleOf('flowchart TD\n  accTitle: 请求链路\n  A-->B', 'flowchart'), '请求链路')
  assert.equal(api.mermaidTitleOf('flowchart TD\n  A-->B', 'flowchart'), 'flowchart')
})

test('纯函数：导出文件名按作用域 id 取序号', () => {
  const api = loadPure(['buildExportFileName'], [], read('src/client/parts/mermaid-export.ts'))
  assert.equal(api.buildExportFileName('mdr-mm-7', 'png'), 'mermaid-7.png')
  assert.equal(api.buildExportFileName('mdr-mm-12-fs', 'svg'), 'mermaid-12.svg')
  assert.equal(api.buildExportFileName('mdr-mm', 'svg'), 'mermaid-1.svg')
})

test('纯函数：缩放夹逼 50–200%（步进 25%）', () => {
  const math = read('src/client/parts/zoom-math.ts')
  assert.ok(math.includes('const ZOOM_MIN = 0.5'))
  assert.ok(math.includes('const ZOOM_MAX = 2'))
  assert.ok(math.includes('const ZOOM_STEP = 1.25'))
  const api = loadPure(['zoomClamp'], ['ZOOM_MIN', 'ZOOM_MAX'], math)
  assert.equal(api.zoomClamp(0.2), 0.5)
  assert.equal(api.zoomClamp(3), 2)
  assert.equal(api.zoomClamp(1.25), 1.25)
})

test('纯函数：降级引擎按比例缩放 SVG 尺寸', () => {
  const api = loadPure(['fallbackSvgSize'], [], read('src/client/parts/zoom-fallback.ts'))
  assert.deepEqual(api.fallbackSvgSize({ w: 600, h: 250 }, 1.5), { w: 900, h: 375 })
  assert.deepEqual(api.fallbackSvgSize({ w: 100, h: 50 }, 0), { w: 100, h: 50 })
  assert.deepEqual(api.fallbackSvgSize({ w: 10, h: 10 }, 0.5), { w: 5, h: 5 })
})
