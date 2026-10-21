// ── mermaid 引擎：懒加载 + 离屏渲染 ─────────────────────────────────────
// 解析层**不进 bundle**（历史 4.49 MB 内联的教训）：引擎 UMD vendored 在 assets/，
// 由宿主 /md-render/assets/* 静态托管；这里只在首次真正需要时按需取脚本。
// 懒加载通道与 render-assets.ts 同款（vendored UMD + 运行时 <script> + 失败不重试）：
// 若 render-assets 的登记表已包含 mermaid 就直接复用它的 Promise 语义；尚未登记时
// 用同一机制自取 —— 两条路径都**不把引擎打成产物的一部分**。
//
// 失败面（都转成卡片可见的失败态，绝不静默丢内容）：
//  · 无 document（伪 DOM / SSR）→ ensureMermaid() 返回 null；
//  · fetch / 注入失败 / 注入后仍缺 window.mermaid → reject，卡片显示源码 + 原因。
//
// 离屏渲染：把渲染导向一个脱离视口、但仍参与布局的容器，SVG / 错误输出都留在容器里，
// 失败随容器一起丢弃（display:none / visibility:hidden 会让 mermaid 量不到节点尺寸，不能用）。
// 12.2.0 起 suppressErrorRendering 生效（解析失败不再往页面插「炸弹图」），离屏容器
// 仍是第二道保险 —— 引擎行为变化不会把错误图形漏到对话里。

/** 超长块跳过（与 mermaid 自身 maxTextSize 5e4 对齐，不做无谓渲染）。 */
const MAX_SOURCE_CHARS = 50000

/** 离屏渲染容器标记（自有 data-*：回归测试据此断言渲染发生在脱离视口流的节点里）。 */
const OFFSCREEN_ATTR = 'data-mdr-mm-offscreen'

/** mermaid 引擎契约（window.mermaid 用到的最小面）。 */
interface MermaidEngine {
  initialize(config: {
    startOnLoad: boolean
    securityLevel: string
    suppressErrorRendering?: boolean
    theme?: string
    themeVariables?: Record<string, string>
  }): void
  /** 第三个参数是渲染容器：SVG / 错误输出都落在这个容器里，便于整体丢弃。 */
  render(id: string, source: string, container?: Element): Promise<{ svg: string }>
}

/** 引擎初始化配置基线（12.2.0 认 suppressErrorRendering：失败不渲染炸弹图，直接 reject）。 */
const MERMAID_INIT = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true }

/** 计算值里的 color-scheme（伪 DOM 没有 computed style / 抛错 → 空串）。 */
function computedSchemeOf(root: Element): string {
  try {
    if (typeof getComputedStyle !== 'function') return ''
    const computed = getComputedStyle(root as HTMLElement)
    return computed === null || computed === undefined ? '' : String(computed.colorScheme || '')
  } catch (_e) {
    return ''
  }
}

/** 内联 style 属性里的 color-scheme（首屏 boot-theme 会写内联值）。 */
function inlineSchemeOf(root: Element): string {
  return typeof root.getAttribute === 'function' ? String(root.getAttribute('style') || '') : ''
}

/** 读 html 的 color-scheme：计算值优先，内联样式兜底。 */
function rootColorScheme(root: Element | null): string {
  if (root === null || root === undefined) return ''
  const computed = computedSchemeOf(root)
  return computed !== '' ? computed : inlineSchemeOf(root)
}

/** color-scheme 取值里是否含 dark。 */
function isDarkScheme(value: string): boolean {
  return value.toLowerCase().indexOf('dark') >= 0
}

/**
 * 宿主深浅信号（调研自参考源 deepseek-harness，web 端主题机制）：
 *  · body[data-ds-dark-theme]：packages/client/ui-layout/src/client/theme-presenter.ts:15 定义、
 *    :75-76 在深色调色板生效时写入（system 解析为 dark 时同样写入）；
 *  · documentElement 的 color-scheme：同文件 :71 每次 apply 都写（boot-theme.ts:20-24 首屏也写）。
 * 两个信号任一命中即深色；都没有（主题服务未就绪 / 伪 DOM）→ 浅色。
 */
function mermaidSchemeOf(): 'dark' | 'light' {
  if (typeof document === 'undefined' || document === null) return 'light'
  const body = document.body
  const darkAttr =
    body !== null &&
    body !== undefined &&
    typeof body.hasAttribute === 'function' &&
    body.hasAttribute('data-ds-dark-theme')
  if (darkAttr) return 'dark'
  return isDarkScheme(rootColorScheme(document.documentElement)) ? 'dark' : 'light'
}

