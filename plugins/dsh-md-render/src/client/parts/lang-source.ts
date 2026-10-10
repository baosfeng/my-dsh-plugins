// ── 围栏语言索引（client 半，双源互补的**主源**）：会话事件流 ────────────
// 宿主 0.2.0-rc.2 实测（调研报告 tmp/md-render-lang-source/report.md §7）：
//   · banner 文本走 `supportsHighlighting(lang) ? lang : labels.codeLabel`
//     —— 只有 shiki 语法表认识的标记才进 DOM，其余一律显示本地化标签「代码块」；
//   · 非空代码块的 <code> 也不带 language-*（只有 node.value === '' 的
//     空围栏分支才带）；
//   ⇒ text / plaintext / txt / mermaid / mmd 与「无语言」块在 DOM 里**完全同形**，
//     任何 DOM 启发式都取不到语言（实测接管数 toggles=0 / views=0）。
//
// **为什么必须有这一半**（host 半实时索引的结构性缺口）：host 半只订阅
// `session/event`、**不读历史** —— 用户打开的是历史会话、而插件实例是之后才启动
// （冷启动 / 重启后打开历史会话）时，host 索引为空，按哈希查表永不命中。
// 而 `ctx.sessions.binding(id).eventSource` 的窗口里就是这个会话**已加载的全部**
// 原始事件（含历史），所以本表是「历史会话 + 冷启动」唯一能命中的来源。
//
// 语言的真源在**会话事件流**：官方 ctx.sessions.binding(id).eventSource 的窗口里就是
// 未经裁剪的原始 Session 事件，assistant/message.data.message.content[].text 与
// user/message.data.content[].text 是模型可见消息的 markdown 原文。
// host 半的实时索引（src/lang-index.ts，`session/event` 订阅）作为**兜底**保留：
//   本表命中 → 零 RPC；本表未命中 / 取不到 → 才可能走那一次批量查询（routes/langs.ts）。
//
// 映射（内容哈希 + 文档序 FIFO，报告 §3.2-A）：
//   1. 事件侧：扫每段 markdown 的围栏块，建 hash(规范化代码) → langs[]（文档序，
//      含 '' = 确证无语言）；只取 surfaceOp === 'append' 的 durable 事件；
//   2. DOM 侧：对 div.md-code-block 取 <pre>.textContent 算同一哈希查表；
//   3. 候选互不相同 → 按 DOM 文档序 FIFO，且要求 DOM 内同哈希块数与候选数一致；
//      数量不符 / 取不到位 → 返回 undefined（调用方静默退回现状），**绝不猜**。
//
// 降级（真降级）：ctx.get('sessions') 取不到 / 任何异常 → 空表 → 调用方退回
// resolveBlockLang（DOM 契约 + host 索引），行为与修复前一致。
// 无语言 / 非目标语言的块在任何路径下都不会被接管。
//
// 依赖注入（R1 三方案实测结论，见报告；本轮已用 rc.2 asar 抽出的真实 cordis 4.0.4 复测）：
//   · 采用：`ctx.get('sessions', false)` + `exports.inject` 保持 `[]` —— 服务在则取到，
//     服务缺则返回 undefined（不抛）；服务晚于 apply 提供（真实首屏顺序）也照样取到。
//     cordis 4 的 ReflectService.get 契约原文即 "read a service ... without the inject
//     requirement"，零新增硬依赖；
//   · `inject: { optional: [...] }` —— cordis 4.0.4 **不支持可选注入**（对象形式是
//     「服务名 → intercept 配置」），实测 apply 根本不执行：不采用；
//   · `inject: ['sessions']` —— 服务缺失时 apply 完全不执行 → **整个 client 半失效**
//     （连样式与设置页一起没）：不采用（本轮实测确认）。
//
// 硬约束：不读 React fiber 私有属性；不写官方元素的 style / class / aria；
// 不注册任何节点级 seat；调用时机由调用方钉死在 [data-streaming] 门控之后
// （块稳定时才查表）。

/** 已解析事件的上限（性能护栏：seen 集合规模）。 */
const MAX_FENCE_EVENTS = 20000
/** 单段 markdown 的扫描上限（字符）；超出不参与建表。 */
const MAX_FENCE_MARKDOWN_CHARS = 400000
/** 单块代码内容上限（字符）；超出不参与建表（下游同样会拒绝超长块）。 */
const MAX_FENCE_CODE_CHARS = 200000
/** 歧义消解时一次枚举的代码块上限（性能护栏）。 */
const MAX_ORDER_SCAN_BLOCKS = 4000

