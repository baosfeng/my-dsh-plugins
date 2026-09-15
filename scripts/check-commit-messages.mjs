#!/usr/bin/env node
/**
 * check-commit-messages.mjs — CI 层「提交信息规范」门禁（issue #324 需求 B）的 CLI。
 *
 * 判据在 scripts/lib/commit-lint.mjs（纯函数件，可单测）；本文件只做 IO：
 * 解析范围 → 从 git 取范围内的提交 → 逐条交给 @commitlint/lint 校验 → 渲染结论。
 *
 * 规则来源：**.commitlintrc.json（同一份文件）**——与本地 .husky/commit-msg 完全同源，
 * 不在本脚本里重写规则（两处规则会漂移）。config-conventional + type-enum 白名单，
 * 天然允许本仓库风格：`type(scope): #编号 中文摘要`（issuePrefixes 含 `#`、scope 可省略或逗号分隔）。
 *
 * 用法：
 *   node scripts/check-commit-messages.mjs --from <sha> --to <sha>   # 校验区间（不含 from）
 *   node scripts/check-commit-messages.mjs --to <sha>                # 只校验这 1 个提交
 *   node scripts/check-commit-messages.mjs --range <a>..<b>          # 与 --from/--to 等价写法
 *   node scripts/check-commit-messages.mjs --last                    # 只校验 HEAD 这 1 个提交
 *   node scripts/check-commit-messages.mjs                            # 自动推导范围（CI 与本地共用）
 *   node scripts/check-commit-messages.mjs --explain --json          # 只打印范围解析结果与来源（CI 探测用）
 *   node scripts/check-commit-messages.mjs --allow-empty             # 允许空范围（**仅本地调试**）
 *   node scripts/check-commit-messages.mjs --config <路径>           # 用别的 commitlint 配置文件（默认 .commitlintrc.json）
 *
 * 环境变量（**仅供回归测试**，CI 与本地都不设）：
 *   COMMITLINT_RULES_JSON='{"rules":{...},"parserOpts":{...}}'  直接注入规则，跳过配置文件加载。
 *   存在的理由：夹具仓库在 /tmp 下解析不到本仓库 node_modules，而按路径加载配置在
 *   commitlint 内部有缓存，导致"改了配置再跑一次"拿不到新规则（测试会变成假绿）。
 *   node scripts/check-commit-messages.mjs --json
 *
 * 退出码：0 = 范围内提交全部合规；1 = 有不合格提交 / 范围为空 / 范围解析失败；2 = 用法错误。
 *
 * ⚠️ 只校验指定范围，绝不校验整个历史：实测 639 个非 merge 提交里 61 条不符合默认规则
 * （9.5%，2026-09-15），全历史校验会让门禁恒红。详见 lib/commit-lint.mjs 头注释。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import load from '@commitlint/load'
import lint from '@commitlint/lint'
import {
  collectFindings,
  commitRangeSpec,
  commitRecord,
  decideEmptyRange,
  renderCommitReport,
} from './lib/commit-lint.mjs'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_TIMEOUT_MS = 30_000
/** 提交数上限：范围内提交过多通常意味着范围写错（例如误传 main..HEAD 的全量），显式拦下。 */
const MAX_COMMITS = 200

const args = process.argv.slice(2)
const options = {
  from: null,
  to: null,
  range: null,
  config: null,
  last: false,
  explain: false,
  allowEmpty: false,
  json: false,
  help: false,
}
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i]
  const value = () => {
    const v = args[++i]
    if (v === undefined) usage(`[commits] ${flag} 缺少参数值`)
    return v
  }
  if (flag === '--from') options.from = value()
  else if (flag === '--to') options.to = value()
  else if (flag === '--range') options.range = value()
  else if (flag === '--config') options.config = value()
  else if (flag === '--last') options.last = true
  else if (flag === '--explain') options.explain = true
  else if (flag === '--allow-empty') options.allowEmpty = true
  else if (flag === '--json') options.json = true
  else if (flag === '--help' || flag === '-h') options.help = true
  else usage(`[commits] unknown flag: ${flag}`)
}
if (options.help) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .split('/**')[1]
      .replace(/^ \* ?/gm, ''),
  )
  process.exit(0)
}
function usage(message) {
  console.error(message)
  console.error('[commits] 用法：--from <sha> --to <sha> | --range a..b | --last | --explain（--help 看全集）')
  process.exit(2)
}

/**
 * git 只读调用（数组传参，无 shell 注入；带超时，绝不挂死）。
 *
 * ⚠️ 仓库按 **cwd** 解析（`git -C process.cwd()`），不是按脚本路径：本项目用 fork 池 /
 * worktree，脚本的物理路径可能落在主仓库下，`cwd: REPO_ROOT` 会读到**错误的仓库**——
 * 开发期实测：夹具仓库里跑 CLI 时 git 查询打到主仓库，"Feat:" 这类不合规提交被判成通过
 * （假绿，正是本 issue 要防的那类问题）。与 .husky/commit-msg 的语义也一致：hook 在仓库根跑。
 */
