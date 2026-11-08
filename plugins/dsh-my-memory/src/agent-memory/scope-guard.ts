/**
 * dsh-my-memory — agent 记忆的**作用域与护栏**（从 tools.ts 拆出：400 行门禁）。
 *
 * 两件事都属于「写到哪里」：
 *  - `projects/current/…` 别名解析成当前项目的真实前缀（项目 id 是宿主按
 *    项目根算的 hash，agent 无从得知也不该背）；
 *  - 全局层写入护栏：含项目专属标识的条目不许进 user.md / feedback.md。
 *
 * 从 tools.ts 拆出的理由只有行数：两者都不依赖工具注册，也不碰 store。
 */
import { basename } from 'node:path'

/** 会话 cwd（用于拼项目作用域路径）。 */
export function cwdOf(exec: unknown): string {
  const agent = (exec as { agent?: { session?: { header?: { cwd?: string } } } } | undefined)?.agent
  return agent?.session?.header?.cwd ?? ''
}

/** 项目作用域的别名前缀：agent 不必知道项目 id（宿主按项目根 hash 生成）。 */
const CURRENT_PROJECT = 'projects/current/'

/**
 * 把 `projects/current/…` 解析为当前项目的真实前缀，其余名字原样返回。
 *
 * 项目 id 是宿主按项目根算出来的 hash，agent 无从得知也不该背——它只写
 * 「当前项目」，解析交给系统。list 返回的仍是真实路径，两者指向同一文件。
 */
export async function resolveAlias(
  rawName: unknown,
  exec: unknown,
  resolveProjectPrefix: (cwd: string) => Promise<string>,
): Promise<unknown> {
  if (typeof rawName !== 'string') return rawName
  const cleaned = rawName.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!cleaned.startsWith(CURRENT_PROJECT)) return rawName
  const prefix = await resolveProjectPrefix(cwdOf(exec))
  return prefix + cleaned.slice(CURRENT_PROJECT.length)
}

/** 全局层文件（agent 可写，但要过「通用性」护栏）。 */
const GLOBAL_FILES: ReadonlySet<string> = new Set(['user.md', 'feedback.md', 'MEMORY.md'])

/** 项目专属标识：带扩展名的仓库内路径、本机地址、端口。 */
const PROJECT_MARKERS: readonly RegExp[] = Object.freeze([
  /\bscripts\/[\w.-]+/, // scripts/debug-cli.sh
  /\bsrc\/[\w-]+\/[\w.-]+/, // src/client/foo.ts
  /\bapps\/[\w-]+\/[\w.-]+/, // apps/web/src/x.ts
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // 124.222.x.x
  /\blocalhost:\d{2,5}\b/, // localhost:3080
])

/**
 * 全局层写入护栏：**含项目专属标识的条目不许进全局**。
 *
 * 这是确定性规则、不是模型判断：一条「走 scripts/debug-cli.sh」写进全局，
 * 就会在每个项目里误导 agent（真实事故就是这么发生的）。判据只认「这条
 * 内容里有没有指向某个具体仓库的东西」，命中就要求改写进项目层——误判的
 * 代价是 agent 改写一次，漏判的代价是全局污染，两者不对称。
 *
 * @returns null 表示放行；否则返回给 agent 的可操作提示。
 */
export function globalScopeReject(name: unknown, content: unknown, cwd: string): string | null {
  if (typeof name !== 'string' || !GLOBAL_FILES.has(name)) return null
  if (typeof content !== 'string') return null
  const repo = cwd === '' ? '' : basename(cwd)
  const haystack = content
  const hit = PROJECT_MARKERS.find((pattern) => pattern.test(haystack))
  if (hit !== undefined) {
    return '这条含项目专属标识（路径 / 地址 / 端口），请写 projects/current/…；全局层只放跨项目通用的能力'
  }
  if (repo.length >= 4 && haystack.includes(repo)) {
    return `这条点名了当前仓库（${repo}），请写 projects/current/…；只有换个项目仍成立的内容才进全局`
  }
  return null
}
