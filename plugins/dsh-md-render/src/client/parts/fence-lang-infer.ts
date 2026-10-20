// ── 无语言围栏的语言推断：内容识别优先，项目主语言兜底 ────────────────────
// 无语言块按代码卡渲染但语言位留空、无高亮 → 本模块推断一个语言：
//   ① 内容识别（高置信特征、纯函数、零 IO）：JSON / shell / SQL / Kotlin / Python / TS /
//     JS / Java / C++ / HTML / CSS；② 项目主语言（会话 cwd 的构建标记文件，见
//     src/routes/project-lang.ts）；③ 日志块与认不出的 → 留空。
// 边界：只用于高亮 + 胶囊，带 data-mdr-lang-inferred 标识（不冒充原文标注）、**不参与分流**；
// 请求失败 / 无会话服务 / 无 fetch 静默降级；cwd 与结果按会话有界缓存（TTL 10 分钟）。
// 脚本模式片段（无 import/export）。

/** 内容识别规则（**顺序即优先级**：越特异的特征越靠前）。 */
const INFER_CONTENT_RULES: readonly { lang: string; test: (text: string) => boolean }[] = [
  { lang: 'json', test: (text) => looksLikeJson(text) },
  {
    lang: 'bash',
    test: (text) =>
      /^#!.*\b(?:ba|z|k)?sh\b/.test(text) ||
      /(?:^|\n)[ \t]*(?:export[ \t]+\w+=|[A-Z][A-Z0-9_]+=\S)/.test(text) ||
      /(?:^|\n|[\s&|;])(?:~\/|\.\/|\/)[\w./-]*\b(?:adb|gradlew|apkanalyzer|emulator|xcodebuild)\b/.test(text) ||
      /(?:^|\n|[\s&|;])(?:adb|npm|npx|pnpm|yarn|git|brew|curl|wget|cd|ls|mkdir|rm|cp|mv|docker|kubectl|gradlew|pip3?|python3?|node|cargo|deno|bun)[ \t]+[-\w./]/.test(
        text,
      ),
  },
  {
    lang: 'sql',
    test: (text) =>
      /^[ \t]*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b/im.test(
        text,
      ) ||
      // SQL 片段（没有 SELECT 开头）：LIKE / WHERE … = / IN / IS / JOIN 这类强特征。
      // 注意 `=` 后没有词边界（`= 1` 两侧都是非单词字符），单独用 `=(?!=)`。
      /\b(?:LIKE[ \t]+'|WHERE[ \t]+\w+[ \t]*(?:[<>!=]=|=(?!=)|\bIN\b|\bIS\b|\bLIKE\b)|\b(?:INNER|LEFT|RIGHT)[ \t]+JOIN[ \t]+\w+\b|GROUP[ \t]+BY\b|ORDER[ \t]+BY[ \t]+\w+)/i.test(
        text,
      ),
  },
  {
    lang: 'kotlin',
    test: (text) =>
      /(?:^|\n)[ \t]*(?:private\s+|internal\s+|public\s+)?(?:const\s+)?(?:val|var|fun)\s+\w+/.test(text) ||
      /(?:^|\n)[ \t]*object\s+\w+\s*\{/.test(text) ||
      /@[A-Z][A-Za-z0-9_]*\b/.test(text),
  },
  {
    lang: 'python',
    test: (text) =>
      /(?:^|\n)[ \t]*(?:def\s+\w+\s*\(|class\s+\w+[^:]*:|import\s+\w+|from\s+\w+\s+import\b)/.test(text) ||
      /\bself\.\w+/.test(text),
  },
  {
    lang: 'typescript',
    test: (text) =>
      /\b(?:interface|type)\s+\w+\s*[={]|\bimport\s+type\b|:\s*(?:string|number|boolean|unknown|void)\b/.test(text),
  },
  {
    lang: 'javascript',
    test: (text) => /\b(?:const|let)\s+\w+\s*=|\bfunction\s+\w+\s*\(|=>\s*\{|\bconsole\.\w+|\brequire\(/.test(text),
  },
  {
    lang: 'java',
    test: (text) => /\bpublic\s+(?:static\s+)?(?:void|class|interface)\b|\bSystem\.out\.print/.test(text),
  },
  { lang: 'cpp', test: (text) => /^[ \t]*#include[ \t]*[<"]|\bstd::/.test(text) },
  {
    lang: 'html',
    test: (text) =>
      /^[ \t]*<!(?:DOCTYPE|doctype)\b|^[ \t]*<(?:html|head|body|div|span|section|script|style)\b/.test(text),
  },
  {
    lang: 'css',
    test: (text) => /(?:^|\n)[ \t]*[.#]?[\w-]+[ \t]*\{[^}]*:[^;{}]+;/.test(text),
  },
]

/** 项目主语言缓存 TTL（与 host 半 CACHE_TTL_MS 同口径）。 */
const INFER_PROJECT_TTL_MS = 10 * 60 * 1000

/** 项目主语言缓存：{ cwd, lang, at }（每会话一份，有界）。 */
let inferredProjectLang: { cwd: string; lang: string; at: number } | null = null
/** 请求进行中（避免同一轮扫描重复发请求）。 */
let inferredProjectPending = false
/** 已经失败过的 cwd（不反复重试；换 cwd 会重置）。 */
let inferredProjectFailed = ''

/** 严格 JSON（首字符 `{` / `[` 且 JSON.parse 成功）。 */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false
  const first = trimmed.charAt(0)
  if (first !== '{' && first !== '[') return false
  try {
    JSON.parse(trimmed)
    return true
  } catch (_e) {
    return false
  }
}

/** 明显是运行时日志（时间戳行占多数）：日志没有语言可高亮，**不参与项目主语言兜底**。 */
function looksLikeLog(text: string): boolean {
  const lines = String(text ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
  if (lines.length === 0) return false
  const stamped = lines.filter(
    (line) =>
      /^[ \t]*\d{2}:\d{2}:\d{2}[.,]\d{1,3}\b/.test(line) ||
      /^[ \t]*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(line) ||
      /^[ \t]*\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.,]\d{3}\b/.test(line),
  ).length
  return stamped >= Math.max(1, Math.ceil(lines.length / 2))
}

/** 内容识别：命中返回语言名，否则 ''（纯函数、零 IO）。 */
function inferLangByContent(code: string): string {
  const text = String(code ?? '')
  if (text.trim() === '') return ''
  for (const rule of INFER_CONTENT_RULES) {
    if (rule.test(text)) return rule.lang
  }
  return ''
}

/** 会话 cwd（`sessions.binding(id).session.getSnapshot().cwd`；取不到 → ''）。 */
function sessionCwdOf(ctx: unknown): string {
  const sessions = sessionsService(ctx)
  if (sessions === null) return ''
  try {
    const id = mainSessionId(sessions)
    if (id === '') return ''
    const binding = typeof sessions.binding === 'function' ? (sessions.binding as (sid: string) => unknown)(id) : null
    const session = propOf(binding, 'session') as { getSnapshot?: () => unknown } | undefined
    if (session === null || session === undefined || typeof session.getSnapshot !== 'function') return ''
    const snapshot = session.getSnapshot() as Record<string, unknown> | null
    const cwd = propOf(snapshot, 'cwd')
    return typeof cwd === 'string' ? cwd : ''
  } catch (_e) {
    return ''
  }
}

/** 当前缓存的项目主语言（过期 / cwd 不一致 → ''）。 */
function cachedProjectLang(cwd: string): string {
  if (inferredProjectLang === null) return ''
  if (inferredProjectLang.cwd !== cwd) return ''
  if (Date.now() - inferredProjectLang.at > INFER_PROJECT_TTL_MS) return ''
  return inferredProjectLang.lang
}

/** 请求 host 半探测项目主语言（失败 / 非 200 / 结构不符 → ''）。 */
async function fetchProjectLang(cwd: string): Promise<string> {
  if (typeof fetch !== 'function') return ''
  try {
    const url = PROJECT_LANG_API_URL + '?' + PROJECT_LANG_CWD_PARAM + '=' + encodeURIComponent(cwd)
    const response = await fetch(url)
    if (response === null || response === undefined || response.ok === false) return ''
    const body = (await response.json()) as { ok?: unknown; value?: unknown } | null
    if (body === null || body.ok !== true) return ''
    const lang = propOf(body.value, 'lang')
    return typeof lang === 'string' ? lang.toLowerCase() : ''
  } catch (_e) {
    return ''
  }
}

/**
 * 按需刷新「项目主语言」（每个扫描批开头调用一次）：
 * 已有缓存 / 请求进行中 / 已失败过同一 cwd / 取不到 cwd → 直接返回（成本 = 几个属性读）。
 * 请求成功触发一次重扫（把语言胶囊与高亮补上）。
 */
/** 会话切换 / 失败标记复位：cwd 变了就丢掉上一份缓存与失败记录。 */
function syncProjectLangCwd(cwd: string): void {
  if (inferredProjectLang !== null && inferredProjectLang.cwd !== cwd) inferredProjectLang = null
  if (inferredProjectFailed !== '' && inferredProjectFailed !== cwd) inferredProjectFailed = ''
}

/** 发起一次项目主语言请求（并发去重；成功触发重扫，失败记住该 cwd 不再重试）。 */
function requestProjectLangOnce(cwd: string): void {
  inferredProjectPending = true
  void fetchProjectLang(cwd).then((lang) => {
    inferredProjectPending = false
    if (lang === '') {
      inferredProjectFailed = cwd
      return
    }
    inferredProjectLang = { cwd, lang, at: Date.now() }
    if (typeof rescanForLangs === 'function') rescanForLangs()
  })
}

/**
 * 按需刷新「项目主语言」（每个扫描批开头调用一次）：
 * 已有缓存 / 请求进行中 / 已失败过同一 cwd / 取不到 cwd / 开关关闭 → 直接返回（成本 = 几个属性读）。
 */
function refreshInferredLang(ctx: unknown): void {
  try {
    if (renderOptions.markdown.inferLang === false) return
    const cwd = sessionCwdOf(ctx)
    if (cwd === '') return
    syncProjectLangCwd(cwd)
    if (cachedProjectLang(cwd) !== '' || inferredProjectPending || inferredProjectFailed === cwd) return
    requestProjectLangOnce(cwd)
  } catch (_e) {
    inferredProjectPending = false
  }
}

/** 块源码（官方 `pre.textContent`；取不到 → ''）。 */
function inferCodeOfBlock(block: Element): string {
  if (block === null || block === undefined || typeof block.querySelector !== 'function') return ''
  const pre = block.querySelector('pre')
  return pre === null || pre === undefined ? '' : (pre.textContent ?? '')
}

/**
 * 推断块语言（唯一入口）：内容识别 → 项目主语言 → 留空。
 * 返回 `source` 供胶囊标注（'content' / 'project' / ''），**不改变分流**。
 */
function inferredFenceLang(block: Element): { lang: string; source: string } {
  if (renderOptions.markdown.inferLang === false) return { lang: '', source: '' }
  const code = inferCodeOfBlock(block)
  const byContent = inferLangByContent(code)
  if (byContent !== '') return { lang: byContent, source: 'content' }
  // 日志没有语言可高亮：硬贴一个项目主语言只会是错的高亮（真实会话里日志块不少）。
  if (looksLikeLog(code)) return { lang: '', source: '' }
  const cwd = inferredProjectLang === null ? '' : inferredProjectLang.cwd
  const project = cwd === '' ? '' : cachedProjectLang(cwd)
  if (project !== '') return { lang: project, source: 'project' }
  return { lang: '', source: '' }
}

/** teardown：清缓存与进行中标记（fiber 卸载 / HMR 无残留）。 */
function teardownInferredLang(): void {
  inferredProjectLang = null
  inferredProjectPending = false
  inferredProjectFailed = ''
}

exports.INFER_PROJECT_TTL_MS = INFER_PROJECT_TTL_MS
exports.looksLikeJson = looksLikeJson
exports.inferLangByContent = inferLangByContent
exports.looksLikeLog = looksLikeLog
exports.sessionCwdOf = sessionCwdOf
exports.refreshInferredLang = refreshInferredLang
exports.inferredFenceLang = inferredFenceLang
exports.teardownInferredLang = teardownInferredLang
