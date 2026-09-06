/**
 * dsh-session-title-gen — workspace-name resolution.
 *
 * 工作区名 = 会话 cwd 的项目根 basename：findProjectRoot 向上找最近
 * .git 祖先（dsh-shared），取目录名作为归属标识（如 `[my-dsh-plugins]`）。
 */

import { basename } from 'node:path'
import { findProjectRoot } from 'dsh-shared'

/**
 * Resolve the workspace name for a session cwd.
 * @param cwd - session working directory (absolute path), or empty.
 * @returns the project-root basename, or '' when cwd is missing.
 */
export async function workspaceNameOf(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return ''
  const root = await findProjectRoot(cwd)
  return basename(root)
}
