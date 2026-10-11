// ── 围栏语言索引（client 半）：DOM 认不出语言时按块内容哈希问 host ────────
// 背景（issue #466 真实宿主实测）：官方 CodeBlock 的 banner 只在 shiki **认识**该语言时
// 才写语言原名（chat 侧传了 toolbarLabels → 语言名 = `i8(lang) ? lang : labels.codeLabel`），
// 且**非空**代码块不写 `language-*`（只有空围栏分支写）—— 实测 text / mermaid / 无语言
// 三种块 DOM 逐字段完全相同，纯 DOM 无法区分，本插件原来的 DOM 语言识别 100% 静默失效。
//
// **双源互补**：语言判定唯一入口 = {@link resolveFenceLangEx} —— ① client 事件流索引
// （lang-source.ts，含历史、零 RPC）；② 本文件的 {@link resolveBlockLangEx}（DOM 语言
// token → host 半实时索引：订阅 session/event 建表、不读历史）。查表只比对哈希、不看内容，
// 且 host 索引只登记本插件接管的语言 → 无关语言不会误判；缓存 / 未命中重试都有界，同一次
// 扫描的多个块合成**一次**请求；查表永远在块**稳定后**（[data-streaming] 门控 + 稳定窗口）。

/** djb2 字符串哈希（与 host 半 src/lang-index.ts 的 fenceHash 同算法；parity 由测试钉住）。 */
function fenceContentHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 内容规范化：去尾部空白（含换行）——与 host 半 normalizeFenceContent 同口径。 */
function normalizeFenceContent(text: unknown): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '')
}

/** hash → lang 缓存 / 未命中重试计数表的容量上限（长会话防无界增长）。 */
const LANG_CACHE_MAX = 500
/** 单次请求的哈希上限（与 host 半 routes/langs.ts 的 LANGS_MAX_HASHES 一致；超出留到下批）。 */
const LANG_BATCH_MAX = 64
/** 单块参与查表的内容长度上限（超长块不查表，保持官方默认）。 */
const LANG_MAX_PROBE_CHARS = 100000
/** 未命中重试：每哈希最多 2 次、间隔 1.5s（覆盖「client 先扫、host 索引后建」的时序差）。 */
const LANG_MAX_RETRIES = 2
const LANG_RETRY_MS = 1500
/** 语言 token 形态（ASCII 标识符）：banner 显示语言**原名**时为真；本地化标签「代码块」为假。 */
const LANG_TOKEN_RE = /^[a-z0-9][a-z0-9_+#.-]*$/

/** hash → 语言（`''` = 查过且未命中；有界，见 LANG_CACHE_MAX）。 */
const langCache = new Map<string, string>()
/** 待批量查询的哈希（同一次扫描的多个块合成一次请求）。 */
const langQueue = new Set<string>()
/** 未命中哈希 → 已重试次数（有界）。 */
const langMisses = new Map<string, number>()
/** 命中后触发的重扫钩子（由 scanner.ts 注册；null = 未装配）。 */
let langRescan: (() => void) | null = null
let langFlushScheduled = false
let langRetryTimer: ReturnType<typeof setTimeout> | null = null

/** 有界写入：超出上限丢最旧（Map 迭代序 = 插入序）。 */
function boundedPut<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > LANG_CACHE_MAX) {
    const oldest = map.keys().next()
    if (oldest.done === true) return
    map.delete(oldest.value)
  }
}

/** 块源码容器 `<code>` 的文本（去尾部空白）；取不到 → ''。 */
/** 语言判定结果：`confirmed` 区分「确证无语言」（可兜底）与「识别失败」。 */
interface FenceLangResult {
  lang: string
  confirmed: boolean
}

// ── ④ 语言手动切换（需求 4）：块级覆盖层（**优先级最高**）──────────────────
// 「用户显式意图 != 猜语言」：只在用户点过「渲染为…」之后生效；自动判定仍是「绝不猜」。

const FENCE_FORCE_ATTR = 'data-dsh-md-render-lang-force'
const FENCE_FORCE_VALUES: readonly string[] = ['mermaid', 'markdown', 'source']
/** 「渲染为…」选项表（卡片头与块内控件共用一份）。 */
const FENCE_FORCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'mermaid', label: '图表' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'source', label: '源码' },
]
/** 覆盖表：块内容哈希 -> 覆盖值（有界；跨宿主重渲染存活）。 */
const fenceForces = new Map<string, string>()

