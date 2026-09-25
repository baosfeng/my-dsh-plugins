#!/usr/bin/env node
/**
 * run-with-timeout.mjs —— 给**整条命令**加进程级硬超时（不依赖调用方，也不与调用方共享事件循环）。
 *
 * 为什么需要（缺陷形态：上限声明在错误的层级）：
 *   · vitest 的 `testTimeout` / `hookTimeout`（scripts/test/vitest.config.mjs）是**用例级软超时**：
 *     只在测试函数让出事件循环时才可能触发。本目录大量用例用 `spawnSync` 跑真实 CLI（git /
 *     node / commitlint / gitleaks / 重建 client bundle），**同步阻塞期间任何 JS 定时器都执行不了**
 *     → 声明的时间上限对该形态结构性无效；而且 vitest 超时只是把用例判失败，**并不杀进程**。
 *   · verify-local 的单步上限（scripts/verify-local.mjs 的 DEFAULT_STEP_TIMEOUT_SEC）只覆盖
 *     「经由 verify-local 调用」这一条路径：`npm run test:scripts` 直调、CI 单步调试、IDE 里跑、
 *     其他脚本里调用都**没有任何上限**。且它与被它监管的子进程**共享同一个事件循环** ——
 *     调用方一旦被同步阻塞，连这个定时器一起延后（「声明了 120s 却跑到 1023s」的形态）。
 *
 * 本包装器把上限交回「该步骤自己的权威执行点」（package.json 的 script 本身）：
 *   独立进程 + 独立事件循环 → 到点终止**整棵子进程树**（sh → vitest → tinypool workers，含孙进程），
 *   谁调用都生效、且不受调用方事件循环被阻塞的影响。
 *
 * ⚠️ 刻意**不**用 `detached: true` 给自己另立进程组：包装器必须留在调用方的进程组里，
 * 这样上层（verify-local / 宿主）按组 `SIGKILL` 时能一次带走整条链；自行另立组会让本步骤
 * 的 vitest workers 逃出那次组杀、变成孤儿继续占 CPU（正是「杀不干净」的经典形态）。
 * 因此超时时按**进程树**（pgrep 递归）自底向上终止，而不是按组。
 *
 * 用法：
 *   node scripts/run-with-timeout.mjs [--timeout <秒>] [--label <名>] -- <命令> [参数...]
 *   环境变量：RUN_TIMEOUT_SEC=<秒>（命令行 --timeout 优先；0/off/none = 显式关闭）
 * 退出码：子命令退出码原样透传；超时被杀 = 124；用法错误 = 2；命令不可执行 = 127。
 */
import { spawn, spawnSync } from 'node:child_process'

const DEFAULT_TIMEOUT_SEC = 300
const EXIT_TIMEOUT = 124
const EXIT_USAGE = 2
const EXIT_NOT_FOUND = 127

const USAGE = `用法：node scripts/run-with-timeout.mjs [选项] -- <命令> [参数...]

  --timeout <秒>   硬超时上限（默认 ${DEFAULT_TIMEOUT_SEC}；0 = 显式关闭）
  --label <名>     超时诊断里显示的步骤名（默认取命令首词）
  -h, --help       打印本帮助

环境变量 RUN_TIMEOUT_SEC=<秒> 与 --timeout 等价（命令行优先）。
到点终止**整个进程组**（含孙进程），退出码 ${EXIT_TIMEOUT}。`

