#!/usr/bin/env node
/**
 * check-gate-parity.mjs — 本地与 CI 的**门禁覆盖一致性**自动校验（issue #330 关键交付物）。
 *
 * 解决的问题（issue #330 第 5 条）：改前 `verify-local` 的 typecheck 只跑根 `tsc --noEmit`，
 * 而 CI 还跑 `typecheck-all.sh`（18 插件的 server + client 端）——**本地全绿、CI 红**，
 * 白等一轮 CI；而「本地该跑哪些」与「CI 该跑哪些」这两个集合，此前没有任何机制能对着看。
 *
 * 本脚本把三方拉到一起做**双向**校验，缺口逐条列出（绝不静默通过）：
 *   ① `scripts/lib/gate-registry.mjs`：我们**声明**了哪些门禁、权威执行点在哪
 *   ② `.github/workflows/ci.yml`（真实文本）：CI **实际**跑了什么
 *   ③ `node scripts/verify-local.mjs --list --json`（真实运行）：本地**实际**有哪些检查项、命令是什么
 *
 * 检测的缺口类型：
 *   [声明≠CI]   registry 声明的 CI 步骤在 ci.yml 里找不到 / 命令对不上
 *   [CI≠声明]   ci.yml 里有**未登记**的命令步骤（有人偷偷加了门禁，或加了检查却没进登记表）
 *   [声明≠本地] registry 声明的本地检查项在 verify-local 里不存在
 *   [本地≠声明] verify-local 有检查项但 registry 未登记（本地偷偷多跑/少跑）
 *   [命令漂移]  registry 的 localCommand 与 verify-local 实际执行的命令不一致
 *   [范围漂移]  某项是否属于 CI quality 聚合步骤，两边说法不一致
 *   [无执行点]  某条规则既没有本地执行点也没有 CI 执行点（= 规则实际上不存在了）
 *   [上报不得判红] 第三方**上报**步骤（Coveralls）没带 `continue-on-error: true`（issue #350）
 *
 * 用法：
 *   node scripts/check-gate-parity.mjs          # 校验，缺口列出，退出码 0/1
 *   node scripts/check-gate-parity.mjs --json   # 机器可读输出
 *
 * ⚠️ 本脚本本身就是一条门禁（gate id = `gate-parity`），被 verify-local 与 CI 同时执行；
 *    否则「校验覆盖一致性」这件事自己就会变成新的静默缺口。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CI_INFRA_STEPS,
  GATE_BY_ID,
  GATE_REGISTRY,
  LOCAL_EXEMPTIONS,
  ciDeclarations,
  CI_BEST_EFFORT_STEPS,
} from './lib/gate-registry.mjs'
import { parseWorkflow, stepCommand } from './lib/ci-workflow.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')

/** 取 verify-local 的**运行时真实清单**（不是源码文本，避免正则解析代码）。 */
export function readLocalChecks() {
  const r = spawnSync(process.execPath, ['scripts/verify-local.mjs', '--list', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (r.status !== 0) {
    throw new Error(`verify-local --list --json 执行失败（exit ${r.status}）：${(r.stderr ?? '').trim()}`)
  }
  const parsed = JSON.parse(r.stdout)
  return parsed.checks
}

/** 白名单允许的豁免类型：只有「本地物理上做不到」才进得来，**「本地慢」不是理由**。 */
const ALLOWED_EXEMPTION_KINDS = new Set(['ci-env', 'ci-credential', 'matrix-os', 'reporting'])

/** 从命令文本里提取它引用的**仓库内脚本**（`node scripts/<名>.mjs` 形态）。 */
export function scriptRefs(command) {
  return [...String(command).matchAll(/(?:^|[\s'"(])(scripts\/[\w./-]+\.(?:mjs|cjs|js|sh))/g)].map((m) => m[1])
}

/** 从命令文本里提取 `npm run <name>` 的 name。 */
export function npmRunRefs(command) {
  return [...String(command).matchAll(/npm run (?:--silent )?([\w:.-]+)/g)].map((m) => m[1])
}

/**
 * 「注册了但从未被调用」检测（第三类缺口）：
 * 登记表里的命令必须真的能被解析到——引用的脚本文件存在、引用的 npm script 存在。
 * 本仓库有先例：`npm audit` 曾因 registry 被重写而静默不生效；某个 eslint 检查因 ESLint 9 移除
 * `--format compact` 而实际从未运行 ——「配置里写了」不等于「真的跑了」。
 */
export function checkInvocations(packageScripts) {
  const gaps = []
  const verify = (where, command) => {
    for (const ref of scriptRefs(command)) {
      if (!existsSync(join(root, ref))) gaps.push(`[注册未调用] ${where} 引用的脚本不存在：${ref}`)
    }
    for (const name of npmRunRefs(command)) {
      if (!packageScripts.has(name)) gaps.push(`[注册未调用] ${where} 引用的 npm script 不存在：npm run ${name}`)
    }
  }
  for (const gate of GATE_REGISTRY) {
    if (gate.localCommand) verify(`gate "${gate.id}" 的 localCommand`, gate.localCommand)
    for (const decl of [gate.ci, ...(gate.ciAlso ?? [])]) {
      if (decl?.command) verify(`gate "${gate.id}" 的 CI 命令`, decl.command)
    }
  }
  return gaps
}

/**
 * 白名单校验（防滥用）：豁免项必须
 *   ① 在登记表里存在；② 理由充分（≥30 字）；③ 在 CI 侧真有执行点；
 *   ④ 类型属于「本地做不到」的四类之一；⑤ 理由里**不得**出现「慢 / 耗时 / slow」
 *      （「本地慢」是被明确拒绝的借口，见工程效率规范第十四节）。
 * 反向：verify-local 里标了「本地默认跳过」的项必须都在白名单里（否则就是静默降级）。
 */
export function checkExemptions(localChecks) {
  const gaps = []
  const exemptIds = new Set(LOCAL_EXEMPTIONS.map((e) => e.id))
  for (const e of LOCAL_EXEMPTIONS) {
    const gate = GATE_BY_ID.get(e.id)
    if (!gate) {
      gaps.push(`[白名单] 豁免项 "${e.id}" 不在登记表里`)
      continue
    }
    if (!e.reason || e.reason.length < 30)
      gaps.push(`[白名单] 豁免项 "${e.id}" 的理由不足（需 ≥30 字，说明为什么本地做不到）`)
    if (!ALLOWED_EXEMPTION_KINDS.has(e.kind)) {
      gaps.push(`[白名单] 豁免项 "${e.id}" 的类型 "${e.kind}" 非法（只认 ${[...ALLOWED_EXEMPTION_KINDS].join(' / ')}）`)
    }
    if (/慢|耗时|slow/i.test(e.reason ?? '')) {
      gaps.push(`[白名单] 豁免项 "${e.id}" 的理由提到「慢 / 耗时」——“本地慢”不是豁免理由（规范第十四节）`)
    }
    if (!gate.ci) gaps.push(`[白名单] 豁免项 "${e.id}" 在 CI 侧没有执行点，白名单无意义`)
  }
  for (const c of localChecks.filter((x) => x.optional)) {
    if (!exemptIds.has(c.id)) {
      gaps.push(`[白名单] 检查项 "${c.id}" 默认跳过但不在 LOCAL_EXEMPTIONS 里（降级必须显式 + 带理由）`)
    }
  }
  for (const id of exemptIds) {
    const c = localChecks.find((x) => x.id === id)
    if (c && !c.optional) gaps.push(`[白名单] "${id}" 在白名单里，但 verify-local 并未默认跳过它（白名单与实际不符）`)
  }
  return gaps
}

/**
 * 「CI 有、本地没有」检测：ci.yml 里每个**阻断性**步骤（非基础设施）对应的 gate，
 * 本地必须有对应检查项且默认执行（`optional` 的必须在白名单里，已由 checkExemptions 把关）。
 * 这正是 issue #330 第 5 条的形态：CI 跑 `typecheck-all.sh` 而本地只跑根 tsc → 本地绿 CI 红。
 */
export function checkCiBlockingHasLocal(workflow, localChecks) {
  const gaps = []
  const decls = ciDeclarations()
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const cmd = stepCommand(step).trim()
      if (cmd === '' || CI_INFRA_STEPS.some((re) => re.test(cmd))) continue
      // 一个步骤可能对应**多个** gate（quality job 的聚合步骤覆盖十余条规则）→ 必须逐个检查，
      // 用 find 只会看到第一条：实测漏掉过「本地删掉 typecheck-plugins 却检测不出」。
      const matched = decls.filter((d) => cmd.includes(d.command))
      if (matched.length === 0) continue // 未登记的命令已由 checkUnregisteredCiSteps 报出
      for (const decl of matched) {
        if (!localChecks.some((c) => c.id === decl.gate)) {
          gaps.push(
            `[CI 有本地无] ci.yml 的 "${job.name} / ${step.name}" 对应 gate "${decl.gate}"，但本地 verify-local 没有该检查项`,
          )
        }
      }
    }
  }
  return gaps
}

/** 对某个 registry gate 的 CI 声明做校验，返回缺口数组。 */
function checkCiDeclarations(workflow) {
  const gaps = []
  for (const decl of ciDeclarations()) {
    const job = workflow.jobs.find((j) => j.name === decl.job)
    if (!job) {
      gaps.push(`[声明≠CI] gate "${decl.gate}" 声明的 job "${decl.job}" 在 ci.yml 中不存在`)
      continue
    }
    const step = job.steps.find((s) => s.name.includes(decl.step))
    if (!step) {
      gaps.push(`[声明≠CI] gate "${decl.gate}" 声明的步骤 "${decl.job} / ${decl.step}" 在 ci.yml 中不存在`)
      continue
    }
    if (decl.command && !stepCommand(step).includes(decl.command)) {
      gaps.push(
        `[声明≠CI] gate "${decl.gate}" 声明命令 "${decl.command}"，但 ci.yml 的 "${decl.step}" 实际是 "${firstLine(stepCommand(step))}"`,
      )
    }
  }
  return gaps
}

/** 反向：ci.yml 里每个执行了命令的步骤，都必须能对应到某条已登记的规则或基础设施白名单。 */
function checkUnregisteredCiSteps(workflow) {
  const gaps = []
  const known = ciDeclarations()
    .map((d) => d.command)
    .filter(Boolean)
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const cmd = stepCommand(step).trim()
      if (cmd === '') continue
      if (CI_INFRA_STEPS.some((re) => re.test(cmd))) continue
      if (known.some((k) => cmd.includes(k))) continue
      gaps.push(
        `[CI≠声明] ci.yml 的 "${job.name} / ${step.name || '(无名步骤)'}" 执行了未登记的命令："${firstLine(cmd)}"` +
          `（要么把它登记进 scripts/lib/gate-registry.mjs，要么说明它为什么不是门禁）`,
      )
    }
  }
  return gaps
}

/**
 * 「第三方上报步骤不得判红」检测（issue #350）：
 * `CI_BEST_EFFORT_STEPS`（Coveralls 等**上报类**基础设施）必须带 `continue-on-error: true`。
 * 理由：它的失败源于第三方二进制下载/校验抖动，与本次改动无关，本地既无法预知也无法拦住
 * （规范第十四节「本地无、CI 有」的第三种漏网形态）；而覆盖率**阈值门禁**由各插件 vitest coverage
 * 承担、仍在 `npm test` 里阻断 —— 两者是两件事，不能一起放过。所以这条反向校验的作用是：
 * 谁把容错去掉，CI 立刻红（否则「上报不判红」会悄悄退化成「抖动判红」）。
 */
export function checkBestEffortInfra(workflow) {
  const gaps = []
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const cmd = stepCommand(step).trim()
      if (!CI_BEST_EFFORT_STEPS.some((re) => re.test(cmd))) continue
      if (step.continueOnError !== true) {
        gaps.push(
          `[上报不得判红] ci.yml 的 "${job.name} / ${step.name || '(无名步骤)'}" 是第三方上报步骤` +
            `（${cmd.split('@')[0]}）却没有 \`continue-on-error: true\`：它的下载/上报抖动会把整个 job 判红（issue #350）`,
        )
      }
    }
  }
  return gaps
}

