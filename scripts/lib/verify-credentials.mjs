/**
 * verify-credentials.mjs — 隔离实例的凭据 / provider 段继承与**启动前**完整性自检（issue #403）。
 *
 * 复现的失败（issue #403）：
 *   `verify-real-profile.mjs` 复刻生产 profile 时只 `cpSync` 了
 *   `<DSH_HOME>/profiles/<profile>/`，**没有**处理 `<DSH_HOME>` 顶层的
 *   `.credentials.yaml`（`refs:` 段）与 `settings.yaml`（provider 段）。
 *   隔离 DSH_HOME 里因此没有任何凭据来源，首轮真实模型调用直接：
 *     MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "ollama-flash";
 *     its profile resolves OLLAMA_FLASH_API_KEY, which is not set
 *   于是每次功能级验证都要人工把生产凭据补进隔离实例，既慢又容易误判成插件缺陷。
 *
 * 本模块是该流程的唯一实现（脚本只做接线，逻辑可单测）：
 *
 *   1. parseCredentialRefs —— 生产 `.credentials.yaml` 的 `refs:` 段（环境变量名 → 值）；
 *   2. collectProviderCredentialRefs —— 从 `dump-config` 里提取每个 provider route 的
 *      `apiKeyEnv` 引用名（**按需**继承的依据：只注入真正被引用的凭据）；
 *   3. planCredentialInjection —— 注入计划。宿主 `dsh-credentials-local` 的层次是
 *      「inherited process environment（只读，胜出）> `$DSH_HOME/.credentials.yaml` > .env 兜底」，
 *      因此把生产 refs 作为**子进程环境变量**传给隔离实例即可命中，**不落盘、不打印**；
 *   4. renderCredentialReport / renderCredentialFailure —— 只含字段名与来源的日志文案：
 *      缺字段时**提前明确报错**（点名缺哪个字段、哪个 provider route/entry 在引用、怎么补），
 *      而不是等模型调用抛 MISSING_CREDENTIAL；
 *   5. buildIsolatedSettings —— `settings.yaml` 的 provider 段按需继承：只带
 *      `llm-*` 与 `agent-default-model`（生产偏好如 ui-* 不带），并且**明文密钥一律 fail-closed**
 *      （provider 段按设计只放 apiKeyEnv 引用名）。
 *
 * 安全边界（不可放宽）：本模块的任何返回值与渲染文案都**不含凭据值**；
 * 注入只发生在调用方 spawn 子进程的 `env` 上（不进 argv、不进文件、不进日志）。
 */

/** 生产凭据文件名（`<DSH_HOME>/.credentials.yaml`）。 */
export const CREDENTIALS_FILENAME = '.credentials.yaml'
/** 生产设置文件名（`<DSH_HOME>/settings.yaml`）。 */
export const SETTINGS_FILENAME = 'settings.yaml'
/** 凭据引用名（环境变量名）的合法形态 —— 与宿主 dsh-credentials 的 REF_PATTERN 同源。 */
export const REF_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
/** 真实模型调用探针的开关（脚本接线防漂移断言用）。 */
export const REQUIRED_PROBE_PATTERN = /--probe-llm/

