/**
 * npm-audit.mjs — npm audit 门禁的纯函数件（issue #199）。
 *
 * 存在的理由：npm audit 依赖 registry 的 security advisories 端点
 * （POST /-/npm/v1/security/advisories/bulk），而 npmmirror 等国内镜像**没有实现该端点**
 * （404 [NOT_IMPLEMENTED] /-/npm/v1/security/*）。于是本地把 registry 指向镜像时，
 * `npm audit` 只会报 "audit endpoint returned an error" —— 门禁形同虚设。
 * 更隐蔽的是：若只看退出码、不校验输出内容，一个「没真正查过」的 audit 与
 * 一个「查过且干净」的 audit 无法区分（本次 issue 之前正是这种状态）。
 *
 * 本模块只做纯字符串/参数计算（不联网、不 spawn），便于单测与复用：
 *   · auditCmdArgs()       —— 固定「官方 registry + 不被重写 + moderate 门槛」的参数
 *   · auditEnv()           —— 注入给子进程的 npm 配置（env 优先级高于用户 .npmrc）
 *   · parseAuditOutput()   —— 判定 audit 是否真正执行；未执行时给出可操作的原因
 *   · summarizeAuditJson() —— 把 --json 结果压缩成一行人类可读摘要
 *   · renderAuditReport()  —— 失败时把 --json 报告渲染成人类可读清单（替代裸 JSON）
 *
 * ⚠️ 关键 npm 行为（npm 11 + node 26 实测，见 docs/踩坑/npm-audit在镜像源下静默失效.md）：
 *   1. `--registry https://registry.npmjs.org` 会被 npm 的 replace-registry-host=npmjs
 *      默认值**反向重写**成当前配置的 registry（即又回到镜像）——必须同时设
 *      `replace_registry_host=never` 才能真正打到官方源；
 *   2. `npm_config_registry` 环境变量优先级高于用户 ~/.npmrc，因此无需用户改本机配置；
 *   3. 子进程继承的 `npm_config_audit=false`（关掉 npm 附带的隐式 audit 请求）
 *      **不影响**显式 `npm audit` 子命令——已实测。
 */

/** 唯一有效的 audit 源：官方 registry。镜像没有 advisories 端点，指定它等于关掉门禁。 */
export const AUDIT_REGISTRY = 'https://registry.npmjs.org'

/**
 * 阻断门槛：moderate 起（= CI 的 --audit-level=moderate）。
 * 原 CI 用 high —— 正是它放行了 issue #199 的两条 moderate 公告（qs）：
 * 「只打印不阻断」等于没门禁。低危（low/info）仍不阻断，避免上游新公告噪声。
 */
export const AUDIT_LEVEL = 'moderate'

/** 生成 audit 子命令参数（不含 npm 本身）。 */
export function auditCmdArgs() {
  return ['audit', '--audit-level=' + AUDIT_LEVEL, '--json']
}

/**
 * 注入给 audit 子进程的 npm 配置。
 * 用 env 而不是 CLI 参数是刻意的：npm 会读本机 ~/.npmrc（常把 registry 设成镜像），
 * env（npm_config_*）优先级更高，故不要求使用者先改自己的 npm 配置。
 */
export function auditEnv() {
  return {
    npm_config_registry: AUDIT_REGISTRY,
    // 不加这个，npm 会把上面的官方源按本机镜像再重写回去（见文件头第 1 条）
    npm_config_replace_registry_host: 'never',
  }
}

/** 「audit 端点不存在」指纹（registry 未实现 security advisories API）。 */
const ENDPOINT_UNSUPPORTED = ['NOT_IMPLEMENTED', '404 Not Found']

/**
 * 网络失败指纹。
 * ⚠️ 必须与「端点未实现」分开：npm 在两种情况下都会打印 "audit endpoint returned an error"，
 * 早先按该字样判定，会把代理 TLS 失败误报成「registry 不支持 audit」，把排查方向带偏（实测踩到）。
 */
const NETWORK_FAILURE = [
  'TLS connection',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'socket disconnected',
  'network request to',
  'request to https',
]

