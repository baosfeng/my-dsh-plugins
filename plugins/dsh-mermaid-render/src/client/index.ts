/**
 * dsh-mermaid-render — client 端入口（TypeScript 源码，单文件）。
 *
 * 构建流程：`tsc -p tsconfig.client.json` 把本文件编译为 CommonJS 单文件
 * （lib/.client-build/index.js），scripts/build.mjs 再注入
 * lib/client.src.js 模板的 __CLIENT_BUNDLE__ 占位符，写出
 * lib/client.js（DSH 实际服务的 __ModuleLoader__ bundle）。
 *
 * 约束：client 端 TS 源码为单文件（无运行时相对 import——编译产物内联进
 * factory 作用域后，require 只认识 DSH 运行时注入的模块，如 react）。
 * 类型声明可拆文件（import type 编译期擦除）；需要多文件/复杂打包时可用
 * esbuild/tsdown（官方 tsdown.client.ts 协议）。
 *
 * 功能：渲染 mermaid/mmd 代码块为图表卡片，支持预览/代码切换、导出 PNG/SVG、
 * 复制源码。引擎内联（base64 vendored），完全离线可用。
 */

// ── DSH 运行时类型（client 端最小契约，内联声明）──────────────────────

/** client 端 Context（cordis Context 最小契约）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
}

// ── 导入 React（DSH 运行时注入的模块）────────────────────────────────

import { createElement, useEffect, useState, type ReactNode } from 'react'
import * as reactDomClient from 'react-dom/client'

// ── 类型声明 ─────────────────────────────────────────────────────────

/** mermaid 引擎类型（window.mermaid）。 */
interface MermaidEngine {
  initialize(config: { startOnLoad: boolean; securityLevel: string }): void
  render(id: string, source: string): Promise<{ svg: string }>
}

/** 导出处理器。 */
interface ExportHandlers {
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}

/** 通知状态。 */
interface Notice {
  type: 'ok' | 'error'
  text: string
}

/** 图标规格。 */
type IconSpec = [string, string, string]

// ── 全局声明 ─────────────────────────────────────────────────────────

// Client 端运行在浏览器环境，window.mermaid 由 vendored 引擎注入
// 使用 any 类型避免复杂的全局声明
declare const window: Window & { mermaid?: MermaidEngine }

// Client 端编译为 CommonJS，需要声明 exports 变量
declare const exports: Record<string, unknown>

// ── engine part：vendored mermaid engine ─────────────────────────────

const MERMAID_UMD_B64: string = '__MERMAID_UMD_B64__' // 须在字符串字面量内（构建替换为 base64）；勿写同形字面量

/** base64 解码为 UTF-8 字符串。 */
function b64ToUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

const MERMAID_UMD: string = typeof atob === 'function' ? b64ToUtf8(MERMAID_UMD_B64) : ''

let mermaidReady: Promise<MermaidEngine> | null = null