/** 覆盖键 = 块源码的 djb2 哈希（与 host 语言索引同一键空间）。 */
function fenceForceKey(block: Element): string {
  const text = blockLangCodeText(block)
  return text === '' ? '' : fenceContentHash(text)
}

/** 读有效的人工覆盖值（块属性优先，其次按内容哈希查表）。 */
function fenceForceOf(block: Element): string | undefined {
  const direct = typeof block.getAttribute === 'function' ? block.getAttribute(FENCE_FORCE_ATTR) : null
  if (direct !== null && FENCE_FORCE_VALUES.includes(direct)) return direct
  const key = fenceForceKey(block)
  return key === '' ? undefined : fenceForces.get(key)
}

/** 写入 / 清除人工覆盖（空值 = 清除）：块属性 + 有界表 + 持久化。 */
function setFenceForce(block: Element, value?: string): void {
  const key = fenceForceKey(block)
  if (value !== undefined && FENCE_FORCE_VALUES.includes(value)) {
    block.setAttribute(FENCE_FORCE_ATTR, value)
    if (key !== '') boundedPut(fenceForces, key, value)
    persistFenceForces()
    return
  }
  if (typeof block.removeAttribute === 'function') block.removeAttribute(FENCE_FORCE_ATTR)
  if (key !== '') fenceForces.delete(key)
  persistFenceForces()
}

/** 覆盖的会话级持久化（验收项「刷新后仍记得」）：有界 + 异常静默。 */
const FENCE_FORCE_STORE_KEY = 'dsh-md-render:lang-force'
const FENCE_FORCE_PERSIST_MAX = 100

function persistFenceForces(): void {
  try {
    const store = (window as unknown as { sessionStorage?: { setItem: (k: string, v: string) => void } }).sessionStorage
    if (!store) return
    store.setItem(FENCE_FORCE_STORE_KEY, JSON.stringify([...fenceForces.entries()].slice(-FENCE_FORCE_PERSIST_MAX)))
  } catch (_e) {
    // 隐私模式 / 配额满：不落盘也不报错
  }
}

/** 从会话存储恢复覆盖表（启动时一次；不可用 -> 退回自动判定）。 */
function restoreFenceForces(): void {
  try {
    const store = (window as unknown as { sessionStorage?: { getItem: (k: string) => string | null } }).sessionStorage
    const raw = store ? store.getItem(FENCE_FORCE_STORE_KEY) : null
    if (raw === null) return
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!Array.isArray(item)) continue
      const value = String(item[1])
      if (typeof item[0] === 'string' && item[0] !== '' && FENCE_FORCE_VALUES.includes(value)) {
        boundedPut(fenceForces, item[0], value)
      }
    }
  } catch (_e) {
    // 不恢复即可，不影响任何既有能力
  }
}

function blockLangCodeText(block: Element): string {
  const code = block.querySelector ? block.querySelector('code') : null
  return code === null ? '' : normalizeFenceContent(code.textContent)
}

/**
 * DOM 已给出的语言名：`code.language-xxx`（官方空围栏 / 旧契约）→ banner 首个子元素文本。
 * banner 里可能是语言原名（js / json / bash…），也可能是本地化标签「代码块」——
 * 两者**都原样返回**，由 {@link resolveBlockLang} 用 token 形态区分。不读 React fiber。
 */
function blockLangDomLang(block: Element): string {
  const code = block.querySelector ? block.querySelector('code') : null
  const className = code !== null && typeof code.className === 'string' ? code.className : ''
  const m = className.match(/language-([A-Za-z0-9_+-]+)/)
  if (m !== null) return m[1].toLowerCase()
  const banner = block.querySelector ? block.querySelector('[data-code-block-banner]') : null
  const info = banner !== null && banner.firstElementChild ? banner.firstElementChild.textContent : ''
  return String(info ?? '')
    .trim()
    .toLowerCase()
}