/** registry ↔ verify-local 的双向校验。 */
function checkLocalDeclarations(localChecks) {
  const gaps = []
  const localById = new Map(localChecks.map((c) => [c.id, c]))
  const declared = new Map(GATE_REGISTRY.filter((g) => g.local !== null).map((g) => [g.id, g]))

  for (const [id, gate] of declared) {
    const actual = localById.get(id)
    if (!actual) {
      gaps.push(`[声明≠本地] registry 声明 gate "${id}" 有本地执行点，但 verify-local 中没有该检查项`)
      continue
    }
    if (gate.localCommand && actual.command !== gate.localCommand) {
      gaps.push(
        `[命令漂移] gate "${id}"：registry 写 "${gate.localCommand}"，verify-local 实际执行 "${actual.command}"`,
      )
    }
    const wantCiQuality = gate.ci?.job === 'quality'
    if (Boolean(actual.ciQuality) !== wantCiQuality) {
      gaps.push(
        `[范围漂移] gate "${id}"：registry 声明 ciQuality=${wantCiQuality}，verify-local 声明 ${Boolean(actual.ciQuality)}`,
      )
    }
  }
  for (const check of localChecks) {
    if (!declared.has(check.id)) {
      gaps.push(
        `[本地≠声明] verify-local 有检查项 "${check.id}"，但 registry 未登记（新增门禁必须登记，否则它可能在 CI 侧漏跑）`,
      )
    }
  }
  for (const gate of GATE_REGISTRY) {
    if (gate.local === null && !gate.ci) {
      gaps.push(`[无执行点] gate "${gate.id}" 既没有本地执行点也没有 CI 执行点（= 这条规则实际上不存在）`)
    }
  }
  return gaps
}

