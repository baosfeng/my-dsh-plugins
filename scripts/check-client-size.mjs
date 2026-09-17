#!/usr/bin/env node
/**
 * 客户端产物体积预算门禁 —— scripts/check-client-size.mjs（issue #322）
 *
 * 背景（本仓库此前**没有任何体积门禁**）：
 *   产物体积直接决定用户下载量与加载时间（#186 的 combo 分批逻辑正是围绕它做的取舍），
 *   但体积回归只能靠人工发现。最贵的一次是 issue #185：mermaid 引擎以 base64 内联进
 *   client bundle，`lib/client.js` 从 8.93 MB"降"到 4.49 MB 仍含 **4.48 MB 冗余**，
 *   全程无人报警。同类风险还有 dsh-shared/client-parts 被 11 个插件构建期拼接——
 *   共享件"顺带膨胀"会被放大 11 倍。而 CI 不跑构建、也不量体积，所以必须独立设卡。
 *
 * 门禁范围（issue #322 的**范围修正**）：
 *   只查 `plugins/*\/lib/client.js` 会漏掉真正的 99% —— 14 个 client 产物合计仅
 *   924 KB（最大 md-render 152.5 KB），而 `dsh-mermaid-render/assets/mermaid-10.9.3.min.js`
 *   单个就 3.18 MB（该插件 `npm pack` unpacked 3.44 MB，引擎占 92%）。因此本脚本扫描
 *   **每个插件的完整发布面**，且以 `package.json` 的 `files` 字段为唯一权威（`assets/` 等目录
 *   是否随包发布完全由它决定）：
 *     · `files` 里的目录被递归展开，逐文件量体积；
 *     · 另有「每插件发布面合计」兜底，防"新增一堆中等文件"绕过逐文件检查。
 *
 * 上限 = 基线 + 余量（余量取 max(64 KB 绝对底, 基线的 15%)，依据见下方常量注释）：
 *   · 逐文件：登记过基线的文件用其基线；**未登记**的文件用 DEFAULT_FILE_LIMIT_BYTES；
 *   · 每插件合计：登记过 total 的插件用其 total（新插件无基线则只受逐文件约束）。
 *   基线冻结在 `scripts/client-size-baseline.json`（含测量时间与来源），只允许变好：
 *   体积变小 / 基线条目陈旧（重构、改文件名、插件退役）一律通过，不阻塞正常演进。
 *
 * fail-closed（绝不静默变绿——"门禁空转"比"超标"更危险）：
 *   · 扫不到任何产物 → 失败（插件改名 / `files` 写错会让门禁失效而无人察觉）；
 *   · 插件 `package.json` 解析失败、缺 `files` 字段、`files` 含 glob 形态 → 失败；
 *     （glob 形态说明发布面已超出本脚本的解析能力，必须显式失败而不是漏扫）
 *   · 基线缺失 / JSON 损坏 → **工具错误**（exit 2），与"门禁失败"区分。
 *
 * 用法：
 *   node scripts/check-client-size.mjs                    # 门禁模式（默认）
 *   node scripts/check-client-size.mjs --json             # 机器可读结果
 *   node scripts/check-client-size.mjs --update-baseline  # 重新生成基线（改完在 PR 里说明原因）
 *   node scripts/check-client-size.mjs --root <dir> --baseline <file>   # 指定根/基线（测试用）
 *
 * 退出码：0 通过；1 有产物超限 / 扫描失败（含 fail-closed 各类）；2 工具错误（基线缺失或损坏、
 *         用法错误）——解析失败绝不静默跳过。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ *
 * 余量常量（阈值必须有据可依，禁止"当前值 ×1.01"这类无理由数字）
 * ------------------------------------------------------------------ */

/**
 * 绝对余量底（64 KB）。
 *
 * 依据：`git log` 全历史实测（649 个提交、136 次 `lib/client.js` **增长**事件，已排除 #185 异常期）的
 * **单次提交绝对增量**分布：
 *   p50 = 1.7 KB ／ p90 = 14.7 KB ／ p95 = 17.4 KB ／ p99 = 24.3 KB ／ max = 27.0 KB
 * （含"改一次 dsh-shared/client-parts、11 个插件产物同时增长"这类连带效应，
 *   因为 client-parts 是构建期拼接进各产物的）。
 *
 * 取 64 KB ≈ p100 × 2.4 的理由：
 *   · 下界（不制造日常摩擦）：正常功能提交（改一行、加一个小面板、共享件同步增长）
 *     离 64 KB 还有 2 倍以上空间，不会出现"改一行就要调基线"；
 *   · 上界（不形同虚设）：对当前最大的 client.js 基线（152.5 KB）上限是 216.5 KB，
 *     仅为 #185 冗余量级（4.48 MB = 4587 KB）的 4.7%——事故级的注入必被拦下。
 */