/** 拆成非空行（去空白），供诊断使用。 */
const textLines = (text) =>
  String(text ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/**
 * 单行诊断文本。**JSON 错误体的 message 优先** —— npm 的报错格式是
 * `npm error` 行（很长，含 URL + 原因）后跟一个 `{ message, error }` 对象，
 * `message` 才是给人看的那句。
 */
function firstDiagnostic(text) {
  const message = extractJsonMessage(text)
  if (message) return message
  const endpointLine = textLines(text).find((line) => ENDPOINT_UNSUPPORTED.some((marker) => line.includes(marker)))
  return endpointLine ?? textLines(text)[0] ?? ''
}

/** 抽取 npm 错误 JSON 里的 message 字段（输出里可能夹带多段 JSON）。 */
function extractJsonMessage(text) {
  // 贪婪匹配到最后一个 }：npm 的错误体是嵌套对象，非贪婪会在内层 } 处截断
  const matches = String(text ?? '').match(/\{[\s\S]*\}/g) ?? []
  for (const candidate of matches) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed?.message === 'string') return parsed.message
    } catch {
      // 不是完整 JSON，继续找下一段
    }
  }
  return null
}

/**
 * 判定一次 audit 输出是否算「真正执行过」。
 * @param {{out?: string, ok?: boolean, error?: string|null}} result runCapture 的返回值
 * @returns {{effective: boolean, reason: string, report?: any}}
 *   effective=true  → advisory 数据确实取到了（有无漏洞由 ok/退出码决定）
 *   effective=false → 结构化报告缺失：根本没查过，绝不可当作「通过」
 *   reason 始终是单行可读文本；report 仅当 effective=true 时存在，供调用方渲染明细
 */
export function parseAuditOutput(result = {}) {
  const out = String(result.out ?? '')
  const error = String(result.error ?? '')
  if (!out.includes('auditReportVersion')) {
    return { effective: false, report: undefined, reason: classifyMissingReport(out + '\n' + error) }
  }
  let report
  try {
    report = JSON.parse(extractJsonObject(out))
  } catch {
    return { effective: false, report: undefined, reason: 'npm audit 输出不是可解析的 JSON' }
  }
  if (!report || typeof report.metadata !== 'object' || report.metadata === null) {
    return { effective: false, report: undefined, reason: '结构化报告中缺少 metadata（advisory 数据未取到）' }
  }
  return { effective: true, report, reason: summarizeAuditJson(report) }
}

/** 结构化报告缺失时，把原因归类成人话（区分「端点没实现」与「网络没通」）。 */
function classifyMissingReport(haystack) {
  const diagnostic = firstDiagnostic(haystack)
  const suffix = diagnostic ? ' —— ' + diagnostic : ''
  if (ENDPOINT_UNSUPPORTED.some((marker) => haystack.includes(marker))) {
    return 'audit 端点未实现：当前 registry 不提供 security advisories API（npmmirror 等镜像即如此）' + suffix
  }
  if (NETWORK_FAILURE.some((marker) => haystack.includes(marker))) {
    return 'audit 请求未送达官方 registry（网络/代理问题）：' + (diagnostic || '原因未明')
  }
  return diagnostic || '未收到 npm audit 的结构化报告（registry 配置或网络问题）'
}

/** 从可能夹带 npm warn/error 行的输出里截出第一个 JSON 对象。 */
export function extractJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return text
  return text.slice(start, end + 1)
}

/** 计数对象 → 人类可读摘要（只列非零等级，全零时明确说「无漏洞」）。 */
export function summarizeCounts(counts) {
  if (!counts || typeof counts !== 'object') return '漏洞计数不可用'
  const order = ['critical', 'high', 'moderate', 'low', 'info']
  const parts = order.filter((k) => Number(counts[k]) > 0).map((k) => k + ' ' + counts[k])
  return parts.length === 0 ? '0 漏洞' : parts.join(' / ')
}

/**
 * 把 --json 报告压缩成一行摘要。
 * @param {any} report npm audit --json 的解析结果
 */
