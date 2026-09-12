/**
 * deps-matrix.mjs — 依赖矩阵的纯函数件（issue #184）。
 * 为什么需要它：仓库 1 个根 + 19 个插件的 package.json 里，声明分别受 npm 最新版 /
 * DSH 宿主版本（cordis、react、@deepseek-ai/*）/ 仓库内包 / CI 容器能力（jscpd 的 GLIBC）
 * 四类互不相同的约束支配。过去判断「哪个旧了」只看根目录的 `npm outdated` 加记忆，
 * 于是 dsh-my-memory 带着 typescript@^5 + @types/node@^20 漂移 2 / 6 个大版本无人察觉。
 * 本模块只做纯计算（不联网、不读盘，便于单测），采集侧在 scripts/deps-matrix.mjs：
 *   parseVersion / compareVersions（含 prerelease：rc.8 < rc.10 < 4.0.0）· parseSpec（→ 下限版本）
 *   · classifyGap · DEP_POLICY / resolveTier（A/B/C/D 分档）· buildRows（聚合 + 声明漂移检出）
 *   · summarizeRows · renderReport / renderMarkdown / renderJson
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** 解析版本字符串；非法输入返回 null（调用方据此降级为 unknown，绝不猜）。 */
export function parseVersion(text) {
  const match = VERSION_RE.exec(String(text ?? '').trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    raw: String(text).trim(),
  }
}

