/**
 * dsh-shared — project-root resolution（由 dsh-my-memory / dsh-my-skill-manager
 * 的 findProjectRoot 抽取合并，issue #45）。
 */

import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Find the project root for a cwd: nearest ancestor containing a `.git`
 * directory; falls back to cwd itself. Returns cwd when nothing is found.
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = cwd
  for (;;) {
    try {
      const st = await stat(join(current, '.git'))
      if (st.isDirectory()) return current
    } catch {
      // no .git here — keep walking up
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}