/** 去掉 YAML/dotenv 值两侧的引号（不解析转义：凭据值原样透传）。 */
function stripQuotes(value) {
  const text = String(value ?? '').trim()
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * 解析生产 `.credentials.yaml` 的 `refs:` 段。
 *
 * 只认顶层 `refs:` 下的 2 空格缩进键值对：`records:` 段里的同名缩进键
 * （如 browser-session 的 `secret`）**绝不能**被当成 API key 注入。
 * 键名非法 / 重复即记入 `errors`（fail-closed：不静默丢弃，调用方据此报错）。
 *
 * @param {string} text 凭据文档全文。
 * @returns {{refs: Record<string, string>, errors: string[]}}
 */
export function parseCredentialRefs(text) {
  const refs = {}
  const errors = []
  let inRefs = false
  for (const line of String(text ?? '').split('\n')) {
    if (/^refs:\s*(#.*)?$/.test(line)) {
      inRefs = true
      continue
    }
    if (inRefs && /^\S/.test(line)) {
      inRefs = false
      continue
    }
    if (!inRefs || line.trim() === '' || /^\s*#/.test(line)) continue
    const match = /^\s+([^:\s]+):\s*(.*)$/.exec(line)
    if (match === null) {
      errors.push('refs 段存在缩进异常、无法解析的行（不打印原行，避免泄漏值）')
      continue
    }
    const name = match[1]
    if (!REF_NAME_PATTERN.test(name)) {
      errors.push(`refs 段键名不是合法环境变量名: ${name}`)
      continue
    }
    if (Object.prototype.hasOwnProperty.call(refs, name)) {
      errors.push(`refs 段重复键: ${name}`)
      continue
    }
    refs[name] = stripQuotes(match[2])
  }
  return { refs, errors }
}

/**
 * 解析 dotenv 文件（宿主的 `.env` 兜底层）。
 *
 * @param {string} text dotenv 全文。
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  const values = {}
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match === null) continue
    values[match[1]] = stripQuotes(match[2])
  }
  return values
}

/** 结构键：它们不是 provider route，route 归位时必须跳过。 */
const STRUCTURAL_KEYS = new Set(['config', 'providers', 'models', 'dependencies', 'entries', 'plugins', 'options'])

/**
 * 从 `dsh --dump-config` 输出里提取 provider 段引用的凭据名。
 *
 * 归位规则：`apiKeyEnv: NAME` 的 route 是**缩进比它浅的最近一个键**（跳过结构键），
 * 所属 entry 是最近的顶层 `- id: …`。同名引用跨 route/entry 合并去重。
 *
 * @param {string} dumpOutput dump-config 文本。
 * @returns {Array<{name: string, routes: string[], entries: string[]}>}
 */
export function collectProviderCredentialRefs(dumpOutput) {
  const byName = new Map()
  const stack = []
  let entry = null
  const record = (name, route) => {
    const item = byName.get(name) ?? { name, routes: [], entries: [] }
    if (route !== null && !item.routes.includes(route)) item.routes.push(route)
    if (entry !== null && !item.entries.includes(entry)) item.entries.push(entry)
    byName.set(name, item)
  }
  for (const line of String(dumpOutput ?? '').split('\n')) {
    if (line.trim() === '') continue
    const idMatch = /^- id:\s*'?([A-Za-z0-9._-]+)'?\s*$/.exec(line)
    if (idMatch !== null) {
      entry = idMatch[1]
      stack.length = 0
      continue
    }
    const indent = line.match(/^\s*/)[0].length
    const keyOnly = /^\s+([A-Za-z0-9._-]+):\s*$/.exec(line)
    if (keyOnly !== null) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
      stack.push({ indent, key: keyOnly[1] })
      continue
    }
    const apiKeyEnv = /^(\s+)apiKeyEnv:\s*'?([A-Za-z_][A-Za-z0-9_]*)'?\s*$/.exec(line)
    if (apiKeyEnv !== null) {
      const refIndent = apiKeyEnv[1].length
      let route = null
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].indent < refIndent && !STRUCTURAL_KEYS.has(stack[i].key)) {
          route = stack[i].key
          break
        }
      }
      record(apiKeyEnv[2], route)
      continue
    }
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
  }
  return [...byName.values()]
}

/**
 * 注入计划：为每个被引用的凭据确定来源，产出「要注入子进程环境变量的项」与「缺来源的项」。
 *
 * 来源优先级与宿主一致：启动环境变量（inherited environment，只读且胜出）> 生产 `refs`。
 * 两个来源都没有即 `missing`（调用方 fail-closed 退出，绝不把"缺字段"拖到 MISSING_CREDENTIAL）。
 * 空字符串不算已配置（与宿主 "not set" 语义一致）。
 *
 * @param {{required?: Array<{name: string, routes?: string[], entries?: string[]}>, refs?: Record<string,string>, env?: Record<string,string|undefined>}} input
 * @returns {{ok: boolean, inject: Record<string,string>, resolved: Array<object>, missing: Array<object>}}
 */
export function planCredentialInjection({ required = [], refs = {}, env = {} } = {}) {
  const inject = {}
  const resolved = []
  const missing = []
  for (const item of required ?? []) {
    const routes = item.routes ?? []
    const entries = item.entries ?? []
    const fromEnv = env[item.name]
    if (typeof fromEnv === 'string' && fromEnv !== '') {
      resolved.push({ name: item.name, source: '启动环境变量', routes, entries })
      continue
    }
    const fromRefs = refs[item.name]
    if (typeof fromRefs === 'string' && fromRefs !== '') {
      inject[item.name] = fromRefs
      resolved.push({
        name: item.name,
        source: '生产 .credentials.yaml refs（经子进程环境变量注入，不落盘）',
        routes,
        entries,
      })
      continue
    }
    missing.push({ name: item.name, routes, entries })
  }
  return { ok: missing.length === 0, inject, resolved, missing }
}