/** 围栏语言索引（模块级；按会话 + 事件源 revision 增量维护）。 */
interface FenceIndex {
  sessionId: string
  revision: number
  /** hash → 文档序语言候选（'' = 确证无语言；候选按事件流文档序）。 */
  byHash: Map<string, string[]>
  /** 已解析过的事件 seq（流式期间每批只解析新事件，避免整窗重扫）。 */
  seen: Set<number>
}

function emptyFenceIndex(): FenceIndex {
  return { sessionId: '', revision: -1, byHash: new Map(), seen: new Set() }
}

let fenceIndex: FenceIndex = emptyFenceIndex()

/** 重置为空表（会话切换 / 取不到事件源 / 任何异常）。已是空表则原样返回
 *  （本函数每批扫描都会被调用，避免每次重新分配 Map / Set）。 */
function resetFenceIndex(): void {
  if (fenceIndex.revision === -1) return
  fenceIndex = emptyFenceIndex()
}

/** 规范化：CRLF → LF、去行尾空白、去尾部空行（**两端必须用同一函数**）。 */
function fenceNormalize(code: string): string {
  return String(code ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '')
}

/** 内容哈希（长度前缀 + djb2，复用 context-markdown.ts 的 contextHash；空内容 → 空串）。 */
function fenceHash(code: string): string {
  if (typeof code !== 'string' || code === '') return ''
  return code.length.toString(36) + ':' + contextHash(code)
}

/** info string → 语言标记（首个空白分隔的 token，小写；无则空串）。 */
function fenceInfoLang(info: string): string {
  const token = String(info ?? '')
    .trim()
    .split(/\s+/)[0]
  return token === undefined ? '' : token.toLowerCase()
}

/**
 * 保守围栏解析（报告 §8-R2）：行首 0–3 空格 + 三反引号/三波浪号（≥3）+ info string 开栏，
 * 同字符且长度不短于开栏的纯围栏行闭栏；未闭合的尾巴一律忽略（成对才算）。
 * 与官方 remark 的边角行为可能不同 —— 因此结果只用于**白名单语言匹配**，
 * 误判不会造成破坏，只会少接管。
 */
function collectFences(text: string, sink: (lang: string, code: string) => void): void {
  const lines = String(text ?? '').split(/\r?\n/)
  let open: { ch: string; len: number; lang: string; line: number } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (m === null) continue
    if (open === null) {
      open = { ch: m[1].charAt(0), len: m[1].length, lang: fenceInfoLang(m[2]), line: i }
      continue
    }
    if (m[1].charAt(0) !== open.ch || m[1].length < open.len || m[2].trim() !== '') continue
    sink(open.lang, lines.slice(open.line + 1, i).join('\n'))
    open = null
  }
}

/** 收下一段围栏块（空内容 / 超长不计入 —— 下游同样会拒绝它们）。 */
function collectInto(byHash: Map<string, string[]>, lang: string, code: string): void {
  const hash = fenceHash(fenceNormalize(code))
  if (hash === '') return
  const list = byHash.get(hash)
  if (list === undefined) byHash.set(hash, [lang])
  else list.push(lang)
}

/** 内容块数组 → 文本段（只认 string 的 text 字段；其它块类型原样跳过）。 */
function pushTexts(out: string[], content: unknown): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const text = (block as { text?: unknown }).text
    if (typeof text !== 'string') continue
    if (text.length > MAX_FENCE_MARKDOWN_CHARS) continue
    out.push(text)
  }
}

/** 事件里的 markdown 原文段（assistant 的 text / reasoning + user 的 text）。 */
function eventMarkdowns(event: Record<string, unknown>): string[] {
  const out: string[] = []
  const data = (event.data ?? {}) as Record<string, unknown>
  if (event.type === 'assistant/message') {
    const message = (data.message ?? {}) as Record<string, unknown>
    pushTexts(out, message.content)
  } else if (event.type === 'user/message') {
    pushTexts(out, data.content)
  }
  return out
}

