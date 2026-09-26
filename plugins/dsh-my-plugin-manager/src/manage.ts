/**
 * dsh-my-plugin-manager — manage.ts: `dsh plugin` CLI for the update check.
 *
 * 唯一保留的 CLI 用法是更新检查（`dsh plugin --profile <p> outdated --json`）——
 * 官方插件管理没有 outdated / latest 面，这是本插件的真增量之一。安装 / 卸载 /
 * 启停已随 UI 一并下线：官方侧边栏插件页与 `dsh plugin add|remove` 是唯一入口。
 */
import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'

/** `dsh plugin` CLI 执行结果（spawn 失败时 code = -1，close 无 code 时为 null）。 */
export interface DshResult {
  /** 退出码为 0 时为 true。 */
  ok: boolean
  /** 退出码（spawn 失败 -1，被信号终止 null）。 */
  code: number | null
  stdout: string
  stderr: string
  /** spawn 级错误消息（仅 spawn 失败时存在）。 */
  error?: string
}

/** 一条可更新记录（pnpm outdated 的 current/latest 对）。 */
export interface OutdatedEntry {
  name: string
  current: string
  latest: string
}

/** 更新检查结果：成功带 outdated 列表，失败带错误文本。 */
export type OutdatedResult = { ok: true; outdated: OutdatedEntry[] } | { ok: false; error: string }

/** Run `dsh plugin --profile <profile> <args...>` and collect output. */
export function runDsh(args: string[], options: SpawnOptions = {}): Promise<DshResult> {
  return new Promise((resolve) => {
    const child = spawn('dsh', args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr!.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) =>
      resolve({ ok: false, code: -1, stdout, stderr, error: String(error?.message ?? error) }),
    )
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }))
  })
}

/** `dsh plugin --profile <profile> <command> <target>` 参数表。 */
export function pluginArgs(profile: string, command: string, target: string): string[] {
  return ['plugin', '--profile', profile, command, target]
}

/** pnpm outdated --json: { "<pkg>": { current, latest, ... } } or empty {} . */
export async function outdatedPlugins(profile: string): Promise<OutdatedResult> {
  const result = await runDsh(pluginArgs(profile, 'outdated', '--json'))
  if (!result.ok)
    return {
      ok: false,
      error: result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`,
    }
  try {
    const parsed = JSON.parse(result.stdout.trim() || '{}')
    // pnpm outdated --json 的每项形状：{ current, latest, ... }（逐字段兜底）。
    const entries = Object.entries(parsed as Record<string, { current?: unknown; latest?: unknown }>)
    return {
      ok: true,
      outdated: entries.map(([name, info]) => ({
        name,
        current: typeof info.current === 'string' ? info.current : '',
        latest: typeof info.latest === 'string' ? info.latest : '',
      })),
    }
  } catch {
    return { ok: false, error: 'outdated output was not JSON' }
  }
}