export function summarizeAuditJson(report) {
  const counts = report?.metadata?.vulnerabilities
  const deps = report?.metadata?.dependencies
  const depsText = typeof deps?.total === 'number' ? '，审计 ' + deps.total + ' 个依赖' : ''
  return summarizeCounts(counts) + depsText
}

/** 依赖路径最多展示的层级（避免传递链很长时刷屏）。 */
const MAX_PATH_DEPTH = 6

/** 单条漏洞公告：严重级别 + 可直接跳转的链接。 */
const advisoryLine = (item) => '      ' + (item?.severity ?? 'unknown') + '  ' + (item?.url ?? '(无公告链接)')

/**
 * `via` 数组是混合的：既有**公告对象**（含 title/url），也有**传递依赖的包名字符串**。
 * 注意不能用 `!item.name` 来区分——公告对象同样带 name 字段（实测 npm 11 的 --json 输出），
 * 早先按 name 过滤会把真正的公告整条丢掉（本模块单测已锁死该行为）。
 */
const isAdvisory = (item) =>
  typeof item === 'object' && item !== null && (item.url !== undefined || item.title !== undefined)

/** 受影响的版本范围（用户据此判断要不要动、动到哪一版）。 */
const rangeLine = (range) => (range ? '      受影响版本：' + range : null)

/** 截断过长的依赖路径。 */
const pathText = (via) => {
  const parts = via.slice(0, MAX_PATH_DEPTH).map((v) => (typeof v === 'string' ? v : (v?.name ?? v?.title ?? '?')))
  return via.length > MAX_PATH_DEPTH ? parts.join(' > ') + ' > …' : parts.join(' > ')
}

/** `npm audit fix` 建议：true = 可直接修；对象 = 需要动某个包（含是否 semver-major）。 */
const fixText = (fixAvailable) => {
  if (fixAvailable === true) return '可自动修复'
  if (!fixAvailable || typeof fixAvailable !== 'object') return null
  const version = fixAvailable.version ?? '?'
  const major = fixAvailable.isSemVerMajor ? '（semver-major，需评估破坏性）' : ''
  return (fixAvailable.name ?? '?') + '@' + version + major
}

/** 渲染单个受漏洞影响的包（公告明细 → 受影响范围 → 修复建议 → 传入路径）。 */
function renderVulnerability(v) {
  const lines = ['', '[' + (v?.severity ?? 'unknown') + '] ' + (v?.name ?? '(未知包)')]
  for (const item of v?.via ?? []) {
    if (isAdvisory(item)) lines.push(advisoryLine(item))
  }
  const range = rangeLine(v?.range)
  if (range) lines.push(range)
  const fix = fixText(v?.fixAvailable)
  if (fix) lines.push('      修复：' + fix)
  if (v?.isDirect !== true && Array.isArray(v?.nodes) && v.nodes.length > 0)
    lines.push('      经由：' + pathText(v.nodes))
  return lines
}

/**
 * 把 --json 报告渲染成人类可读文本（失败时替代裸 JSON 输出）。
 * @param {any} report npm audit --json 的解析结果
 */
export function renderAuditReport(report) {
  const entries = Object.values(report?.vulnerabilities ?? {}).sort(
    (a, b) => severityRank(b?.severity) - severityRank(a?.severity),
  )
  const lines = ['漏洞摘要：' + summarizeAuditJson(report)]
  for (const v of entries) lines.push(...renderVulnerability(v))
  if (entries.length > 0) lines.push('', '修复：' + auditCommandHint().replace('npm audit', 'npm audit fix'))
  return lines.join('\n')
}

/** 严重级别排序权重（critical 最前）。 */
function severityRank(severity) {
  return ['info', 'low', 'moderate', 'high', 'critical'].indexOf(severity)
}
/** `npm audit` 的推荐复现命令（含官方 registry 双保险），用于失败提示。 */
export function auditCommandHint() {
  return (
    'npm_config_registry=' +
    AUDIT_REGISTRY +
    ' npm_config_replace_registry_host=never npm audit --audit-level=' +
    AUDIT_LEVEL
  )
}