export const ABS_FLOOR_BYTES = 64 * 1024

/**
 * 相对余量（15%）。
 *
 * 绝对值底对**大体量产物**失效：3.18 MB 的 vendored mermaid 引擎只允许 +64 KB 会紧到
 * 每次换版都误报；反过来对小产物又不能只按比例（6.8 KB 的 ts-example 按 15% 只有 1 KB）。
 * 故二者取 max：
 *   limit = baseline + max(64 KB, baseline × 15%)
 *
 * 15% 的判据：它只用于让已登记的 vendored 资源在**小版本内漂移**时不误报；真正的
 * 大版本换代（体积显著变化）本就应当显式评审并刷新基线——那正是这个门禁的目的，
 * 所以相对余量刻意取"够用但不宽"的 15%，而不是 50% 这种形同虚设的值。
 */
export const REL_MARGIN = 0.15

/**
 * 未登记文件的默认上限（1 MB）。
 *
 * 依据：当前发布面里最大的非引擎静态资源是 ~200 KB 级 README 截图
 * （实测 dsh-my-memory 5 张共 544 KB、dsh-file-activity 3 张共 576 KB）→ 1 MB 给了 5× 余量，
 * 新增/替换截图永远不会触发；而 #185 的 4.48 MB 量级会被稳稳拦住。
 * 超过 1 MB 的新文件要求显式登记基线（一次"体积变化评审"），这正是我们要的。
 */
export const DEFAULT_FILE_LIMIT_BYTES = 1024 * 1024

/** 基线读取 / 解析失败（与"门禁失败"区分：这是工具错误，exit 2）。 */
export class BaselineError extends Error {}

/** 仓库根（CLI --root 可覆盖，测试用）。 */
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 基线路径（CLI --baseline 可覆盖，测试用）。 */
const DEFAULT_BASELINE = join(DEFAULT_ROOT, 'scripts', 'client-size-baseline.json')

/** 需要逐个冻结基线的产物前缀（"产物面"）；其余发布面文件（README/CHANGELOG/…）只受默认上限约束。 */
const TRACKED_PREFIXES = ['lib/', 'assets/']
/** 遍历目录时跳过（npm 也不会打包它们）。 */
const SKIP_DIRS = new Set(['node_modules', '.git'])

/* ------------------------------------------------------------------ *
 * 阈值与测量
 * ------------------------------------------------------------------ */

/** 上限公式：baseline + max(绝对底, baseline × 相对余量)。 */
export function limitFor(baselineBytes) {
  return baselineBytes + Math.max(ABS_FLOOR_BYTES, Math.round(baselineBytes * REL_MARGIN))
}

/** 是否属于"要冻结基线的产物面"。 */
export function isTrackedPath(relPath) {
  return TRACKED_PREFIXES.some((prefix) => relPath.startsWith(prefix))
}

const toKB = (bytes) => bytes / 1024
const fmtKB = (bytes) => toKB(bytes).toFixed(1)

/* ------------------------------------------------------------------ *
 * 发布面解析（以 package.json 的 files 字段为唯一权威）
 * ------------------------------------------------------------------ */

/** 递归列出一个目录下的全部文件（相对 pluginDir 的路径，POSIX 分隔符）。 */
function walkFiles(pluginDir, absDir) {
  const out = []
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const abs = join(absDir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(pluginDir, abs))
    else if (entry.isFile()) out.push(relative(pluginDir, abs).split(sep).join('/'))
  }
  return out
}

/**
 * 解析一个插件的发布面（npm `files` 字段语义的最小子集：目录递归展开 / 文件按名收录）。
 *
 * 刻意不做完整 npm-packlist 模拟（.npmignore、取反模式等本仓库未使用）；遇到本脚本
 * 无法正确解析的形态（glob、非字符串条目）**一律抛错**——漏扫一个 4 MB 文件比误报严重得多。
 */