/** Load (or reuse) the embedded mermaid engine on window.mermaid. */
function ensureMermaid(): Promise<MermaidEngine> {
  if (typeof window !== 'undefined' && window.mermaid) {
    try {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    } catch {
      /* already initialized */
    }
    return Promise.resolve(window.mermaid)
  }
  if (mermaidReady) return mermaidReady
  mermaidReady = new Promise((resolve, reject) => {
    try {
      if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
        reject(new Error('no document to inject mermaid'))
        return
      }
      const script = document.createElement('script')
      script.textContent = MERMAID_UMD
      script.onerror = () => reject(new Error('mermaid engine failed to load'))
      document.head.appendChild(script)
      const m = typeof window !== 'undefined' ? window.mermaid : undefined
      if (!m) {
        reject(new Error('mermaid engine missing after injection'))
        return
      }
      m.initialize({ startOnLoad: false, securityLevel: 'strict' })
      resolve(m)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
  return mermaidReady
}

// ── detection: md-code-block + code.language-mermaid / -mmd ─────────

/** 检查是否为 mermaid 代码块。 */
function isMermaidBlock(block: Element): boolean {
  try {
    const code = block.querySelector('code')
    if (!code) return false
    const cls = String(code.className || '').toLowerCase()
    return cls.includes('language-mermaid') || cls.includes('language-mmd')
  } catch {
    return false
  }
}

/** 提取代码块源码。 */
function sourceOf(block: Element): string {
  try {
    const pre = block.querySelector('pre')
    return pre ? pre.textContent || '' : ''
  } catch {
    return ''
  }
}

// ── icons part：shared icons ────────────────────────────────────────

const ICON_STROKE = 1.8
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iconSvg = (children: any[], size: number) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    children.map((child, i) =>
      child === null || child === undefined || typeof child === 'boolean'
        ? child
        : createElement(child.type, { key: i, ...child.props }),
    ),
  )

const icon = {
  clock: (size = 16) =>
    iconSvg([createElement('circle', { cx: 12, cy: 12, r: 9 }), createElement('path', { d: 'M12 7v5l3 2' })], size),
  refresh: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        createElement('polyline', { points: '21 3 21 9 15 9' }),
      ],
      size,
    ),
  trash: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 6h18' }),
        createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
        createElement('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
      ],
      size,
    ),
  chevronRight: (size = 14) => iconSvg([createElement('polyline', { points: '9 6 15 12 9 18' })], size),
  chevronDown: (size = 14) => iconSvg([createElement('polyline', { points: '6 9 12 15 18 9' })], size),
  file: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        createElement('path', { d: 'M14 2v6h6' }),
      ],
      size,
    ),
  folder: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        }),
      ],
      size,
    ),
  external: (size = 15) =>
    iconSvg(
      [
        createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
        createElement('polyline', { points: '15 3 21 3 21 9' }),
        createElement('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
      ],
      size,
    ),
  close: (size = 15) =>
    iconSvg(
      [
        createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
      ],
      size,
    ),
  help: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 9 }),
        createElement('path', { d: 'M9.1 9.2a3 3 0 0 1 5.8 1.2c0 1.8-2.7 2.4-2.7 3.6' }),
        createElement('line', { x1: 12, y1: 17.2, x2: 12.01, y2: 17.2 }),
      ],
      size,
    ),
  check: (size = 16) => iconSvg([createElement('polyline', { points: '20 6 9 17 4 12' })], size),
  plus: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
        createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
      ],
      size,
    ),
  pencil: (size = 15) =>
    iconSvg([createElement('path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' })], size),
  search: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 11, cy: 11, r: 8 }),
        createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
      ],
      size,
    ),
  settings: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
        createElement('path', {
          d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
        }),
      ],
      size,
    ),
  alert: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        }),
        createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ],
      size,
    ),
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
}

// ── FILE_BADGES：文件类型图标 ───────────────────────────────────────