const firstLine = (text) => text.split('\n')[0].trim()

/** 主校验：返回缺口清单（空数组 = 一致）。 */
export function checkGateParity({ workflowText, localChecks, packageScripts }) {
  const workflow = parseWorkflow(workflowText)
  const scripts =
    packageScripts ?? new Set(Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}))
  return [
    ...checkCiDeclarations(workflow),
    ...checkUnregisteredCiSteps(workflow),
    ...checkLocalDeclarations(localChecks),
    // issue #330 + 规范第十四节的三类失败用例（本地绿 ⇒ CI 绿）：
    ...checkCiBlockingHasLocal(workflow, localChecks),
    ...checkExemptions(localChecks),
    ...checkInvocations(scripts),
    // issue #350：第三方**上报**步骤不得判红（覆盖率阈值门禁不受影响，见函数注释）
    ...checkBestEffortInfra(workflow),
  ]
}

function main() {
  const workflowText = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  let localChecks
  try {
    localChecks = readLocalChecks()
  } catch (error) {
    console.error(`[gate-parity] ❌ ${error.message}`)
    process.exit(1)
  }
  const gaps = checkGateParity({ workflowText, localChecks })

  if (asJson) {
    console.log(JSON.stringify({ ok: gaps.length === 0, gaps, gates: GATE_REGISTRY.length }, null, 2))
    process.exit(gaps.length === 0 ? 0 : 1)
  }
  if (gaps.length > 0) {
    console.error(`[gate-parity] ❌ 本地 / CI 门禁覆盖不一致：${gaps.length} 处缺口`)
    for (const gap of gaps) console.error(`  · ${gap}`)
    console.error(
      '  修法：让 scripts/lib/gate-registry.mjs、.github/workflows/ci.yml、scripts/verify-local.mjs 三者对齐。',
    )
    process.exit(1)
  }
  console.log(
    `[gate-parity] ✅ 三方一致：${GATE_REGISTRY.length} 条规则 / ${localChecks.length} 个本地检查项 / ` +
      `${ciDeclarations().length} 个 CI 执行点，缺口 0`,
  )
  process.exit(0)
}

// 被 import 时（单测）不执行主流程
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