function git(gitArgs) {
  try {
    return execFileSync('git', ['-C', process.cwd(), ...gitArgs], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    }).trim()
  } catch (error) {
    return {
      error: String(error?.stderr ?? error?.message ?? error)
        .trim()
        .slice(0, 200),
    }
  }
}

/** `--range a..b` 与 `--from/--to` 等价（只在这里拆一次，判据仍走 commitRangeSpec）。 */
if (options.range) {
  const [from, to] = String(options.range).split('..')
  if (options.from || options.to || options.last) usage('[commits] --range 不能与 --from/--to/--last 同用')
  options.from = from || null
  options.to = to === undefined ? null : to || null
}
if (options.last) {
  if (options.from || options.to) usage('[commits] --last 不能与 --from/--to 同用')
  options.to = 'HEAD'
}

/**
 * 范围来源（**自动推导**，让 CI 与本地跑同一条命令）：
 *   1. 显式 `--from/--to/--range/--last` 优先；
 *   2. CI：读 `GITHUB_EVENT_PATH`（GitHub 给每个 step 的真实事件 JSON）——
 *      PR = `pull_request.base.sha..head.sha`；push = `before..after`（before 全 0 = 首次推送 → 只查 after）；
 *   3. 本地：`@{upstream}` → `origin/main`（与 verify-local 的基准口径一致）。
 * 为什么不用 workflow 里的 `${{ github.event... }}` 拼 shell：那样 CI 命令与本地命令不同源，
 * 一旦 workflow 写错（例如浅克隆下取不到 SHA）本地复现不了；放进脚本则**两边同一条命令**，
 * 且 `--explain` 能直接打印"范围从哪来"。
 */
function deriveRange() {
  if (options.from || options.to) return { from: options.from, to: options.to, source: '显式参数' }
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf8'))
      const pr = event.pull_request
      if (pr?.base?.sha && pr?.head?.sha) {
        return { from: pr.base.sha, to: pr.head.sha, source: `GITHUB_EVENT_PATH（pull_request base..head）` }
      }
      const before = event.before
      const after = event.after ?? process.env.GITHUB_SHA
      if (after) {
        const firstPush = typeof before !== 'string' || /^0+$/.test(before)
        return firstPush
          ? { from: null, to: after, source: 'GITHUB_EVENT_PATH（push 首次推送 → 只查最新提交）' }
          : { from: before, to: after, source: 'GITHUB_EVENT_PATH（push before..after）' }
      }
    } catch (error) {
      return { from: null, to: null, source: `GITHUB_EVENT_PATH 解析失败：${String(error?.message ?? error).slice(0, 80)}` }
    }
  }
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (typeof upstream === 'string' && upstream && upstream !== 'HEAD') {
    return { from: upstream, to: 'HEAD', source: `@{upstream} = ${upstream}` }
  }
  if (typeof git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']) === 'string') {
    return { from: 'origin/main', to: 'HEAD', source: 'origin/main（本地兜底）' }
  }
  return { from: null, to: null, source: '无法推导（无显式参数、无 GITHUB_EVENT_PATH、无 @{upstream}/origin/main）' }
}

const derived = deriveRange()
const spec = commitRangeSpec({ from: derived.from, to: derived.to })
if (options.explain) {
  // CI 用它打印「本次要校验几个提交」，也是「范围解析失败」的显式出口（退出码 1）
  console.log(JSON.stringify({ ...spec, source: derived.source, count: spec.ok ? countCommits(spec) : 0 }, null, 2))
  process.exit(spec.ok ? 0 : 1)
}
if (!spec.ok) {
  const verdict = decideEmptyRange({ allowEmpty: options.allowEmpty, reason: spec.reason })
  console.error(
    renderCommitReport({ ok: verdict.ok, range: '(未指定)', checked: 0, findings: [], reason: verdict.reason }),
  )
  process.exit(verdict.ok ? 0 : 1)
}

const count = countCommits(spec)
if (typeof count === 'object') {
  console.error(`[commits] ❌ 无法解析范围 ${spec.reason}：${count.error}`)
  console.error('[commits]   fail-closed 判失败（范围解析不了时绝不当作"通过"）。')
  process.exit(1)
}
if (count === 0) {
  /**
   * 空范围的三种语义（都不静默放过，只是"该不该红"不同）：
   *   · 用户**显式**给了范围 → 红（他明确要求查这个范围，空说明范围写错）；`--allow-empty` 可放行；
   *   · CI（有 GITHUB_EVENT_PATH）自动推导出空范围 → 红（事件/checkout 配错了，属 fail-closed）；
   *   · 本地自动推导出空范围 → **绿 + 打印原因**：在 main 上、刚 rebase 完、或已合并时，
   *     "没有待校验提交"是正常状态，判红只会训练人忽略这条门禁。
   */
  const explicitRange = Boolean(options.from || options.to || options.range || options.last)
  const derivedInCi = Boolean(process.env.GITHUB_EVENT_PATH)
  const autoSkip = !explicitRange && !derivedInCi
  const verdict = decideEmptyRange({
    allowEmpty: options.allowEmpty || autoSkip,
    reason:
      `范围 ${spec.reason} 内没有提交` +
      (autoSkip ? '（本地自动推导：无可校验提交，跳过；CI 侧空范围判失败）' : ''),
  })
  console.error(
    renderCommitReport({
      ok: verdict.ok,
      range: `${spec.reason}｜来源：${derived.source}`,
      checked: 0,
      findings: [],
      reason: verdict.reason,
    }),
  )
  process.exit(verdict.ok ? 0 : 1)
}
if (count > MAX_COMMITS) {
  console.error(`[commits] ❌ 范围 ${spec.reason} 含 ${count} 个提交（上限 ${MAX_COMMITS}）——范围大概率写错。`)
  process.exit(1)
}