/** host 索引探测：`known` 区分「查过且命中」与「还没答案 / 未命中」。 */
function indexedBlockLangProbe(block: Element): { lang: string; known: boolean } {
  const text = blockLangCodeText(block)
  if (text === '' || text.length > LANG_MAX_PROBE_CHARS) return { lang: '', known: false }
  const hash = fenceContentHash(text)
  const cached = langCache.get(hash)
  if (cached !== undefined) return { lang: cached, known: cached !== '' }
  langQueue.add(hash)
  scheduleLangFlush()
  return { lang: '', known: false }
}

/**
 * 解析块语言（DOM 契约 + host 索引）并给出**可信度**：
 *  `confirmed === true` = 已确证，**包括 lang 为 '' 的「确证没有语言标记」**；false = 识别失败。
 *  host 索引「未命中」不算确证：它只登记本插件接管的语言，js / java 等同样查不到。

 */
function resolveBlockLangEx(block: Element): FenceLangResult {
  const dom = blockLangDomLang(block)
  if (dom !== '' && LANG_TOKEN_RE.test(dom)) return { lang: dom, confirmed: true }
  const probe = indexedBlockLangProbe(block)
  return { lang: probe.lang, confirmed: probe.known }
}

/** 语言（字符串形态；带可信度的版本见 {@link resolveFenceLangEx}）。 */
function resolveBlockLang(block: Element): string {
  return resolveBlockLangEx(block).lang
}

/**
 * 语言判定唯一入口（**手动覆盖 > client 事件流索引 > DOM/host 索引**）：
 *  ⓪ 手动覆盖（需求 4）：用户点过「渲染为…」→ 直接采用且 confirmed = true；
 *  ① client 事件流索引 {@link fenceLangOf}——含历史的原始 markdown，命中即零 RPC，
 *     confirmed = true；**`''` = 确证无语言**同样算确证（需求 3 的兜底只认这种情形）；
 *  ② 取不到 → {@link resolveBlockLangEx}（DOM token / host 索引命中才算确证）。
 * 调用方按 `confirmed` 区分「确证无语言」与「识别失败」：后者原样保留官方代码块。
 */
function resolveFenceLangEx(block: Element): FenceLangResult {
  const forced = fenceForceOf(block)
  if (forced !== undefined) return { lang: forced, confirmed: true }
  const local = fenceLangOf(block)
  if (local !== undefined) return { lang: local, confirmed: true }
  return resolveBlockLangEx(block)
}

/** 语言判定唯一入口的字符串形态（带可信度的版本见 {@link resolveFenceLangEx}）。 */
function resolveFenceLang(block: Element): string {
  return resolveFenceLangEx(block).lang
}

/** 本插件渲染容器内的块不再二次接管（防递归重建；类名来自 block-render.ts）。 */
function isInsideRenderedMarkdown(block: Element): boolean {
  if (!block.closest) return false
  return block.closest('div.' + BLOCK_MD_CLASS) !== null || block.closest('div.' + CODE_HOST_CLASS) !== null
}

/** 取一批待查哈希（不超过单请求上限，其余留到下批）。 */
function takeLangBatch(): string[] {
  const batch: string[] = []
  for (const hash of langQueue) {
    if (batch.length >= LANG_BATCH_MAX) break
    batch.push(hash)
  }
  for (const hash of batch) langQueue.delete(hash)
  return batch
}

/** 微任务批处理：一次扫描里的多个块合成一次请求（避免每块一发）。 */
function scheduleLangFlush(): void {
  if (langFlushScheduled) return
  langFlushScheduled = true
  Promise.resolve()
    .then(flushLangQueue)
    .catch(() => {
      // 查表失败**静默降级**：保持官方默认渲染，不影响任何既有能力。
    })
}

/** 批量请求语言索引（相对 URL 失败 / 非 200 / 结构不符 → 空答案）。 */
async function fetchLangs(hashes: readonly string[]): Promise<Record<string, string>> {
  if (typeof fetch !== 'function') return {}
  const query = hashes.map((h) => LANGS_HASH_PARAM + '=' + encodeURIComponent(h)).join('&')
  const response = await fetch(LANGS_API_URL + '?' + query)
  if (response === null || response === undefined || response.ok === false) return {}
  const body = (await response.json()) as { ok?: unknown; value?: unknown } | null
  if (body === null || body.ok !== true || body.value === null || typeof body.value !== 'object') return {}
  return body.value as Record<string, string>
}