/** 深浅 → mermaid 内置 theme 名（12.2.0 认 'dark' / 'default'）。 */
function mermaidThemeOf(scheme: 'dark' | 'light'): 'dark' | 'default' {
  return scheme === 'dark' ? 'dark' : 'default'
}

/** 图表配色要跟随的宿主语义位（key = mermaid themeVariables 名）。 */
const MERMAID_THEME_VARS: readonly (readonly [string, string])[] = [
  ['primaryColor', '--dsw-alias-markdown-code-block'],
  ['primaryTextColor', '--dsw-alias-label-primary'],
  ['primaryBorderColor', '--dsw-alias-border-l2'],
  ['mainBkg', '--dsw-alias-bg-layer-2'],
  ['nodeBorder', '--dsw-alias-border-l2'],
  ['lineColor', '--dsw-alias-label-tertiary'],
  ['secondaryColor', '--dsw-alias-markdown-code-block'],
  ['tertiaryColor', '--dsw-alias-bg-layer-1'],
  ['textColor', '--dsw-alias-label-secondary'],
  ['titleColor', '--dsw-alias-label-primary'],
  ['edgeLabelBackground', '--dsw-alias-bg-layer-1'],
  ['clusterBkg', '--dsw-alias-markdown-code-block'],
  ['clusterBorder', '--dsw-alias-border-l1'],
  ['attributeBackgroundColorOdd', '--dsw-alias-markdown-code-block'],
  ['attributeBackgroundColorEven', '--dsw-alias-bg-layer-1'],
  ['fontFamily', '--mdr-font-sans'],
]

/** 取用于读 token 的 computed style（伪 DOM / 无 getComputedStyle → null）。 */
function probeStyle(): CSSStyleDeclaration | null {
  if (typeof document === 'undefined' || document === null) return null
  const body = document.body
  const probe = body === null || body === undefined ? document.documentElement : body
  if (probe === null || probe === undefined) return null
  try {
    return typeof getComputedStyle === 'function' ? getComputedStyle(probe) : null
  } catch (_e) {
    return null
  }
}

/** 读宿主语义色（取不到 → 不传，回落 mermaid 内置主题自己的配色）。 */
function mermaidHostVars(): Record<string, string> {
  const computed = probeStyle()
  const out: Record<string, string> = {}
  if (computed === null) return out
  for (const pair of MERMAID_THEME_VARS) {
    const value = String(computed.getPropertyValue(pair[1]) || '').trim()
    if (value !== '') out[pair[0]] = value
  }
  return out
}

/**
 * 每次渲染前置的 init 指令：theme 跟随宿主深浅，themeVariables 把宿主语义色带进图。
 * 源码自己写了 init 指令（作者/模型显式指定主题）→ 原样尊重，不覆盖。
 */
function mermaidThemeDirective(scheme: 'dark' | 'light'): string {
  const vars = mermaidHostVars()
  const config: Record<string, unknown> = { theme: mermaidThemeOf(scheme) }
  if (Object.keys(vars).length > 0) config.themeVariables = vars
  return '%%{init: ' + JSON.stringify(config) + '}%%\n'
}

/** 给源码加主题指令（已有 init 指令则原样返回）。 */
function decorateSource(source: string, scheme: 'dark' | 'light'): string {
  if (source.indexOf('%%{init') >= 0) return source
  return mermaidThemeDirective(scheme) + source
}

/** 在飞的加载 Promise（失败即清空：卡片「重试」必须能真的重新加载一次）。 */
let mermaidReady: Promise<MermaidEngine> | null = null

/** 页面里已有的引擎（别的插件先加载过 / 复跑）→ 直接复用，零请求。 */
function mermaidGlobal(): MermaidEngine | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { mermaid?: MermaidEngine }).mermaid
}

/** initialize 重复调用会抛错（配置已经在）——忽略即可。 */
function initEngine(engine: MermaidEngine): MermaidEngine {
  try {
    engine.initialize({ ...MERMAID_INIT, theme: mermaidThemeOf(mermaidSchemeOf()) })
  } catch (_e) {
    /* already initialized */
  }
  return engine
}