/**
 * 自检通过时的日志行（**只含字段名与来源**，绝不含值）。
 *
 * @param {{resolved: Array<object>, inject: Record<string,string>, missing: Array<object>}} plan 注入计划。
 * @returns {string[]}
 */
export function renderCredentialReport(plan) {
  const lines = []
  if (plan.resolved.length > 0) {
    lines.push(
      `凭据自检通过：${plan.resolved.length} 个 provider 凭据可解析（` +
        plan.resolved
          .map(
            (item) =>
              `${item.name} ← ${item.source}${item.routes?.length ? `，provider route "${item.routes.join('/')}"` : ''}`,
          )
          .join('；') +
        '）',
    )
  }
  const injected = Object.keys(plan.inject)
  if (injected.length > 0) {
    lines.push(`已注入隔离实例子进程环境变量 ${injected.length} 项（不落盘、不打印值）：${injected.join('、')}`)
  }
  if (plan.resolved.length === 0 && plan.missing.length === 0) {
    lines.push('凭据自检：该组合配置未引用任何 provider 凭据（apiKeyEnv），无需注入')
  }
  return lines
}

/**
 * 自检失败时的错误文案：点名缺哪个字段、被谁引用、怎么补（**不含值**）。
 *
 * @param {Array<{name: string, routes?: string[], entries?: string[]}>} missing 缺来源的凭据。
 * @returns {string[]}
 */
export function renderCredentialFailure(missing) {
  const lines = ['凭据完整性自检失败（fail-closed：启动前报错，不等调用阶段抛 MISSING_CREDENTIAL）：']
  for (const item of missing) {
    const where = [
      item.entries?.length ? `entry ${item.entries.join('/')}` : null,
      item.routes?.length ? `provider route "${item.routes.join('/')}"` : null,
    ]
      .filter(Boolean)
      .join(' ')
    lines.push(`  - ${item.name}${where === '' ? '' : `（被 ${where} 引用）`}：隔离 DSH_HOME 里无来源`)
  }
  lines.push('补法（任选其一）：')
  lines.push(
    `  1. 启动环境里导出后重跑：${missing.map((item) => `export ${item.name}=…`).join(' ')}` +
      '（宿主的 inherited environment 优先级最高，不落盘）；',
  )
  lines.push(
    '  2. 在生产实例的 Models 页面把该 provider 的 key 存一次（写入 <DSH_HOME>/.credentials.yaml 的 refs 段）后重跑；',
  )
  lines.push('  3. 该 provider 本不用于验证时：从组合配置里删掉对应 apiKeyEnv，或改选不引用凭据的 route。')
  lines.push('说明：这是**验证环境**的凭据问题，不是插件缺陷 —— 不要据此判定插件通过或失败。')
  return lines
}

/**
 * 真实模型调用探针的判定（issue #403：「开箱可用」的**唯一**直接证据）。
 *
 * 三条判据（任一不满足即失败，且归因明确）：
 *   1. 输出里出现 `MISSING_CREDENTIAL` → 直接点名"这是验证环境的凭据问题，不是插件缺陷"
 *      （issue #403 里最容易被误判成"插件调用模型失败"的形态）；
 *   2. 退出码必须是 0；
 *   3. stdout 必须非空（"调用了但什么都没回"不算可用）。
 * 返回的 excerpt 只是截断后的原始输出，不额外拼接环境信息（避免把凭据带进日志）。
 *
 * @param {{code?: number|null, stdout?: string, stderr?: string}} input 探针子进程结果。
 * @param {{maxExcerpt?: number}} [options]
 * @returns {{ok: boolean, reason: string|null, excerpt: string}}
 */
export function decideLlmProbe({ code = null, stdout = '', stderr = '' } = {}, { maxExcerpt = 240 } = {}) {
  const out = String(stdout ?? '').trim()
  const combined = `${out}\n${String(stderr ?? '').trim()}`
  const excerpt = combined.replace(/\s+/g, ' ').trim().slice(0, maxExcerpt)
  if (/MISSING_CREDENTIAL/.test(combined)) {
    return {
      ok: false,
      reason: 'MISSING_CREDENTIAL：隔离实例凭据仍不完整（这是**验证环境**的凭据问题，不是插件缺陷）',
      excerpt,
    }
  }
  if (code !== 0) return { ok: false, reason: `真实调用退出码 ${code}（不是 0）`, excerpt }
  if (out === '') return { ok: false, reason: '真实调用没有输出（stdout 为空）', excerpt }
  return { ok: true, reason: null, excerpt }
}

