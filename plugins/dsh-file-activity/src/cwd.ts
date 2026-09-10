import type { DshContext } from './types.js'

/**
 * dsh-file-activity — session working-directory resolution.
 *
 * 从 http.js 拆出（issue #45：http.js 的 JSON 工具已抽到 dsh-shared，
 * sessionCwdOf 为 file-activity 特有，保留本地）。
 */

/** Session working directory, mirroring better-sidebar's resolution. */
export function sessionCwdOf(ctx: DshContext, sessionId: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header?.cwd
  if (typeof headerCwd === 'string' && headerCwd !== '') return headerCwd
  return process.cwd()
}