export function collectPublishFiles(pluginDir, pkg, pluginName) {
  const files = pkg?.files
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`插件 ${pluginName} 的 package.json 缺少非空 files 字段 —— 发布面无法确定（fail-closed，不猜）`)
  }
  const out = new Set()
  for (const entry of files) {
    if (typeof entry !== 'string' || entry === '') {
      throw new Error(`插件 ${pluginName} 的 package.json files 含非法条目：${JSON.stringify(entry)}`)
    }
    if (/[*?[\]{}]/.test(entry)) {
      throw new Error(
        `插件 ${pluginName} 的 package.json files 含 glob 形态 "${entry}" —— 本脚本只支持目录/文件路径，` +
          `glob 会导致发布面漏扫，请改为具体目录或扩展 scripts/check-client-size.mjs`,
      )
    }
    const abs = join(pluginDir, entry)
    if (!existsSync(abs)) continue // files 里列出但不存在的条目：npm 同样忽略
    const st = statSync(abs)
    if (st.isDirectory()) for (const rel of walkFiles(pluginDir, abs)) out.add(rel)
    else if (st.isFile()) out.add(entry)
  }
  // npm 总是把 package.json 打进 tarball（对齐 `npm pack` 的口径）
  out.add('package.json')
  return [...out].sort()
}

/* ------------------------------------------------------------------ *
 * 基线
 * ------------------------------------------------------------------ */