const FILE_BADGES: Record<string, IconSpec> = {
  js: ['#F7DF1E', '#323330', 'JS'],
  mjs: ['#F7DF1E', '#323330', 'JS'],
  cjs: ['#F7DF1E', '#323330', 'JS'],
  ts: ['#3178C6', '#ffffff', 'TS'],
  mts: ['#3178C6', '#ffffff', 'TS'],
  cts: ['#3178C6', '#ffffff', 'TS'],
  tsx: ['#3178C6', '#ffffff', 'TSX'],
  jsx: ['#3178C6', '#ffffff', 'JSX'],
  java: ['#007396', '#ffffff', 'JAVA'],
  c: ['#A8B9CC', '#111111', 'C'],
  cpp: ['#00599C', '#ffffff', 'C++'],
  cxx: ['#00599C', '#ffffff', 'C++'],
  cc: ['#00599C', '#ffffff', 'C++'],
  hpp: ['#00599C', '#ffffff', 'C++'],
  h: ['#A8B9CC', '#111111', 'H'],
  hh: ['#A8B9CC', '#111111', 'H'],
  cs: ['#68217A', '#ffffff', 'C#'],
  csharp: ['#68217A', '#ffffff', 'C#'],
  go: ['#00ADD8', '#ffffff', 'GO'],
  rs: ['#CE422B', '#ffffff', 'RS'],
  rb: ['#B51624', '#ffffff', 'RB'],
  php: ['#777BB4', '#ffffff', 'PHP'],
  py: ['#3776AB', '#ffffff', 'PY'],
  swift: ['#F05138', '#ffffff', 'SWIFT'],
  kt: ['#7F52FF', '#ffffff', 'KT'],
  kotlin: ['#7F52FF', '#ffffff', 'KT'],
  dart: ['#0175C2', '#ffffff', 'DART'],
  scala: ['#DC322F', '#ffffff', 'SCALA'],
  lua: ['#2C2C7C', '#ffffff', 'LUA'],
  pl: ['#0298C3', '#ffffff', 'PERL'],
  r: ['#336DC3', '#ffffff', 'R'],
  m: ['#C1272D', '#ffffff', 'MAT'],
  mm: ['#C1272D', '#ffffff', 'MAT'],
  html: ['#E34F26', '#ffffff', '</>'],
  htm: ['#E34F26', '#ffffff', '</>'],
  css: ['#663399', '#ffffff', 'CSS'],
  scss: ['#CD6799', '#ffffff', 'SCSS'],
  sass: ['#CD6799', '#ffffff', 'SCSS'],
  vue: ['#42B883', '#ffffff', 'VUE'],
  svelte: ['#FF3E00', '#ffffff', 'SVELTE'],
  json: ['#F7DF1E', '#323330', '{}'],
  sql: ['#00758F', '#ffffff', 'SQL'],
  csv: ['#2E7D32', '#ffffff', 'CSV'],
  db: ['#0F62FE', '#ffffff', 'DB'],
  sqlite: ['#0F62FE', '#ffffff', 'DB'],
  sqlite3: ['#0F62FE', '#ffffff', 'DB'],
  xml: ['#FF6F00', '#ffffff', 'XML'],
  svg: ['#FF6F00', '#ffffff', 'SVG'],
  md: ['#42A5F5', '#ffffff', 'M↓'],
  markdown: ['#42A5F5', '#ffffff', 'M↓'],
  txt: ['#90A4AE', '#ffffff', 'TXT'],
  text: ['#90A4AE', '#ffffff', 'TXT'],
  log: ['#90A4AE', '#ffffff', 'TXT'],
  pdf: ['#E5202B', '#ffffff', 'PDF'],
  doc: ['#2B579A', '#ffffff', 'DOC'],
  docx: ['#2B579A', '#ffffff', 'DOC'],
  xls: ['#217346', '#ffffff', 'XLS'],
  xlsx: ['#217346', '#ffffff', 'XLS'],
  ppt: ['#D24726', '#ffffff', 'PPT'],
  pptx: ['#D24726', '#ffffff', 'PPT'],
  yml: ['#CB171E', '#ffffff', 'YML'],
  yaml: ['#CB171E', '#ffffff', 'YML'],
  toml: ['#8D6E63', '#ffffff', 'TOML'],
  ini: ['#546E7A', '#ffffff', 'CFG'],
  cfg: ['#546E7A', '#ffffff', 'CFG'],
  config: ['#546E7A', '#ffffff', 'CFG'],
  env: ['#F9A825', '#323330', 'ENV'],
  properties: ['#7B1FA2', '#ffffff', 'PROP'],
  lock: ['#37474F', '#ffffff', 'LOCK'],
  dockerfile: ['#2496ED', '#ffffff', 'DOCK'],
  docker: ['#2496ED', '#ffffff', 'DOCK'],
  makefile: ['#607D8B', '#ffffff', 'MAKE'],
  gradle: ['#02303A', '#ffffff', 'GRADLE'],
  cmake: ['#265774', '#ffffff', 'CMAKE'],
  ipynb: ['#F37726', '#ffffff', 'JNB'],
  sh: ['#89E051', '#111111', '>_'],
  bash: ['#89E051', '#111111', '>_'],
  zsh: ['#89E051', '#111111', '>_'],
  ps1: ['#012456', '#ffffff', 'PS1'],
  bat: ['#546E7A', '#ffffff', 'CMD'],
  cmd: ['#546E7A', '#ffffff', 'CMD'],
  zip: ['#FFA726', '#323330', 'ZIP'],
  tar: ['#FFA726', '#323330', 'ZIP'],
  gz: ['#FFA726', '#323330', 'ZIP'],
  '7z': ['#FFA726', '#323330', 'ZIP'],
  rar: ['#FFA726', '#323330', 'ZIP'],
  exe: ['#0078D4', '#ffffff', 'EXE'],
  msi: ['#0078D4', '#ffffff', 'EXE'],
  wasm: ['#654FF0', '#ffffff', 'WASM'],
  png: ['#8E44AD', '#ffffff', 'IMG'],
  jpg: ['#8E44AD', '#ffffff', 'IMG'],
  jpeg: ['#8E44AD', '#ffffff', 'IMG'],
  gif: ['#8E44AD', '#ffffff', 'IMG'],
  webp: ['#8E44AD', '#ffffff', 'IMG'],
  ico: ['#8E44AD', '#ffffff', 'IMG'],
  bmp: ['#8E44AD', '#ffffff', 'IMG'],
  gitignore: ['#F05032', '#ffffff', 'GIT'],
  gitattributes: ['#F05032', '#ffffff', 'GIT'],
}