/** '0' / 'off' / 'none' → 0（显式关闭）；正数 → 秒；非法 → null（调用方报用法错误，不静默退回默认）。 */
function parseSeconds(raw) {
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim().toLowerCase()
  if (text === '') return null
  if (text === '0' || text === 'off' || text === 'none') return 0
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 解析 `[选项] -- <命令...>`；`--` 必填（否则会把本包装器的选项当成子命令参数）。 */
function parseArgs(argv) {
  const sep = argv.indexOf('--')
  const head = sep === -1 ? argv : argv.slice(0, sep)
  const command = sep === -1 ? [] : argv.slice(sep + 1)
  if (head.includes('-h') || head.includes('--help')) return { help: true, command }
  if (sep === -1) return { error: '缺少 `--`：必须在它之后给出要执行的命令', command }
  if (command.length === 0) return { error: '`--` 之后没有命令', command }

  const flagValue = (name) => {
    const index = head.indexOf(name)
    return index === -1 ? undefined : head[index + 1]
  }
  const timeoutRaw = flagValue('--timeout') ?? process.env.RUN_TIMEOUT_SEC
  let timeoutSec = DEFAULT_TIMEOUT_SEC
  if (timeoutRaw !== undefined) {
    const parsed = parseSeconds(timeoutRaw)
    if (parsed === null) {
      return { error: `--timeout 值非法：${timeoutRaw}（需要正秒数，或 0 / off / none 表示关闭）`, command: [] }
    }
    timeoutSec = parsed
  }
  return { timeoutSec, label: flagValue('--label') ?? command[0], command }
}

/** 列出 pid 的全部后代（广度优先）。pgrep 不可用时退化为「只有直接子进程」。 */
function descendantPids(rootPid) {
  const found = []
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift()
    const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
    const kids = (r.stdout ?? '')
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
    found.push(...kids)
    queue.push(...kids)
  }
  return found
}

/**
 * 终止子进程及其全部后代：自底向上（先孙后子），避免父先死后子孙被 init 收养而漏杀。
 * 刻意**不**按进程组杀——包装器留在调用方的进程组里（见文件头），组杀会连调用方一起带走。
 */
function killSubtree(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return
  for (const descendant of descendantPids(pid).reverse()) {
    try {
      process.kill(descendant, signal)
    } catch {
      /* 已经退出了 */
    }
  }
  try {
    process.kill(pid, signal)
  } catch {
    /* 已经退出了 */
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }
  if (opts.error) {
    process.stderr.write(`[run-with-timeout] ${opts.error}\n\n${USAGE}\n`)
    process.exit(EXIT_USAGE)
  }

  const [cmd, ...cmdArgs] = opts.command
  const startedAt = Date.now()
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', env: process.env })
  let timer = null

  const done = (code) => {
    if (timer !== null) clearTimeout(timer)
    process.exit(code)
  }

  child.on('error', (error) => {
    process.stderr.write(`[run-with-timeout] 无法执行「${cmd}」：${error.message}\n`)
    done(EXIT_NOT_FOUND)
  })

  if (opts.timeoutSec > 0) {
    timer = setTimeout(() => {
      killSubtree(child.pid, 'SIGKILL')
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      process.stderr.write(
        `\n⏱ [run-with-timeout]「${opts.label}」超过硬上限 ${opts.timeoutSec}s（已运行 ${elapsed}s）仍未返回，` +
          `已强制终止整个进程组（含孙进程，不会留在后台继续跑）。\n` +
          `   命令：${opts.command.join(' ')}\n` +
          `   放宽上限：--timeout <秒> 或 RUN_TIMEOUT_SEC=<秒>；显式关闭：--timeout 0\n`,
      )
      done(EXIT_TIMEOUT)
    }, opts.timeoutSec * 1000)
  } else {
    process.stderr.write(
      `[run-with-timeout] ⚠ 硬超时已显式关闭（--timeout 0 / RUN_TIMEOUT_SEC=0）：此命令挂死时不会有任何东西来杀它\n`,
    )
  }

  // Ctrl-C / 被上层终止时，把信号转给整棵子树，避免留下孤儿 vitest workers 占 CPU 与 coverage 目录
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => killSubtree(child.pid, signal))
  }

  child.on('close', (code, signal) => {
    if (signal) process.stderr.write(`[run-with-timeout]「${opts.label}」被信号 ${signal} 终止\n`)
    done(code ?? 1)
  })
}

main()
