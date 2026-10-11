// ── 渲染依赖的懒加载（marked 解析层 / highlight.js 高亮层）─────────────────
// 与 mermaid 引擎**同一套模式**：vendored UMD 放 assets/，host 半 /md-render/assets
// 静态托管，client 首次真正需要时才 fetch + 注入 <script>，**不进 lib/client.js**
// （用户口径：打包体积不用控、只控启动速度 —— 两个库合计 ~176 KB 若内联会直接抬高
// 首屏解析成本，懒加载对启动是 0 增量）。
//
// 契约（与 mermaid-engine.ts 同款，判据由测试钉住）：
//   · 全局优先：页面里已有 window.marked / window.hljs（别的插件先加载过 / 复跑）→ 直接复用，零请求；
//   · 同名去重：同一个库只 fetch 一次；失败**不再重试**（渲染退回宿主官方形态，静默不报错）；
//   · 就绪通知：加载完成 → 通知订阅者（scanner 据此重扫，把「加载期间落在官方形态」的块补渲染）；
//   · 任何异常都吞掉（fetch 失败 / 注入失败 / 无 document）→ 调用方拿到 null 走降级。

/** 懒加载条目：URL + 全局变量名 + 在飞 Promise + 失败标记。 */
interface RenderAssetEntry {
  url: string
  global: string
  promise: Promise<Record<string, unknown>> | null
  failed: boolean
}

/** 库名（也是 window 上的全局变量名）：marked = markdown 解析层，hljs = 语法高亮层。 */
const MARKED_ASSET = 'marked'
const HLJS_ASSET = 'hljs'

/** 两个懒加载库（URL 由构建期从 host 半 routes/paths.ts 注入，单一真源）。 */
const renderAssetTable: Record<string, RenderAssetEntry> = {
  [MARKED_ASSET]: { url: MARKED_URL, global: MARKED_ASSET, promise: null, failed: false },
  [HLJS_ASSET]: { url: HIGHLIGHTJS_URL, global: HLJS_ASSET, promise: null, failed: false },
}

/** 已就绪的库数（进幂等签名：库到位后块要重建一次，把纯文本换成高亮 / 渲染态）。 */
let renderAssetVersion = 0
/** 就绪订阅者（scanner 装配；teardown 清空，防跨 fiber 泄漏）。 */
let renderAssetListeners: (() => void)[] = []

/** 取全局对象（非对象 / 未加载 → null）。 */
function renderAssetGlobal(name: string): Record<string, unknown> | null {
  const value = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>)[name] : undefined
  return value !== null && value !== undefined && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** 注入脚本并复查全局（注入后仍缺失 → 抛错，由调用方转成失败态）。 */
function injectRenderAsset(code: string, globalName: string): Record<string, unknown> {
  const script = document.createElement('script')
  script.textContent = code
  document.head.appendChild(script)
  const loaded = renderAssetGlobal(globalName)
  if (loaded === null) throw new Error('render asset missing after injection: ' + globalName)
  return loaded
}

/** fetch + 注入（无 document / fetch / 非 200 一律 reject）。 */
function fetchRenderAsset(entry: RenderAssetEntry): Promise<Record<string, unknown>> {
  if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
    return Promise.reject(new Error('no document to inject render asset'))
  }
  if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch for render asset'))
  return fetch(entry.url)
    .then((resp) => {
      if (resp === null || resp === undefined || resp.ok === false) {
        throw new Error('render asset fetch failed: ' + entry.url)
      }
      return resp.text()
    })
    .then((code) => injectRenderAsset(code, entry.global))
}

/** 广播「某个库已就绪」（订阅者内部自会判断自己关心的那一个）。 */
function noteRenderAssetReady(): void {
  renderAssetVersion += 1
  const listeners = renderAssetListeners
  renderAssetListeners = []
  for (const listener of listeners) {
    try {
      listener()
    } catch (_e) {
      /* 订阅者异常不阻断其它订阅者 */
    }
  }
}

/**
 * 确保某个库可用：已加载 → 同步返回全局；否则启动一次 fetch 并返回 null。
 * 调用方拿到 null 时**保持宿主官方形态**，等就绪通知后的重扫再接管（真降级）。
 */
function ensureRenderAsset(name: string): Record<string, unknown> | null {
  const entry = renderAssetTable[name]
  if (entry === undefined) return null
  const existing = renderAssetGlobal(entry.global)
  if (existing !== null) return existing
  if (entry.failed) return null
  if (entry.promise === null) {
    entry.promise = fetchRenderAsset(entry)
      .then((loaded) => {
        noteRenderAssetReady()
        return loaded
      })
      .catch(() => {
        // 失败即放弃（本会话不再重试）：块停在宿主官方形态，不报错、不刷屏。
        entry.failed = true
        entry.promise = null
        return null
      })
  }
  return null
}

/** 已就绪库数（进幂等签名；库到位后签名变化 → 块重建一次）。 */
function renderAssetsReady(): number {
  return renderAssetVersion
}

/** 订阅「库就绪」（返回撤销函数）。 */
function installRenderAssetReady(listener: () => void): () => void {
  renderAssetListeners.push(listener)
  return () => {
    renderAssetListeners = renderAssetListeners.filter((item) => item !== listener)
  }
}

// teardown 只清订阅者：脚本已在页面里、全局仍在，重扫（re-apply）时秒命中，不重复请求。
function teardownRenderAssets(): void {
  renderAssetListeners = []
}

exports.MARKED_URL = MARKED_URL
exports.HIGHLIGHTJS_URL = HIGHLIGHTJS_URL
exports.MARKED_ASSET = MARKED_ASSET
exports.HLJS_ASSET = HLJS_ASSET
exports.ensureRenderAsset = ensureRenderAsset
exports.renderAssetsReady = renderAssetsReady
exports.installRenderAssetReady = installRenderAssetReady
exports.teardownRenderAssets = teardownRenderAssets
