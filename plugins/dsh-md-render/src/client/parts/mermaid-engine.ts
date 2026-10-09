// ── mermaid 引擎：按需加载 + 离屏渲染 ─────────────────────────────────
// 引擎由 DSH webServer 从插件 assets 目录静态托管（**不内联**进 bundle：issue #185
// 的 4.48 MB base64 冗余教训），首次渲染时 fetch 并按需注入 <script>，不阻塞启动。
// 构建期 scripts/build.mjs 校验 assets/mermaid-10.9.3.min.js 的 SHA256 与 UMD 形态。
// 降级路径：fetch 失败 → 回退检查 window.mermaid 是否已由外部加载；仍失败 → 卡片
// 显示错误原因 + **原始源码**（绝不静默丢内容）。

// MERMAID_ENGINE_URL 由构建期从 host 半 src/routes/paths.ts 注入（单一真源）。
/** 超长块跳过（与 mermaid 自身 maxTextSize 5e4 对齐，不做无谓渲染）。 */
const MAX_SOURCE_CHARS = 50000

/** mermaid 引擎类型（window.mermaid）。 */
interface MermaidEngine {
  initialize(config: { startOnLoad: boolean; securityLevel: string; suppressErrorRendering?: boolean }): void
  /** 第三个参数是渲染容器：传了它，失败时引擎的错误图形只落在这个容器里。 */
  render(id: string, source: string, container?: Element): Promise<{ svg: string }>
}

/**
 * 引擎初始化配置。`suppressErrorRendering` 是 mermaid v11+ 的开关：本插件 vendored 的
 * 是 **10.9.3**，实测该版本不认识这个键（传进去被静默接收但不生效，渲染失败时仍会往
 * 容器里插错误图形）。这里依然显式传：升级引擎后自动多一层保险；真正的兜底是离屏渲染。
 */
const MERMAID_INIT = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true }

let mermaidReady: Promise<MermaidEngine> | null = null

/** 清掉加载缓存（卡片「重试」必须能真的重新加载一次）。 */
function resetMermaidEngine(): void {
  mermaidReady = null
}

/** 初始化引擎；重复 initialize 抛错时忽略（配置已经在）。 */
function initEngine(engine: MermaidEngine): MermaidEngine {
  try {
    engine.initialize(MERMAID_INIT)
  } catch (_e) {
    /* already initialized */
  }
  return engine
}

/** 注入引擎脚本并解析 window.mermaid（注入失败 / 注入后仍缺失 → reject）。 */
function injectEngine(code: string): Promise<MermaidEngine> {
  return new Promise<MermaidEngine>((resolve, reject) => {
    const script = document.createElement('script')
    script.textContent = code
    script.onerror = () => reject(new Error('mermaid engine script injection failed'))
    document.head.appendChild(script)
    const m = typeof window !== 'undefined' ? (window as unknown as { mermaid?: MermaidEngine }).mermaid : undefined
    if (!m) {
      reject(new Error('mermaid engine missing after injection'))
      return
    }
    resolve(initEngine(m))
  })
}

/** 加载（或复用）mermaid 引擎：首次从 assets fetch。 */
function ensureMermaid(): Promise<MermaidEngine> {
  const globalEngine =
    typeof window !== 'undefined' ? (window as unknown as { mermaid?: MermaidEngine }).mermaid : undefined
  if (globalEngine) return Promise.resolve(initEngine(globalEngine))
  if (mermaidReady !== null) return mermaidReady
  mermaidReady = loadEngine().catch((err: unknown) => {
    resetMermaidEngine()
    throw err instanceof Error ? err : new Error(String(err))
  })
  return mermaidReady
}

/** fetch 引擎 UMD 并注入（无 document / fetch 失败 / 注入失败都 reject）。 */
function loadEngine(): Promise<MermaidEngine> {
  if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
    return Promise.reject(new Error('no document to inject mermaid'))
  }
  return fetch(MERMAID_ENGINE_URL)
    .then((resp) => {
      if (!resp.ok) throw new Error(`mermaid engine fetch failed: ${resp.status}`)
      return resp.text()
    })
    .then((code) => injectEngine(code))
}

/** 离屏渲染容器标记（回归测试据此断言渲染发生在脱离文档流的节点里）。 */
const OFFSCREEN_ATTR = 'data-dsh-mermaid-render-offscreen'

/** 创建离屏渲染容器：脱离文档流并移出视口，但仍在布局树内
 *  （display:none / visibility:hidden 会让 mermaid 量不到节点尺寸）。 */
function createOffscreenHost(entryId: string): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute(OFFSCREEN_ATTR, entryId)
  host.setAttribute('aria-hidden', 'true')
  host.className = 'dsh-md-render-offscreen'
  return host
}

/** 丢弃离屏容器及其内部一切（失败时 mermaid 的错误图形就在里面）。 */
function dropOffscreen(host: HTMLElement): void {
  if (host.parentNode) host.parentNode.removeChild(host)
}

/**
 * 渲染 mermaid 源码为 SVG 字符串。
 *
 * 为什么必须离屏：mermaid 10.9.3 解析/渲染失败时**自己**往渲染容器里插一张「炸弹图」
 * （#d<id> + .error-icon / .error-text，文案 "Syntax error in text"），而
 * `suppressErrorRendering` 在该版本无效。把渲染导向一个脱离文档流的容器后，失败图形
 * 只落在容器里、随容器一起被移除 —— 页面永远看不到它；成功则只取返回的 svg 字符串。
 */
function renderSvg(engine: MermaidEngine, entryId: string, source: string): Promise<string> {
  const body = typeof document !== 'undefined' && document !== null ? document.body : null
  if (body === null || body === undefined) return Promise.reject(new Error('no document body to render into'))
  const host = createOffscreenHost(entryId)
  body.appendChild(host)
  return engine.render(entryId, source, host).then(
    (out) => {
      const svg = out && typeof out.svg === 'string' ? out.svg : ''
      dropOffscreen(host)
      if (!svg) throw new Error('mermaid 未返回 SVG')
      return svg
    },
    (err: unknown) => {
      dropOffscreen(host)
      throw err instanceof Error ? err : new Error(String(err))
    },
  )
}

/** 错误对象转可读文本（卡片提示条用）。 */
function errMsg(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

exports.MERMAID_ENGINE_URL = MERMAID_ENGINE_URL
exports.MAX_SOURCE_CHARS = MAX_SOURCE_CHARS
exports.OFFSCREEN_ATTR = OFFSCREEN_ATTR
exports.ensureMermaid = ensureMermaid
exports.resetMermaidEngine = resetMermaidEngine
exports.renderSvg = renderSvg
exports.errMsg = errMsg