/** One self-colored badge svg: rounded brand rect + short contrast mark. */
const badgeIcon = ([bg, fg, mark]: IconSpec, size: number) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
    },
    createElement('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: bg }),
    createElement(
      'text',
      {
        x: 12,
        y: 16,
        textAnchor: 'middle',
        fontSize: mark.length <= 2 ? 9 : mark.length <= 4 ? 7 : 5.5,
        fontWeight: 700,
        fill: fg,
      },
      mark,
    ),
  )

/** File-type icon dispatcher: branded badge for known extensions, the
 *  neutral file icon for everything else. */
const fileIconByExt = (ext: string | null | undefined, size = 14) => {
  const spec =
    FILE_BADGES[
      String(ext ?? '')
        .toLowerCase()
        .replace(/^\./, '')
    ]
  return spec === undefined ? icon.file(size) : badgeIcon(spec, size)
}

// ── export part：PNG/SVG download + copy source ─────────────────────

/** 默认文件名：mermaid-<序号>.<ext>（序号取自 entryId，如 dsh-mermaid-3 → 3）。 */
function buildExportFileName(entryId: string, ext: string): string {
  const m = /(\d+)/.exec(String(entryId || ''))
  return 'mermaid-' + (m ? m[1] : '1') + '.' + ext
}

/** 序列化 SVG DOM 为字符串；缺 xmlns 时补上（Image 加载 SVG 必需）。 */
function serializeSvg(svgEl: SVGElement): string {
  const xml = new XMLSerializer().serializeToString(svgEl)
  return xml.includes('xmlns') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
}

/** 触发浏览器下载：Blob → 临时 a[download] → click → 延迟 revoke URL。 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 下载 SVG：序列化 → Blob(image/svg+xml) → 下载。 */
function downloadSvgFile(svgEl: SVGElement, fileName: string): void {
  const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' })
  downloadBlob(blob, fileName)
}

/** 下载 PNG：SVG → Image → canvas(2x) → toBlob → 下载；失败 reject。 */
function downloadPngFile(svgEl: SVGElement, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let url = ''
    try {
      const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' })
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        try {
          const scale = 2
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas 2d 上下文不可用')
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(url)
            if (!pngBlob) {
              reject(new Error('PNG 编码失败'))
              return
            }
            downloadBlob(pngBlob, fileName)
            resolve()
          }, 'image/png')
        } catch (err) {
          URL.revokeObjectURL(url)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('SVG 图片加载失败'))
      }
      img.src = url
    } catch (err) {
      URL.revokeObjectURL(url)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** 复制文本：clipboard API 优先，失败回退 execCommand；失败 reject。 */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  }
  return Promise.resolve(fallbackCopy(text))
}

