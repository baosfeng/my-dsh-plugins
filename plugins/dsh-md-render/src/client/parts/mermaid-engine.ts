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
  initialize(config: { startOnLoad: boolean; securityLevel: string; suppressErrorRendering?: boolean }): void
  /** 第三个参数是渲染容器：SVG / 错误输出都落在这个容器里，便于整体丢弃。 */
  render(id: string, source: string, container?: Element): Promise<{ svg: string }>
}

/** 引擎初始化配置（12.2.0 认 suppressErrorRendering：失败不渲染炸弹图，直接 reject）。 */
const MERMAID_INIT = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true }

/** 在飞的加载 Promise（失败即清空：卡片「重试」必须能真的重新加载一次）。 */
let mermaidReady: Promise<MermaidEngine> | null = null

/** 页面里已有的引擎（别的插件先加载过 / 复跑）→ 直接复用，零请求。 */
function mermaidGlobal(): MermaidEngine | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { mermaid?: MermaidEngine }).mermaid
}

/** initialize 重复调用会抛错（配置已经在）——忽略即可。 */
function initEngine(engine: MermaidEngine): MermaidEngine {
  try {
    engine.initialize(MERMAID_INIT)
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
  return engine.render(entryId, source, host).then(
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
exports.renderSvg = renderSvg
exports.errMsg = errMsg