/** 注入引擎脚本并复查全局（注入后仍缺失 → reject）。 */
function injectEngine(code: string): Promise<MermaidEngine> {
  return new Promise<MermaidEngine>((resolve, reject) => {
    const script = document.createElement('script')
    script.textContent = code
    script.onerror = () => reject(new Error('mermaid 引擎脚本注入失败'))
    document.head.appendChild(script)
    const engine = mermaidGlobal()
    if (engine === undefined) {
      reject(new Error('注入后仍未拿到 mermaid 引擎'))
      return
    }
    resolve(initEngine(engine))
  })
}

/**
 * 懒加载引擎：优先走 render-assets 的登记表（集成窗口把 mermaid 登记进去后自动生效），
 * 尚未登记则按同一机制从 assets 路由取一次。
 */
function loadEngine(): Promise<MermaidEngine> {
  const viaAssets = ensureRenderAsset(MERMAID_ASSET) as unknown as MermaidEngine | null
  if (viaAssets !== null) return Promise.resolve(initEngine(viaAssets))
  return fetch(MERMAID_ENGINE_URL)
    .then((resp) => {
      if (resp.ok === false) throw new Error('mermaid 引擎下载失败：HTTP ' + String(resp.status))
      return resp.text()
    })
    .then(injectEngine)
}

/** 本引擎在 render-assets 登记表里的名字（与 vendor 脚本的全局变量同名）。 */
const MERMAID_ASSET = 'mermaid'

/**
 * 确保引擎可用（首次调用触发一次懒加载）。
 * @returns 无 document（伪 DOM / SSR）→ null；否则返回加载 Promise。
 */
function ensureMermaid(): Promise<MermaidEngine> | null {
  if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return null
  const existing = mermaidGlobal()
  if (existing !== undefined) return Promise.resolve(initEngine(existing))
  if (mermaidReady !== null) return mermaidReady
  mermaidReady = loadEngine().catch((err: unknown) => {
    resetMermaidEngine()
    throw err instanceof Error ? err : new Error(String(err))
  })
  return mermaidReady
}

/** 清掉加载缓存（卡片「重试」先调用它，再重跑渲染）。 */
function resetMermaidEngine(): void {
  mermaidReady = null
}

/** 创建离屏渲染容器：脱离视口但仍参与布局（mermaid 要量节点尺寸）。 */
function createOffscreenHost(entryId: string): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute(OFFSCREEN_ATTR, entryId)
  host.setAttribute('aria-hidden', 'true')
  host.className = 'mdr-mm-offscreen'
  return host
}

/** 丢弃离屏容器及其内部一切（失败时引擎的错误图形就在里面）。 */
function dropOffscreen(host: HTMLElement): void {
  if (host.parentNode !== null) host.parentNode.removeChild(host)
}

/**
 * 渲染 mermaid 源码为 SVG 字符串。
 * 成功只取返回的 svg 字符串；失败时错误图形随离屏容器一起被丢弃，页面永远看不到它。
 */
function renderSvg(engine: MermaidEngine, entryId: string, source: string): Promise<string> {
  const body = typeof document === 'undefined' || document === null ? null : document.body
  if (body === null || body === undefined) return Promise.reject(new Error('没有可用的 document.body'))
  const host = createOffscreenHost(entryId)
  body.appendChild(host)
  return engine.render(entryId, decorateSource(source, mermaidSchemeOf()), host).then(
    (out) => {
      const svg = out !== null && out !== undefined && typeof out.svg === 'string' ? out.svg : ''
      dropOffscreen(host)
      if (svg === '') throw new Error('mermaid 未返回 SVG')
      return svg
    },
    (err: unknown) => {
      dropOffscreen(host)
      throw err instanceof Error ? err : new Error(String(err))
    },
  )
}

/** 错误对象 → 可读文本（卡片失败态 / 提示条共用）。 */
function errMsg(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return String(err)
}

exports.MERMAID_ENGINE_URL = MERMAID_ENGINE_URL
exports.MAX_SOURCE_CHARS = MAX_SOURCE_CHARS
exports.OFFSCREEN_ATTR = OFFSCREEN_ATTR
exports.MERMAID_ASSET = MERMAID_ASSET
exports.ensureMermaid = ensureMermaid
exports.resetMermaidEngine = resetMermaidEngine
exports.rootColorScheme = rootColorScheme
exports.computedSchemeOf = computedSchemeOf
exports.inlineSchemeOf = inlineSchemeOf
exports.isDarkScheme = isDarkScheme
exports.mermaidSchemeOf = mermaidSchemeOf
exports.mermaidThemeOf = mermaidThemeOf
exports.mermaidThemeDirective = mermaidThemeDirective
exports.decorateSource = decorateSource
exports.renderSvg = renderSvg
exports.errMsg = errMsg
