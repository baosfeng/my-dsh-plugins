/**
 * dsh-my-plugin-manager — manage.ts: spawn the `dsh plugin` CLI for install /
 * uninstall / outdated, and read installed versions from the profile dir.
 *
 * The panel edits the same files `dsh plugin` manages (profile package.json +
 * cordis.patch.yml via the bundle patch), so the CLI is the single source of
 * truth — no hand-editing of patch files. New plugins load on the next DSH
 * restart (candidate-area hot mount remains the guardian plugin's job).
 */
import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

export function pluginArgs(profile: string, command: string, target: string): string[] {
  return ['plugin', '--profile', profile, command, target]
}

/** Install a plugin (npm name or link:/path). */
export function installPlugin(profile: string, source: string): Promise<DshResult> {
  return runDsh(pluginArgs(profile, 'add', source))
}

/** Remove an installed package. */
export function uninstallPlugin(profile: string, name: string): Promise<DshResult> {
  return runDsh(pluginArgs(profile, 'remove', name))
}

/** pnpm outdated --json: { "<pkg>": { current, latest, ... } } or empty {} . */
export async function outdatedPlugins(profile: string): Promise<OutdatedResult> {
  const result = await runDsh(['plugin', '--profile', profile, 'outdated', '--json'])
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

/** Installed version of a package in the profile dir ('' when unknown). */
export function installedVersionOf(profileDir: string, moduleName: string): string {
  try {
    const scope = moduleName.startsWith('@') ? moduleName.split('/')[0] : null
    const base = scope
      ? join(profileDir, 'node_modules', scope, moduleName.slice(scope.length + 1))
      : join(profileDir, 'node_modules', moduleName)
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : ''
  } catch {
    return ''
  }
}