/** execCommand 回退复制（clipboard API 不可用/被拒时）。 */
function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('复制失败')
}

/** 从卡片 DOM 取渲染出的 SVG 元素（按 entryId 定位，避免多卡片串扰）。 */
function findCardSvg(entryId: string): SVGElement | null {
  if (typeof document === 'undefined' || document === null) return null
  const host = document.querySelector('[data-dsh-mermaid-render-entry="' + entryId + '"]')
  if (!host || !host.querySelector) return null
  return host.querySelector('svg')
}

/** 错误对象转可读文本（提示条用）。 */
function errMsg(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

/** 组装卡片导出 handler（issue #85）：返回 { onPng, onSvg, onCopy }，
 *  失败一律经 flashNotice 转可见提示，绝不静默。 */
function makeExportHandlers(
  entryId: string,
  source: string,
  flashNotice: (type: string, text: string) => void,
): ExportHandlers {
  return {
    onPng: () => {
      const svgEl = findCardSvg(entryId)
      if (!svgEl) {
        flashNotice('error', '图表尚未渲染完成，无法导出 PNG')
        return
      }
      downloadPngFile(svgEl, buildExportFileName(entryId, 'png'))
        .then(() => flashNotice('ok', 'PNG 已下载'))
        .catch((err) => flashNotice('error', 'PNG 导出失败：' + errMsg(err)))
    },
    onSvg: () => {
      const svgEl = findCardSvg(entryId)
      if (!svgEl) {
        flashNotice('error', '图表尚未渲染完成，无法导出 SVG')
        return
      }
      try {
        downloadSvgFile(svgEl, buildExportFileName(entryId, 'svg'))
        flashNotice('ok', 'SVG 已下载')
      } catch (err) {
        flashNotice('error', 'SVG 导出失败：' + errMsg(err))
      }
    },
    onCopy: () => {
      copyText(source)
        .then(() => flashNotice('ok', '源码已复制'))
        .catch((err) => flashNotice('error', '复制失败：' + errMsg(err)))
    },
  }
}

// ── card part：diagram card (React) ─────────────────────────────────

let noticeTimer: ReturnType<typeof setTimeout> | null = null

/** Mermaid 图表卡片组件。 */
function MermaidCard({ entryId, source }: { entryId: string; source: string }) {
  const [status, setStatus] = useState('loading')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    ensureMermaid()
      .then((m) => m.render(entryId, source))
      .then((out) => {
        if (cancelled) return
        setSvg(out && typeof out.svg === 'string' ? out.svg : null)
        setError(null)
        setStatus('ok')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [entryId, source])

  /** 短暂提示（成功/失败），2.5s 后自动消失。 */
  function flashNotice(type: string, text: string): void {
    setNotice({ type: type as 'ok' | 'error', text })
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => setNotice(null), 2500)
  }

  const exportActions = makeExportHandlers(entryId, source, flashNotice)

  return createElement(
    'div',
    { className: 'dsh-mermaid-render-card', 'data-dsh-mermaid-render-entry': entryId },
    createElement(
      'div',
      { className: 'dsh-mermaid-render-card-head' },
      createElement(
        'div',
        { className: 'dsh-mermaid-render-card-title' },
        icon.file(12),
        createElement('span', null, 'Mermaid 图表'),
      ),
      createElement(
        'div',
        { className: 'dsh-mermaid-render-card-actions' },
        createElement(ExportButtons, {
          status,
          onPng: exportActions.onPng,
          onSvg: exportActions.onSvg,
          onCopy: exportActions.onCopy,
        }),
        createElement(ViewToggle, { mode, setMode }),
      ),
    ),
    notice ? renderNotice(notice) : null,
    createElement(CardBody, { status, mode, error, source, svg }),
  )
}

/** 导出结果提示条（成功/失败），无提示时返回 null。 */
function renderNotice(notice: Notice | null) {
  if (!notice) return null
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-notice dsh-mermaid-render-notice-' + notice.type },
    notice.text,
  )
}

