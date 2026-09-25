/**
 * 测试临时目录兜底清扫（vitest globalSetup）—— **有界**策略。
 *
 * 为什么需要它：本仓测试用 `tmp.dirSync({ unsafeCleanup: true })` 创建大量临时
 * DSH_HOME，清理只依赖进程正常退出（tmp 包的 process-exit 钩子）与测试内的
 * afterAll / cucumber After。一旦 worker 被强杀（vitest 超时、CI 取消、SIGKILL），
 * 钩子不执行，目录**永久残留且无人回收** —— 静态分析原理上无法防止这类残留。
 * 实测：系统 tmpdir 曾累积 10136 个本仓残留 / 125.6 MB。
 *
 * 本清扫器在**每次 vitest 运行开始时**回收「上一轮遗留的陈旧残留」：
 *  - **有界**：只清 mtime 早于 TTL（默认 24h）的目录，且单次最多清 maxSweep 个；
 *  - **不越权**：只碰 OWNED_PREFIXES 白名单内的前缀，宿主目录（dsh-spill-* 等）不碰；
 *  - **保留现场**：TTL 内的近期残留**故意保留**，供排障时查看；
 *  - **fail-closed**：读取/删除失败只记录并告警，**绝不阻塞测试**。
 */
import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 保留窗口：只清扫 24h 前的残留，近期现场留给人看。 */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
/** 单次清扫硬上限（防止误配白名单时一次性删爆）。 */
export const MAX_SWEEP = 5000

/** 本仓测试创建的临时目录前缀白名单（精确前缀，非本仓一律不碰）。 */
export const OWNED_PREFIXES = [
  'dsh-guard-feature-home-',
  'dsh-guard-feature-pkg-',
  'dsh-guard-test-',
  'dsh-guard-mut2-',
  'dsh-guard-mut2-tar-',
  'dsh-obs-feature-home-',
  'dsh-obs-review-',
  'dsh-obs-mut-',
  'dsh-obs-feature-',
  'dsh-observability-test-',
  'dsh-task-reliability-rescue-',
  'dsh-task-reliability-',
  'dsh-task-rel-mut-',
  'dsh-shared-',
  'dsh-resource-smoke-',
  'dsh-my-guardian-test-',
  'dsh-my-guardian-boot-',
  'dsh-my-guardian-startup-',
  'dsh-file-activity-test-',
  'dsh-verify-real-',
  'dsh-my-remote-guard-',
  'dsh-my-remote-suite-',
  'dsh-mermaid-render-api-',
  'dsh-my-notify-webhook-',
  'dpm-api-test-',
  'dpm-feature-',
  'ts-size-',
  'approve-step-',
  // scripts/verify-local.mjs 单步用的隔离 TMPDIR（verify-isolated-tmp-*）。实测该前缀残留 3 次
  // （Sep 18 / Sep 19 / Sep 25，后者正是被孤儿进程持有的 BjA8ox）；此前不在白名单 →
  // 兜底清扫**结构性扫不到**（连 scanned 都不计），是本清扫最实质的盲区。
  'verify-isolated-tmp-',
]

const isOwned = (name, prefixes) => prefixes.some((p) => name.startsWith(p) && name.length > p.length)

/**
 * 清扫陈旧的本仓测试残留目录（纯函数，dir/now 可注入以便确定性测试）。
 * @returns {{scanned:number, removed:number, kept:number, bounded:boolean, errors:string[]}}
 */
export function sweepStaleTempDirs({
  dir = tmpdir(),
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  prefixes = OWNED_PREFIXES,
  maxSweep = MAX_SWEEP,
  log = () => {},
} = {}) {
  const result = { scanned: 0, removed: 0, kept: 0, bounded: false, errors: [] }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    result.errors.push(`无法读取 ${dir}: ${error.message}`)
    return result
  }
  const cutoff = now - ttlMs
  for (const entry of entries) {
    if (!entry.isDirectory() || !isOwned(entry.name, prefixes)) continue
    if (result.removed >= maxSweep) {
      result.bounded = true
      log(`已达单次上限 ${maxSweep}，本轮停止清扫（剩余留待下次运行）`)
      break
    }
    const full = join(dir, entry.name)
    let stats
    try {
      stats = statSync(full)
    } catch (error) {
      result.errors.push(`${entry.name}: ${error.message}`)
      continue
    }
    result.scanned += 1
    if (stats.mtimeMs >= cutoff) {
      result.kept += 1
      continue
    }
    try {
      rmSync(full, { recursive: true, force: true })
      result.removed += 1
    } catch (error) {
      result.errors.push(`${entry.name}: ${error.message}`)
    }
  }
  return result
}

/** vitest globalSetup 入口：每次运行开始时清扫上一轮遗留的陈旧残留。 */
export default function setup() {
  try {
    const log = (m) => console.log(`[tmp-residue-sweep] ${m}`)
    const r = sweepStaleTempDirs({ log })
    log(
      `清扫完成 removed=${r.removed} kept_近期保留=${r.kept} scanned=${r.scanned} bounded=${r.bounded} errors=${r.errors.length}`,
    )
    for (const e of r.errors) console.warn(`[tmp-residue-sweep] 清理失败（不阻塞测试）: ${e}`)
  } catch (error) {
    // fail-closed：清扫本身绝不能成为测试失败的原因。
    console.warn(`[tmp-residue-sweep] 清扫异常，已忽略（不阻塞测试）: ${error.message}`)
  }
}