/**
 * 该 settings 顶层段是否可继承进隔离实例（provider / 模型选择相关）。
 *
 * @param {string} name 段名。
 * @returns {boolean}
 */
export function isInheritableSettingsSection(name) {
  const text = String(name ?? '')
  return text === 'agent-default-model' || text.startsWith('llm-')
}

/** 去掉片段末尾的连续空行（段间分隔由拼接逻辑统一处理）。 */
function trimTrailingBlank(lines) {
  const kept = [...lines]
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  return kept
}

/**
 * 从生产 `settings.yaml` 里取出可继承段（**只保留白名单段原文**，其余一律不带）。
 *
 * 为什么带原文而不是解析成对象：注释与格式属于配置的一部分（provider 段里有
 * 说明协议/取值的注释），重排会产生无意义的 diff 与信息丢失。
 *
 * @param {string} settingsText 生产 settings.yaml 全文。
 * @returns {{text: string, sections: string[]}}
 */
export function extractInheritableSettings(settingsText) {
  const lines = String(settingsText ?? '').split('\n')
  const sections = []
  const kept = []
  let current = null
  const flush = () => {
    if (current === null || !current.inheritable) return
    sections.push(current.name)
    kept.push(...trimTrailingBlank(current.lines))
    kept.push('')
  }
  for (const line of lines) {
    const top = /^([A-Za-z0-9_-]+):/.exec(line)
    if (top !== null) {
      flush()
      current = { name: top[1], inheritable: isInheritableSettingsSection(top[1]), lines: [line] }
      continue
    }
    if (current === null) continue
    current.lines.push(line)
  }
  flush()
  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: text === '' ? '' : `${text}\n`, sections }
}

/**
 * 检出片段里的**疑似明文密钥**（provider 段按设计只放 `apiKeyEnv` 引用名）。
 *
 * 判定：键名含 apiKey/token/secret/password/credential，且值不是引用名/普通标识符形态
 * （如 `sk-…`、`${…}`、长 base64）。返回结构**只记字段名，不记值**——
 * 调用方据此 fail-closed 报错，绝不把密钥抄进隔离实例或日志。
 *
 * @param {string} text 待检查片段。
 * @returns {Array<{field: string}>}
 */
export function findPlaintextSecretHits(text) {
  const hits = []
  for (const line of String(text ?? '').split('\n')) {
    const match = /^\s*([A-Za-z0-9_-]*(?:apiKey|token|secret|password|credential)[A-Za-z0-9_-]*)\s*:\s*(.+)$/i.exec(
      line,
    )
    if (match === null) continue
    const value = stripQuotes(match[2])
    // 只豁免「引用名」（apiKeyEnv: OLLAMA_FLASH_API_KEY）与空值：其余形态（sk-…、base64、
    // ${VAR}）一律视为疑似明文密钥，宁可 fail-closed 也不把生产密钥抄进隔离实例。
    if (REF_NAME_PATTERN.test(value) || value === '') continue
    hits.push({ field: match[1] })
  }
  return hits
}

/**
 * 构造隔离实例的 `settings.yaml` 内容：生产有 provider 段就继承，没有就空操作。
 *
 * fail-closed：继承片段里出现明文密钥 → `ok: false`，调用方必须报错退出
 * （宁可让验证提前失败，也不把生产密钥抄进隔离实例）。
 *
 * @param {{hostSettingsText?: string, existingText?: string}} input
 * @returns {{ok: boolean, blocked: Array<{field: string}>, sections: string[], text: string}}
 */
export function buildIsolatedSettings({ hostSettingsText = '', existingText = '' } = {}) {
  const extracted = extractInheritableSettings(hostSettingsText)
  if (extracted.sections.length === 0) return { ok: true, blocked: [], sections: [], text: existingText }
  const blocked = findPlaintextSecretHits(extracted.text)
  if (blocked.length > 0) return { ok: false, blocked, sections: extracted.sections, text: existingText }
  const text = existingText === '' ? extracted.text : `${existingText.replace(/\n*$/, '\n')}${extracted.text}`
  return { ok: true, blocked: [], sections: extracted.sections, text }
}