const startedAt = Date.now()
const commits = listCommits(spec)
if (commits === null) {
  console.error(`[commits] ❌ 无法读取范围 ${spec.reason} 内的提交（fail-closed）`)
  process.exit(1)
}

// ── 与本地 hook 同源的规则：全部来自 .commitlintrc.json ──────────────────────
/**
 * 配置来源：默认就是仓库根的 .commitlintrc.json（**规则只有一份**，本脚本不重写规则）。
 * --config 是回归测试用的逃生口：夹具仓库在 /tmp 下，`extends` 解析不到本仓库的
 * node_modules（实测 MODULE_NOT_FOUND），所以夹具自带一份**完整规则（不带 extends）**的配置。
 * CI 与本地 hook 都不传 --config，行为与 .husky/commit-msg 同源。
 */
const injected = readInjectedRules()
const config =
  injected ?? (await load({}, options.config ? { file: resolve(options.config), cwd: REPO_ROOT } : { cwd: REPO_ROOT }))
const rules = config.rules
const parserOpts = injected ? injected.parserOpts : config.parserPreset?.parserOpts

/** 读取测试注入的规则（见文件头「环境变量」）。解析失败即判用法错误，绝不静默回落成"无规则"。 */
function readInjectedRules() {
  const raw = process.env.COMMITLINT_RULES_JSON
  if (raw === undefined || raw.trim() === '') return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.rules !== 'object') {
      usage('[commits] COMMITLINT_RULES_JSON 必须是 {"rules":{...},"parserOpts":{...}}')
    }
    return parsed
  } catch (error) {
    usage(`[commits] COMMITLINT_RULES_JSON 不是合法 JSON：${String(error?.message ?? error).slice(0, 120)}`)
    return null
  }
}
/**
 * 逐条校验。刻意用 @commitlint/lint 的 API 而不是 `commitlint --from --to` CLI：
 *   · API 能逐条拿到 errors（CLI 只有汇总退出码，报告无法定位到具体哪条规则）；
 *   · CLI 在 `--from == --to` 时直接报错退出 9（实测），API 没有这个坑。
 * defaultIgnores: false —— 不套用「Merge/Revert/…」这类默认忽略，规则集保持与 hook 一致。
 */
const lintOne = (message) => lint(message, rules, { defaultIgnores: false, parserOpts })
const outcome = await collectFindings(commits, lintOne)
const ms = Date.now() - startedAt

const notes = []
if (count !== outcome.checked) notes.push(`范围含 ${count} 个提交但只校验了 ${outcome.checked} 个（不一致，已判失败）`)
const ok = outcome.ok && count === outcome.checked

if (options.json) {
  console.log(
    JSON.stringify(
      commitRecord({
        ok,
        range: spec.reason,
        checked: outcome.checked,
        findings: outcome.findings,
        ms,
        reason: outcome.reason,
      }),
      null,
      2,
    ),
  )
} else {
  console.log(
    renderCommitReport({
      ok,
      range: spec.reason,
      checked: outcome.checked,
      findings: outcome.findings,
      reason: outcome.reason,
      notes,
    }),
  )
}
process.exit(ok ? 0 : 1)

/** 范围内的提交数（`A..B` 语义；出错返回 { error }）。 */
function countCommits(spec) {
  const out = git(['rev-list', '--count', `${spec.from}..${spec.to}`])
  if (typeof out === 'object') return out
  return Number.parseInt(out, 10)
}

/**
 * 取范围内提交（按时间正序，报告读起来与改动顺序一致）。
 * 用 NUL 分隔记录、RS(0x1e) 分隔字段，避免提交信息里的换行/特殊字符把解析搅乱。
 */
function listCommits(spec) {
  const out = git(['log', '--reverse', '--no-merges', '--format=%H%x1e%s%x1e%B%x1d', `${spec.from}..${spec.to}`])
  if (typeof out === 'object') return null
  const records = out
    .split('\u001d')
    .map((r) => r.trim())
    .filter(Boolean)
  const commits = []
  for (const record of records) {
    const [sha, subject, ...rest] = record.split('\u001e')
    if (!sha) continue
    commits.push({ sha: sha.trim(), subject: (subject ?? '').trim(), message: rest.join('\u001e') })
  }
  return commits
}