/** 事件流条目 → 原始 Session 事件（非 durable 事件条目返回 null）。 */
function eventOf(entry: unknown): Record<string, unknown> | null {
  if (entry === null || typeof entry !== 'object') return null
  const record = entry as { type?: unknown; event?: unknown }
  if (record.type !== 'event') return null
  return record.event !== null && typeof record.event === 'object' ? (record.event as Record<string, unknown>) : null
}

/**
 * 增量吸收事件窗口：只解析**没见过 seq** 的事件（流式期间窗口每批都会被重发，
 * 全量重扫 markdown 会把 CPU 拖垮）；非 durable / 非消息事件同样记账后跳过。
 */
function absorbFences(index: FenceIndex, entries: readonly unknown[]): void {
  for (const entry of entries) {
    if (index.seen.size >= MAX_FENCE_EVENTS) return
    const event = eventOf(entry)
    if (event === null) continue
    const seq = Number(event.seq)
    if (Number.isFinite(seq)) {
      if (index.seen.has(seq)) continue
      index.seen.add(seq)
    }
    if (event.surfaceOp !== 'append') continue
    for (const markdown of eventMarkdowns(event)) {
      collectFences(markdown, (lang, code) => collectInto(index.byHash, lang, code))
    }
  }
}

/** 安全取属性（null / undefined / 标量 → undefined）——宿主契约缺失时只降级不抛。 */
function propOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

/** 会话列表行是否被主视图持有（与官方 dsh-client-ui-session 同一判据：retainedBy.mainView > 0）。 */
function isMainViewRow(row: unknown): boolean {
  const retained = propOf(row, 'retainedBy')
  if (retained === undefined) return false
  return Number(propOf(retained, 'mainView')) > 0
}

/** 当前主视图会话 id；列表结构不符 / 没有主视图会话 → ''（调用方退回空表）。 */
function mainSessionId(sessions: Record<string, unknown>): string {
  const list = sessions.list
  if (list === undefined || typeof propOf(list, 'getSnapshot') !== 'function') return ''
  const state = (list as { getSnapshot: () => unknown }).getSnapshot()
  const byId = propOf(state, 'byId')
  if (byId === undefined || byId === null || typeof byId !== 'object') return ''
  for (const row of Object.values(byId as Record<string, unknown>)) {
    if (isMainViewRow(row)) return String(propOf(row, 'id') ?? '')
  }
  return ''
}

/**
 * ctx.get('sessions', false) —— cordis 4 的 ReflectService.get 契约即
 * "Read a service from the store without the inject requirement"，因此**不需要**
 * 声明 inject（硬 inject 在服务缺失时会让 apply 根本不执行，整插件失效）。
 * strict = false：首屏时服务提供者 fiber 可能尚未 active（同 dsh-my-remote 的教训）。
 */
function sessionsService(ctx: unknown): Record<string, unknown> | null {
  if (ctx === null || ctx === undefined || typeof ctx !== 'object') return null
  const get = (ctx as { get?: unknown }).get
  if (typeof get !== 'function') return null
  try {
    const service = (get as (name: string, strict?: boolean) => unknown).call(ctx, 'sessions', false)
    return service !== null && typeof service === 'object' ? (service as Record<string, unknown>) : null
  } catch (_e) {
    return null
  }
}

/** 当前主视图会话的事件源（SessionEventSource）；任一步取不到返回 null。 */
function currentEventSource(ctx: unknown): { sessionId: string; source: Record<string, unknown> } | null {
  const sessions = sessionsService(ctx)
  if (sessions === null) return null
  try {
    const id = mainSessionId(sessions)
    if (id === '') return null
    const binding = (sessions.binding as ((sid: string) => unknown) | undefined)?.call(sessions, id)
    const source =
      binding === null || binding === undefined ? undefined : (binding as { eventSource?: unknown }).eventSource
    if (source === null || source === undefined || typeof source !== 'object') return null
    return { sessionId: id, source: source as Record<string, unknown> }
  } catch (_e) {
    return null
  }
}

/** 事件窗口快照 { sessionId, revision, entries }；取不到返回 null。 */
function fenceEventWindow(ctx: unknown): { sessionId: string; revision: number; entries: readonly unknown[] } | null {
  const current = currentEventSource(ctx)
  if (current === null) return null
  try {
    const getSnapshot = current.source.getSnapshot as (() => unknown) | undefined
    if (typeof getSnapshot !== 'function') return null
    const snapshot = getSnapshot.call(current.source) as { entries?: unknown; revision?: unknown } | null
    if (snapshot === null || snapshot === undefined || !Array.isArray(snapshot.entries)) return null
    return {
      sessionId: current.sessionId,
      revision: Number(snapshot.revision) || 0,
      entries: snapshot.entries as readonly unknown[],
    }
  } catch (_e) {
    return null
  }
}