/** 导出按钮组：下载 PNG / 下载 SVG / 复制代码（issue #85）。 */
function ExportButtons({
  status,
  onPng,
  onSvg,
  onCopy,
}: {
  status: string
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}) {
  const ready = status === 'ok'
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-export', role: 'group', 'aria-label': 'export' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-mermaid-render-eb',
        onClick: onPng,
        disabled: !ready,
        title: '下载 PNG',
        'aria-label': '下载 PNG',
      },
      icon.download(14),
      createElement('span', null, '下载 PNG'),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-mermaid-render-eb',
        onClick: onSvg,
        disabled: !ready,
        title: '下载 SVG',
        'aria-label': '下载 SVG',
      },
      icon.download(14),
      createElement('span', null, '下载 SVG'),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-mermaid-render-eb',
        onClick: onCopy,
        title: '复制代码',
        'aria-label': '复制代码',
      },
      icon.copy(14),
      createElement('span', null, '复制代码'),
    ),
  )
}

/** Preview / code view-mode toggle (card header, icon + label). */
function ViewToggle({ mode, setMode }: { mode: 'preview' | 'code'; setMode: (mode: 'preview' | 'code') => void }) {
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-view-toggle', role: 'group', 'aria-label': 'view mode' },
    createElement(
      'button',
      {
        type: 'button',
        className: mode === 'preview' ? 'dsh-mermaid-render-vt dsh-mermaid-render-vt-active' : 'dsh-mermaid-render-vt',
        onClick: () => setMode('preview'),
        'aria-pressed': mode === 'preview',
      },
      icon.file(14),
      createElement('span', null, '预览'),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: mode === 'code' ? 'dsh-mermaid-render-vt dsh-mermaid-render-vt-active' : 'dsh-mermaid-render-vt',
        onClick: () => setMode('code'),
        'aria-pressed': mode === 'code',
      },
      icon.code(14),
      createElement('span', null, '代码'),
    ),
  )
}

/** Card body: loading / error banner / code / rendered svg. */
function CardBody({
  status,
  mode,
  error,
  source,
  svg,
}: {
  status: string
  mode: string
  error: string | null
  source: string
  svg: string | null
}) {
  if (status === 'loading') {
    return createElement(
      'div',
      { className: 'dsh-mermaid-render-loading' },
      icon.refresh(14),
      createElement('span', null, '渲染中…'),
    )
  }
  if (status === 'error') {
    return createElement(
      'div',
      { className: 'dsh-mermaid-render-error' },
      createElement(
        'div',
        { className: 'dsh-mermaid-render-error-head' },
        icon.alert(15),
        createElement('span', { className: 'dsh-mermaid-render-error-title' }, 'Mermaid 渲染失败'),
      ),
      createElement('div', { className: 'dsh-mermaid-render-error-msg' }, error),
    )
  }
  if (mode === 'code' || !svg) {
    return createElement('pre', { className: 'dsh-mermaid-render-code' }, source)
  }
  return createElement('div', {
    className: 'dsh-mermaid-render-svg',
    dangerouslySetInnerHTML: { __html: svg },
  })
}

// ── scanner part：attach cards to mermaid blocks ─────────────────────

let seq = 0

/** Mount a card into the block, hiding the original <pre>. */
function mountCard(seen: Set<Element>, block: Element): void {
  const source = sourceOf(block)
  if (!source.trim()) return
  seen.add(block)
  const pre = block.querySelector('pre')
  if (pre && pre.style) pre.style.display = 'none'
  const host = document.createElement('div')
  host.className = 'dsh-mermaid-render-card-host'
  block.appendChild(host)
  const root = reactDomClient.createRoot(host)
  const entryId = 'dsh-mermaid-' + ++seq
  root.render(createElement(MermaidCard, { entryId, source }))
}

