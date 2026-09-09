/**
 * dsh-shared — project-root resolution（由 dsh-my-memory / dsh-my-skill-manager
 * 的 findProjectRoot 抽取合并，issue #45）。
 */
/**
 * Find the project root for a cwd: nearest ancestor containing a `.git`
 * directory; falls back to cwd itself. Returns cwd when nothing is found.
 */
export declare function findProjectRoot(cwd: string): Promise<string>