/**
 * 按需刷新语言表（每批扫描开头调用一次）：事件源 revision 未变则内部直接返回。
 * 任何异常 / 服务缺失 → 空表（调用方自然降级到原有 DOM 读法）。
 */
function refreshFenceLangIndex(ctx: unknown): void {
  try {
    const window = fenceEventWindow(ctx)
    if (window === null) {
      resetFenceIndex()
      return
    }
    if (window.sessionId === fenceIndex.sessionId && window.revision === fenceIndex.revision) return
    if (window.sessionId !== fenceIndex.sessionId) resetFenceIndex()
    fenceIndex.sessionId = window.sessionId
    fenceIndex.revision = window.revision
    absorbFences(fenceIndex, window.entries)
  } catch (_e) {
    resetFenceIndex()
  }
}

/** 块源码（官方 <pre>.textContent 的规范化形式）；空 / 超长 / 结构不符 → null。 */
function fenceBlockCode(block: Element): string | null {
  if (block === null || block === undefined || typeof block.querySelector !== 'function') return null
  const pre = block.querySelector('pre')
  const text = pre === null || pre === undefined ? '' : (pre.textContent ?? '')
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FENCE_CODE_CHARS) return null
  return fenceNormalize(text)
}

/** 块所属的会话滚动容器（歧义消解只在同一容器内比较文档序）。 */
function fenceScopeOf(block: Element): Element | null {
  const closest = block.closest
  if (typeof closest !== 'function') return null
  const scope = closest.call(block, '[data-conversation-scroll]')
  if (scope === null || scope === undefined) return null
  return typeof scope.querySelectorAll === 'function' ? scope : null
}

/** 块在会话滚动容器内、与其内容同哈希的块中的文档序与总数；取不到返回 null。 */
function sameHashPosition(block: Element, hash: string): { index: number; count: number } | null {
  const scope = fenceScopeOf(block)
  if (scope === null) return null
  const blocks = Array.from(scope.querySelectorAll('div.md-code-block'))
  if (blocks.length > MAX_ORDER_SCAN_BLOCKS) return null
  let index = -1
  let count = 0
  for (const candidate of blocks) {
    const code = fenceBlockCode(candidate)
    if (code === null || fenceHash(code) !== hash) continue
    if (candidate === block) index = count
    count += 1
  }
  return index < 0 ? null : { index, count }
}

/** 歧义哈希：按 DOM 文档序取第 N 个候选；DOM 内同哈希块数与候选数不符 → 整块放弃。 */
function fenceLangAtDocumentOrder(block: Element, hash: string, langs: string[]): string | undefined {
  const position = sameHashPosition(block, hash)
  if (position === null || position.count !== langs.length || position.index >= langs.length) return undefined
  return langs[position.index]
}

/**
 * 块的围栏语言（新来源：会话事件流哈希表）。取不到 / 有歧义 → undefined
 * （调用方回退到原有的 DOM 契约读法）。**绝不猜语言**。
 */
function fenceLangOf(block: Element): string | undefined {
  try {
    const entry = fenceIndex.byHash.size === 0 ? null : fenceBlockCode(block)
    if (entry === null) return undefined
    const hash = fenceHash(entry)
    const langs = hash === '' ? undefined : fenceIndex.byHash.get(hash)
    if (langs === undefined) return undefined
    const first = langs[0]
    if (langs.every((lang) => lang === first)) return first
    return fenceLangAtDocumentOrder(block, hash, langs)
  } catch (_e) {
    return undefined
  }
}

exports.MAX_FENCE_EVENTS = MAX_FENCE_EVENTS
exports.MAX_FENCE_CODE_CHARS = MAX_FENCE_CODE_CHARS
exports.fenceNormalize = fenceNormalize
exports.fenceHash = fenceHash
exports.fenceInfoLang = fenceInfoLang
exports.collectFences = collectFences
exports.refreshFenceLangIndex = refreshFenceLangIndex
exports.resetFenceIndex = resetFenceIndex
exports.fenceIndexSize = () => fenceIndex.byHash.size
exports.fenceLangOf = fenceLangOf