/** Streaming-aware: skip blocks under [data-streaming] ancestors. */
function attemptMount(seen: Set<Element>, block: Element): void {
  if (seen.has(block)) return
  if (block.closest && block.closest('[data-streaming]')) return
  mountCard(seen, block)
}

/** Scan a subtree for mermaid md-code-blocks under conversation scrolls. */
function scanBlocks(seen: Set<Element>, root: Element): void {
  const scrolls: Element[] = []
  if (root instanceof Element && root.matches && root.matches('[data-conversation-scroll]')) scrolls.push(root)
  if (root.querySelectorAll) {
    for (const sc of root.querySelectorAll('[data-conversation-scroll]')) scrolls.push(sc)
  }
  for (const sc of scrolls) {
    for (const block of sc.querySelectorAll('div.md-code-block')) {
      if (seen.has(block)) continue
      if (!isMermaidBlock(block)) continue
      attemptMount(seen, block)
    }
  }
}

/** Observe the body; returns the observer disposer. */
function installScanner(): () => void {
  const seen = new Set<Element>()
  scanBlocks(seen, document.body)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === 1) scanBlocks(seen, added as Element)
      }
    }
    // Fallback re-scan: rescan every known scroll container
    for (const sc of document.querySelectorAll('[data-conversation-scroll]')) {
      scanBlocks(seen, sc)
    }
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-streaming'],
  })
  return () => observer.disconnect()
}

// ── styles part：DSH tokens ──────────────────────────────────────────

const STYLES = `
.dsh-mermaid-render-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-s-14);line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-mermaid-render-card-in 150ms var(--ds-ease-in-out)}
.dsh-mermaid-render-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-mermaid-render-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dsh-mermaid-render-export{display:inline-flex;gap:2px;flex:none}
.dsh-mermaid-render-eb{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-eb svg{display:block;flex:none}
.dsh-mermaid-render-eb:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-mermaid-render-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-mermaid-render-notice{border-radius:6px;padding:4px 10px;font:var(--dsw-font-xxs-12);line-height:20px}
.dsh-mermaid-render-notice-ok{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-mermaid-render-notice-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-mermaid-render-card-title{display:flex;align-items:center;gap:5px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}
.dsh-mermaid-render-card-title svg{display:block;flex:none}
.dsh-mermaid-render-view-toggle{display:inline-flex;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:2px;flex:none}
.dsh-mermaid-render-vt{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-vt svg{display:block;flex:none}
.dsh-mermaid-render-vt:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-mermaid-render-vt-active{background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent);color:var(--dsw-alias-accent);font-weight:600}
.dsh-mermaid-render-svg{overflow:auto;max-height:70vh}
.dsh-mermaid-render-svg svg{max-width:100%;height:auto}
.dsh-mermaid-render-code{margin:0;background:var(--dsw-alias-markdown-code-block);border-radius:6px;padding:8px 12px;overflow:auto;font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}
.dsh-mermaid-render-loading{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-mermaid-render-loading svg{flex:none;animation:dsh-mermaid-render-spin 1s linear infinite}
.dsh-mermaid-render-error{border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);padding:8px 10px}
.dsh-mermaid-render-error-head{display:flex;align-items:center;gap:6px}
.dsh-mermaid-render-error-head svg{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-mermaid-render-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dsh-mermaid-render-error-msg{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;margin-top:4px;line-height:1.5}
@keyframes dsh-mermaid-render-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-mermaid-render-spin{to{transform:rotate(360deg)}}
`

// ── apply part：导出 inject 和 apply ──────────────────────────────────

exports.inject = []

exports.apply = function apply(ctx: ClientContext): void {
  // Stylesheet first, unconditionally (see dsh-file-activity pitfall:
  // injecting styles behind a service early-return loses them on HMR).
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-mermaid-render', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-mermaid-render: styles')

  ctx.effect(() => installScanner(), 'dsh-mermaid-render: scanner')
}