/** 比较两个 prerelease 标识符数组（semver §11.4：纯数字 < 字母数字，短的更小）。 */
function comparePrerelease(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNum = /^\d+$/.test(left)
    const rightNum = /^\d+$/.test(right)
    if (leftNum && rightNum) {
      if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1
    } else if (leftNum !== rightNum) {
      return leftNum ? -1 : 1
    } else if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

/** 比较两个版本（字符串或 parseVersion 产物）。无法解析时抛错：静默按 0 处理会把「解析不了」伪装成「已最新」。 */
export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a
  const right = typeof b === 'string' ? parseVersion(b) : b
  if (!left || !right) throw new Error(`无法比较版本：${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  return comparePrerelease(left.prerelease, right.prerelease)
}

/** 拆解一条 npm 版本声明（^ ~ >= || file: 与裸版本）；认不出的按 unknown 归位，不误判成「可直接升」。 */
export function parseSpec(spec) {
  const raw = String(spec ?? '').trim()
  if (!raw) return { registry: false, floor: null, alternatives: 0, kind: 'unknown' }
  if (/^(file|link|workspace|portal|git|https?):/.test(raw)) {
    return { registry: false, floor: null, alternatives: 0, kind: 'local' }
  }
  const alternatives = raw
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean)
  if (alternatives.length === 0) return { registry: false, floor: null, alternatives: 0, kind: 'unknown' }
  // 取首支的下限：对 ^18.2.0 || ^19.2.0 而言「当前支持到哪」由首个分支代表，
  // 双支持声明本身是否收紧属 D 档决策（见 DEP_POLICY 的 react 条目）。
  const first = alternatives[0].replace(/^[\s~^<>=v]+/, '')
  if (first === '' || first === '*' || first === 'x' || first === 'latest') {
    return { registry: true, floor: null, alternatives: alternatives.length, kind: 'wildcard' }
  }
  const version = parseVersion(first)
  if (!version) return { registry: true, floor: null, alternatives: alternatives.length, kind: 'unknown' }
  return { registry: true, floor: version.raw, alternatives: alternatives.length, kind: 'registry' }
}

/** 落后级别。current 取实装版本，退化时取声明下限；stable 专指「预发布已转正」（rc.10 → 4.0.0）。 */
export function classifyGap(current, latest) {
  const from = parseVersion(current)
  const to = parseVersion(latest)
  if (!from || !to) return { level: 'unknown', behind: null }
  const order = compareVersions(from, to)
  if (order === 0) return { level: 'none', behind: 0 }
  if (order > 0) return { level: 'ahead', behind: 0 }
  const sameBase = from.major === to.major && from.minor === to.minor && from.patch === to.patch
  if (sameBase) {
    const promoted = from.prerelease.length > 0 && to.prerelease.length === 0
    return { level: promoted ? 'stable' : 'prerelease', behind: 0 }
  }
  if (from.major !== to.major) return { level: 'major', behind: to.major - from.major }
  if (from.minor !== to.minor) return { level: 'minor', behind: to.minor - from.minor }
  if (from.patch !== to.patch) return { level: 'patch', behind: to.patch - from.patch }
  return { level: 'prerelease', behind: 0 }
}

/** 分档台账：显式登记「不能只看版本号」的依赖；新增例外必须同时给出 reason 与 verify。 */
export const DEP_POLICY = [
  {
    names: ['react', 'react-dom'],
    tier: 'D',
    blocked: false,
    reason:
      'peer 声明 ^18.2.0 || ^19.2.0：收紧为「仅 19」会改变已发布 19 个插件的公开兼容声明，属破坏性变更（react/react-dom 必须同步）',
    verify: '须用户先决策「是否放弃 React 18 用户」；另需注意 dsh-better-sidebar 自身声明 react ^18.2.0',
  },
  {
    name: 'cordis',
    tier: 'B',
    blocked: false,
    source: 'host',
    reason: '由 DSH 宿主提供（host-provided）：插件改声明不会改变运行时实际版本，只能跟随宿主升级',
    verify: '按 skills/plugin-upgrade + dsh-upgrade-audit 的宿主升级流程，不能只看 npm 版本号',
  },
  {
    name: 'dsh-shared',
    tier: 'B',
    blocked: false,
    source: 'internal',
    reason: '仓库内包（根为 file:plugins/dsh-shared，插件为 ^0.1.0）：升级需协同发版',
    verify: '改动后跑 npm run verify 全量 + 依赖插件 npm test',
  },
  {
    name: 'dsh-md-render',
    tier: 'B',
    blocked: false,
    source: 'internal',
    reason: '仓库内包：dsh-my-plugin-manager / dsh-think-zh-expand 以 peer 依赖它，升级需协同发版',
    verify: '同上',
  },
  {
    name: 'dsh-better-sidebar',
    tier: 'B',
    blocked: false,
    reason:
      '根声明 >=0.14.0（实际装 0.18.0）过宽；实测升 0.19.1 会被它新引入的宿主 peer（@deepseek-ai/dsh-*@^0.1.5-rc.1）拦下（npm ERESOLVE），须与 DSH 宿主版本联动升级',
    verify: '宿主联动后再升：npm install 能过 + 侧边栏页签插件 npm test',
  },
  {
    name: '@types/node',
    tier: 'A',
    blocked: false,
    trackBranch: true,
    reason:
      'npm latest 标签刻意停在旧 LTS 分支（实测 latest=22.20.2，而 26.5.1 才是当前分支），须按分支比较而非照抄 latest',
    verify: 'npm run typecheck + npm run typecheck:plugins',
  },
]

const HOST_PREFIXES = ['@deepseek-ai/dsh-']

/** 命中分档台账（精确包名，或条目里的 names 组）。 */
export function findPolicy(name) {
  return DEP_POLICY.find((entry) => (entry.names ?? [entry.name]).includes(name)) ?? null
}

/** 判定档位与出处（自动规则：0.x 非零差距 → B；major/prerelease → B；patch/minor → A）。 */
export function resolveTier({ name, gap, baseline }) {
  const policy = findPolicy(name)
  const source = policy?.source ?? (HOST_PREFIXES.some((p) => name.startsWith(p)) ? 'host' : 'registry')
  if (policy) {
    // 台账里的 A 档是「已判定可升」；升完（无差距）后不该继续显示成待办项
    const settled = policy.tier === 'A' && (gap.level === 'none' || gap.level === 'ahead')
    return {
      tier: settled ? 'OK' : policy.tier,
      blocked: Boolean(policy.blocked),
      source,
      reason: policy.reason,
      verify: policy.verify,
    }
  }
  if (source === 'host') {
    return {
      tier: 'B',
      blocked: false,
      source,
      reason: 'DSH 宿主随包：插件只声明 peer 范围，实际版本由宿主决定',
      verify: '随宿主升级流程（plugin-upgrade / dsh-upgrade-audit）',
    }
  }
  const level = gap.level
  if (level === 'none' || level === 'ahead') {
    return {
      tier: 'OK',
      blocked: false,
      source,
      reason: level === 'ahead' ? '仓库内版本领先 registry' : '已是最新',
      verify: '—',
    }
  }
  if (level === 'unknown') {
    return {
      tier: '?',
      blocked: false,
      source,
      reason: '版本无法解析或 registry 未取到，需人工确认',
      verify: 'npm view <pkg> versions',
    }
  }
  if (level === 'major' || level === 'prerelease' || level === 'stable') {
    return {
      tier: 'B',
      blocked: false,
      source,
      reason: level === 'major' ? '跨大版本，可能含破坏性变更' : '预发布序列，兼容性承诺弱于正式版',
      verify: '读 CHANGELOG 后局部升级 + npm run verify + 受影响插件 npm test',
    }
  }
  if (parseVersion(baseline)?.major === 0) {
    return {
      tier: 'B',
      blocked: false,
      source,
      reason: `0.x 包（${baseline}）未承诺兼容性，${level} 位变更同样可能破坏`,
      verify: '读 CHANGELOG 后局部升级 + 受影响插件 npm test',
    }
  }
  return {
    tier: 'A',
    blocked: false,
    source,
    reason: level === 'patch' ? 'patch 级修复，风险低' : 'minor 级，需扫一眼 CHANGELOG 的 breaking 小节',
    verify: 'npm run verify:fast + npm run test:scripts',
  }
}

/** 把「声明点列表」聚合成「一行一个包」，并检出声明漂移。 */
// declarations: [{ name, kind, scope, spec, installed }]，latestIndex: { [name]: { latest, error } }
export function buildRows(declarations, latestIndex = {}) {
  const byName = new Map()
  for (const decl of declarations) {
    if (!byName.has(decl.name)) {
      // byScope：每个 scope 只保留首次声明（同一 scope 内同一包不会重复声明两次）
      byName.set(decl.name, { name: decl.name, kinds: new Set(), byScope: new Map(), installed: null })
    }
    const row = byName.get(decl.name)
    row.kinds.add(decl.kind)
    if (!row.byScope.has(decl.scope))
      row.byScope.set(decl.scope, { spec: decl.spec, installed: decl.installed ?? null })
    // 根目录装的版本代表「本仓库实际会用到的版本」；插件级实装可能是别的版本（正是漂移证据）
    if (decl.installed && (!row.installed || decl.scope === 'root')) row.installed = decl.installed
  }
  const rows = []
  for (const row of byName.values()) {
    const entry = latestIndex[row.name] ?? {}
    const scopes = [...row.byScope.keys()].sort()
    const declaredBy = scopes.map((scope) => ({ scope, ...row.byScope.get(scope) }))
    const specVariants = [...new Set(declaredBy.map((item) => item.spec))].sort()
    // 根声明优先作为「主声明」：它是全仓工具链的基准
    const primary = row.byScope.get(scopes.includes('root') ? 'root' : scopes[0])
    const parsed = parseSpec(primary.spec)
    const baseline = row.installed ?? parsed.floor
    const latest = entry.latest ?? null
    const gap = entry.error ? { level: 'unknown', behind: null } : classifyGap(baseline, latest)
    rows.push({
      name: row.name,
      kinds: [...row.kinds].sort(),
      scopes,
      declaredBy,
      specVariants,
      drift: specVariants.length > 1,
      spec: primary.spec,
      specFloor: parsed.floor,
      installed: row.installed,
      baseline,
      latest,
      gap,
      error: entry.error ?? null,
      ...resolveTier({ name: row.name, gap, baseline }),
    })
  }
  // 稳定排序：包名升序（ASCII），保证两次运行输出可直接 diff。
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function summarizeRows(rows) {
  const tiers = {}
  const levels = {}
  for (const row of rows) {
    tiers[row.tier] = (tiers[row.tier] ?? 0) + 1
    levels[row.gap.level] = (levels[row.gap.level] ?? 0) + 1
  }
  return {
    total: rows.length,
    tiers,
    levels,
    unresolved: rows.filter((row) => row.gap.level === 'unknown').length,
    blocked: rows.filter((row) => row.blocked).length,
    upgradeable: rows.filter((row) => row.tier === 'A').length,
    drifted: rows.filter((row) => row.drift).length,
  }
}

const TIER_ORDER = ['A', 'B', 'C', 'D', 'OK', '?']

const TIER_TITLE = {
  A: '[A] 可直接升（低风险 patch / minor）',
  B: '[B] 需验证后升（跨大版本 / 预发布 / 内外部协同）',
  C: '[C] 有硬阻塞（先解阻塞再谈升级）',
  D: '[D] 破坏性，须先决策',
  OK: '[OK] 已是最新',
  '?': '[?] 无法判定（registry 未取到或版本不可解析）',
}

const gapLabel = (gap) => `[${gap.level}${gap.behind ? ' +' + gap.behind : ''}]`

function formatRow(row) {
  const parts = [
    row.spec.padEnd(22),
    `已装 ${(row.installed ?? row.specFloor ?? '—').padEnd(10)}`,
    `最新 ${(row.latest ?? (row.error ? 'N/A' : '—')).padEnd(10)}`,
    gapLabel(row.gap),
    row.drift ? `⚠声明漂移(${row.specVariants.length} 种)` : '',
  ]
  return `  ${row.name.padEnd(30)} ${parts.filter(Boolean).join(' ')}`
}

function renderDrift(lines, rows) {
  const drifted = rows.filter((row) => row.drift)
  if (!drifted.length) return
  lines.push('', `[⚠] 声明漂移（同名依赖在不同 package.json 声明不一致）—— ${drifted.length} 项`)
  for (const row of drifted) {
    lines.push(`  ${row.name}`)
    for (const item of row.declaredBy) {
      const installed = item.installed ? `（实装 ${item.installed}）` : ''
      lines.push(`      ${item.scope.padEnd(40)} ${item.spec}${installed}`)
    }
  }
}

/** 人类可读报告（按档分组、组内按包名排序 = 稳定输出）。 */
export function renderReport(rows, options = {}) {
  const stats = summarizeRows(rows)
  const lines = [
    `依赖矩阵（issue #184）：${options.scopeCount ?? '?'} 个 package.json / ${stats.total} 个外部依赖`,
    `分档：A=${stats.tiers.A ?? 0} B=${stats.tiers.B ?? 0} C=${stats.tiers.C ?? 0} D=${stats.tiers.D ?? 0} OK=${stats.tiers.OK ?? 0} ?=${stats.tiers['?'] ?? 0}` +
      `${stats.unresolved ? `（${stats.unresolved} 项未取到最新版本）` : ''}${stats.drifted ? `；声明漂移 ${stats.drifted} 项` : ''}`,
  ]
  for (const note of options.notes ?? []) lines.push(`· ${note}`)
  for (const tier of TIER_ORDER) {
    const group = rows.filter((row) => row.tier === tier)
    if (group.length === 0) continue
    lines.push('', `${TIER_TITLE[tier]} —— ${group.length} 项`)
    for (const row of group) lines.push(formatRow(row))
  }
  renderDrift(lines, rows)
  return lines.join('\n')
}