/** 读基线（缺失/损坏一律抛 BaselineError → exit 2，绝不当作"无基线"放行）。 */
export function loadBaseline(baselinePath) {
  if (!existsSync(baselinePath)) {
    throw new BaselineError(
      `基线文件不存在：${baselinePath}\n` +
        `  体积门禁必须有基线才能判定（无基线 = 无预算 = 形同虚设）。首次建立：node scripts/check-client-size.mjs --update-baseline`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    throw new BaselineError(`基线文件解析失败：${baselinePath} — ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.plugins !== 'object' || parsed.plugins === null) {
    throw new BaselineError(`基线文件结构非法（缺 plugins 对象）：${baselinePath}`)
  }
  return parsed
}

/* ------------------------------------------------------------------ *
 * 审计
 * ------------------------------------------------------------------ */

/**
 * 扫描仓库全部插件的发布面并逐项判定。
 * @returns {{ plugins: Array, problems: Array, stale: Array, scannedFiles: number, totalBytes: number }}
 * @throws {BaselineError} 基线缺失/损坏（工具错误）
 * @throws {Error} 扫描侧 fail-closed（无产物 / package.json 解析失败 / 缺 files / glob）
 */
export function auditRepo({ root = DEFAULT_ROOT, baselinePath = DEFAULT_BASELINE } = {}) {
  const baseline = loadBaseline(baselinePath)
  const pluginsDir = join(root, 'plugins')
  if (!existsSync(pluginsDir)) throw new Error(`插件目录不存在：${pluginsDir}（扫描不到任何产物 —— fail-closed）`)

  const plugins = []
  const problems = []
  const stale = []

  for (const name of readdirSync(pluginsDir).sort()) {
    const pluginDir = join(pluginsDir, name)
    if (!statSync(pluginDir).isDirectory()) continue
    const pkgPath = join(pluginDir, 'package.json')
    if (!existsSync(pkgPath)) continue

    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (error) {
      throw new Error(`插件 ${name} 的 package.json 解析失败（fail-closed，不跳过）：${error.message}`)
    }

    const publish = collectPublishFiles(pluginDir, pkg, name)
    const base = baseline.plugins[name] ?? null
    const baseFiles = base?.files ?? {}
    const entries = []
    let total = 0

    for (const rel of publish) {
      const abs = join(pluginDir, rel)
      let size
      try {
        size = statSync(abs).size
      } catch (error) {
        throw new Error(`读取产物失败（fail-closed）：${name}/${rel} — ${error.message}`)
      }
      total += size
      const registered = typeof baseFiles[rel] === 'number'
      const limit = registered ? limitFor(baseFiles[rel]) : DEFAULT_FILE_LIMIT_BYTES
      entries.push({ path: rel, size, limit, registered, baseline: registered ? baseFiles[rel] : null })
      if (size > limit) {
        problems.push({
          plugin: name,
          path: rel,
          current: size,
          limit,
          over: size - limit,
          registered,
          baseline: registered ? baseFiles[rel] : null,
        })
      }
    }

    // 基线里登记但磁盘上已不存在 → 陈旧条目（重构/改名/退役），只提示不阻塞
    for (const rel of Object.keys(baseFiles)) {
      if (!publish.includes(rel)) stale.push({ plugin: name, path: rel, baseline: baseFiles[rel] })
    }

    // 每插件发布面合计（兜底：逐文件都不超限也可能被"一堆中等文件"顶上去）
    if (typeof base?.total === 'number') {
      const limit = limitFor(base.total)
      if (total > limit) {
        problems.push({
          plugin: name,
          path: '（发布面合计）',
          current: total,
          limit,
          over: total - limit,
          registered: true,
          baseline: base.total,
          aggregate: true,
        })
      }
    }

    plugins.push({ plugin: name, entries, total, baselineTotal: typeof base?.total === 'number' ? base.total : null })
  }

  if (plugins.length === 0) {
    throw new Error(
      `扫描不到任何产物：${pluginsDir} 下没有带 package.json 的插件目录 —— fail-closed（门禁不得静默变绿）`,
    )
  }
  const scannedFiles = plugins.reduce((sum, p) => sum + p.entries.length, 0)
  if (scannedFiles === 0) {
    throw new Error('扫描到 0 个发布面文件 —— fail-closed（每个插件的 files 都为空？门禁不得静默变绿）')
  }

  return { plugins, problems, stale, scannedFiles, totalBytes: plugins.reduce((s, p) => s + p.total, 0) }
}

/* ------------------------------------------------------------------ *
 * 报告
 * ------------------------------------------------------------------ */

const HINTS = [
  '重复注入：同一段代码 / vendored 资源被拼进产物多次 —— issue #185 就是 3.3 MB mermaid UMD 以 base64 内联进 client.js（8.93 MB → 4.49 MB，含 4.48 MB 冗余），先查 scripts/build.mjs 的注入点与 splice 断言',
  'vendored 文件被格式化膨胀：压缩产物被 prettier / 构建重排或二次压缩，体积反而变大',
  '误把 assets 内联：assets/** 是运行时按需 fetch 的静态资源，不应内联进 lib/client.js',
  '若增长确属合理（新增功能 / vendored 资源换代）：node scripts/check-client-size.mjs --update-baseline 刷新基线，并在 PR 说明原因',
]

/** 人类可读报告（超限时必须给出「插件 | 当前 KB | 上限 KB | 超出 KB」+ 排查提示）。 */
export function renderReport(result) {
  const lines = []
  lines.push('客户端产物体积预算门禁（scripts/check-client-size.mjs，issue #322）')
  lines.push(
    `扫描：${result.plugins.length} 个插件，发布面 ${result.scannedFiles} 个文件，合计 ${fmtKB(result.totalBytes)} KB`,
  )
  if (result.problems.length === 0) {
    lines.push('✅ 通过：全部发布面产物都在「基线 + 余量」之内（上限 = 基线 + max(64 KB, 基线×15%)）')
  } else {
    lines.push('')
    lines.push(`❌ ${result.problems.length} 项超限：`)
    lines.push('')
    lines.push('插件 | 条目 | 当前 KB | 上限 KB | 超出 KB')
    for (const p of result.problems) {
      const mark = p.registered ? '' : '（未登记）'
      lines.push(`${p.plugin} | ${p.path}${mark} | ${fmtKB(p.current)} | ${fmtKB(p.limit)} | ${fmtKB(p.over)}`)
    }
    lines.push('')
    lines.push('排查提示（按历史事故排序）：')
    for (const hint of HINTS) lines.push(`  · ${hint}`)
  }
  if (result.stale.length > 0) {
    lines.push('')
    lines.push(
      `⚠ 基线含 ${result.stale.length} 个陈旧条目（文件已不在发布面：重构 / 改名 / 插件退役），不影响判定；` +
        '收口后可 node scripts/check-client-size.mjs --update-baseline 清理：',
    )
    for (const s of result.stale) lines.push(`  - ${s.plugin}/${s.path}（基线 ${fmtKB(s.baseline)} KB）`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * 基线生成
 * ------------------------------------------------------------------ */

/** 用当前实测值重建基线（保留 note 与余量说明，只刷新测量结果）。 */
export function buildBaseline({ root = DEFAULT_ROOT, previous = null }) {
  const pluginsDir = join(root, 'plugins')
  const now = new Date()
  const measuredAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const plugins = {}
  for (const name of readdirSync(pluginsDir).sort()) {
    const pluginDir = join(pluginsDir, name)
    if (!statSync(pluginDir).isDirectory()) continue
    const pkgPath = join(pluginDir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const publish = collectPublishFiles(pluginDir, pkg, name)
    const files = {}
    let total = 0
    for (const rel of publish) {
      const size = statSync(join(pluginDir, rel)).size
      total += size
      if (isTrackedPath(rel)) files[rel] = size
    }
    plugins[name] = { total, files }
  }
  return {
    note:
      previous?.note ??
      '客户端产物体积预算基线（issue #322）：登记各插件**发布面**的体积实测值。上限 = 基线 + max(64 KB, 基线×15%)，' +
        '理由见 scripts/check-client-size.mjs 顶部常量注释。unpacked total = 该插件 npm 发布面全部文件字节和；' +
        'files = 逐个冻结的产物（lib/** 与 assets/**）。未登记的文件与插件只受默认上限（1 MB/文件）约束。' +
        '刷新：node scripts/check-client-size.mjs --update-baseline（须在 PR 说明体积变化原因）。',
    measuredAt,
    source: 'npm pack --dry-run --json（19 个插件与 git ls-tree 实测复核：unpacked 3.44 MB / mermaid 引擎占 92%）',
    margin: {
      absFloorBytes: ABS_FLOOR_BYTES,
      relMargin: REL_MARGIN,
      defaultFileLimitBytes: DEFAULT_FILE_LIMIT_BYTES,
      why:
        '绝对底 64 KB = git 全历史 136 次 client.js 增长事件的 max 27.0 KB × 2.4；相对余量 15% 用于大体量 vendored 资源；' +
        '判据：对当前最大 client.js 基线（152.5 KB）上限 216.5 KB，仅为 #185 冗余量级（4.48 MB）的 4.7%',
    },
    plugins,
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, baselinePath: DEFAULT_BASELINE, json: false, update: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) {
        console.error(
          `用法：node scripts/check-client-size.mjs [--json] [--update-baseline] [--root <dir>] [--baseline <file>]`,
        )
        process.exit(2)
      }
      return v
    }
    if (flag === '--json') options.json = true
    else if (flag === '--update-baseline') options.update = true
    else if (flag === '--root') options.root = value()
    else if (flag === '--baseline') options.baselinePath = value()
    else {
      console.error(`未知参数：${flag}`)
      console.error(
        `用法：node scripts/check-client-size.mjs [--json] [--update-baseline] [--root <dir>] [--baseline <file>]`,
      )
      process.exit(2)
    }
  }
  return options
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2))

  if (options.update) {
    let previous = null
    try {
      previous = loadBaseline(options.baselinePath)
    } catch {
      // 首次建立基线时不存在是正常的
    }
    const baseline = buildBaseline({ root: options.root, previous })
    writeFileSync(options.baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    const count = Object.keys(baseline.plugins).length
    console.log(`✅ 基线已刷新：${options.baselinePath}（${count} 个插件，测量时间 ${baseline.measuredAt}）`)
    process.exit(0)
  }

  try {
    const result = auditRepo({ root: options.root, baselinePath: options.baselinePath })
    if (options.json) {
      console.log(JSON.stringify({ ok: result.problems.length === 0, ...result }, null, 2))
    } else {
      console.log(renderReport(result))
    }
    process.exit(result.problems.length === 0 ? 0 : 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof BaselineError) {
      // 基线缺失/损坏 = 工具错误，与"门禁失败"区分开
      console.error(`❌ 体积预算门禁：工具错误 — ${message}`)
      process.exit(2)
    }
    // 扫描侧 fail-closed（无产物 / package.json 解析失败 / 缺 files / glob）→ 门禁失败
    console.error(`❌ 体积预算门禁：扫描失败（fail-closed，绝不静默变绿）— ${message}`)
    process.exit(1)
  }
}