/** 记录一次未命中（首次进入重试表；表满丢最旧）。 */
function noteLangMiss(hash: string): void {
  if (!langMisses.has(hash)) boundedPut(langMisses, hash, 0)
}

/** 把一批答案写进缓存：命中触发重扫，未命中排重试，剩余哈希排下一批。 */
function applyLangAnswers(batch: readonly string[], answer: Record<string, string>): void {
  let hit = false
  let missed = false
  for (const hash of batch) {
    const lang = answer[hash]
    if (typeof lang === 'string' && lang !== '') {
      boundedPut(langCache, hash, lang)
      langMisses.delete(hash)
      hit = true
      continue
    }
    boundedPut(langCache, hash, '')
    noteLangMiss(hash)
    missed = true
  }
  if (hit && langRescan !== null) langRescan()
  if (missed) scheduleLangRetry()
  if (langQueue.size > 0) scheduleLangFlush()
}

/** 冲刷待查队列（测试可直接 await；生产由微任务触发）。 */
async function flushLangQueue(): Promise<void> {
  langFlushScheduled = false
  const batch = takeLangBatch()
  if (batch.length === 0) return
  try {
    applyLangAnswers(batch, await fetchLangs(batch))
  } catch (_e) {
    // 单批失败不冒泡（静默降级）；未命中的哈希留待重试窗口再试。
  }
}

/** 未命中里还有可重试的哈希 → 排一次重试定时器（同时最多一个）。 */
function scheduleLangRetry(): void {
  if (langRetryTimer !== null || typeof setTimeout !== 'function') return
  let retryable = false
  for (const count of langMisses.values()) {
    if (count < LANG_MAX_RETRIES) retryable = true
  }
  if (!retryable) return
  langRetryTimer = setTimeout(() => {
    langRetryTimer = null
    retryLangMisses()
  }, LANG_RETRY_MS)
}

/** 有界重试：把未命中的哈希从缓存里删掉再重扫（重扫会重新排队 → 重新查表）。 */
function retryLangMisses(): void {
  for (const [hash, count] of [...langMisses.entries()]) {
    if (count >= LANG_MAX_RETRIES) continue
    boundedPut(langMisses, hash, count + 1)
    langCache.delete(hash)
  }
  if (langRescan !== null) langRescan()
}

/** 注册「语言命中 / 重试」后的重扫钩子（scanner.ts 装配；返回撤销函数）。 */
function installLangRescan(rescan: () => void): () => void {
  langRescan = rescan
  return () => {
    if (langRescan === rescan) langRescan = null
  }
}

/** teardown：清定时器、待查队列、未命中表与缓存（fiber 卸载 / HMR 无残留）。 */
function teardownLangProbes(): void {
  if (langRetryTimer !== null) clearTimeout(langRetryTimer)
  langRetryTimer = null
  langFlushScheduled = false
  langQueue.clear()
  langMisses.clear()
  langCache.clear()
  fenceForces.clear()
  langRescan = null
}

exports.LANGS_API_URL = LANGS_API_URL
exports.LANGS_HASH_PARAM = LANGS_HASH_PARAM
exports.LANG_BATCH_MAX = LANG_BATCH_MAX
exports.LANG_MAX_RETRIES = LANG_MAX_RETRIES
exports.fenceContentHash = fenceContentHash
exports.normalizeFenceContent = normalizeFenceContent
exports.blockLangDomLang = blockLangDomLang
exports.resolveBlockLang = resolveBlockLang
exports.resolveFenceLang = resolveFenceLang
exports.resolveFenceLangEx = resolveFenceLangEx
exports.resolveBlockLangEx = resolveBlockLangEx
exports.FENCE_FORCE_ATTR = FENCE_FORCE_ATTR
exports.FENCE_FORCE_OPTIONS = FENCE_FORCE_OPTIONS
exports.fenceForceOf = fenceForceOf
exports.setFenceForce = setFenceForce
exports.restoreFenceForces = restoreFenceForces
exports.isInsideRenderedMarkdown = isInsideRenderedMarkdown
exports.flushLangQueue = flushLangQueue
exports.retryLangMisses = retryLangMisses
exports.installLangRescan = installLangRescan
exports.teardownLangProbes = teardownLangProbes