/** Markdown 表格（贴 PR / 存档用），同样按档分组、组内按包名排序。 */
export function renderMarkdown(rows) {
  const stats = summarizeRows(rows)
  const out = [
    `> 自动生成：\`node scripts/deps-matrix.mjs --markdown\`（issue #184）。共 ${stats.total} 个外部依赖：` +
      `A=${stats.tiers.A ?? 0} / B=${stats.tiers.B ?? 0} / C=${stats.tiers.C ?? 0} / D=${stats.tiers.D ?? 0} / OK=${stats.tiers.OK ?? 0} / ?=${stats.tiers['?'] ?? 0}；声明漂移 ${stats.drifted} 项`,
    '',
  ]
  for (const tier of TIER_ORDER) {
    const group = rows.filter((row) => row.tier === tier)
    if (group.length === 0) continue
    out.push(
      `### ${TIER_TITLE[tier]}`,
      '',
      '| 包 | 声明 | 已装 | 最新 | 差距 | 漂移 | 理由 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    )
    for (const row of group) {
      const spec = row.drift ? row.specVariants.map((item) => `\`${item}\``).join('<br>') : `\`${row.spec}\``
      const drift = row.drift ? `⚠ ${row.specVariants.length} 种` : '—'
      out.push(
        `| \`${row.name}\` | ${spec} | ${row.installed ?? row.specFloor ?? '—'} | ${row.latest ?? '—'} | ${gapLabel(row.gap)} | ${drift} | ${row.reason} |`,
      )
    }
    out.push('')
  }
  return out.join('\n')
}

/** 机读输出（CI / 二次处理用）。行的字段顺序由 buildRows 构造顺序固定，便于 diff。 */
export function renderJson(rows, options = {}) {
  return JSON.stringify(
    {
      issue: 184,
      scopeCount: options.scopeCount ?? null,
      registry: options.registry ?? null,
      summary: summarizeRows(rows),
      rows,
    },
    null,
    2,
  )
}
