/**
 * npm `repository` 字段里的 GitHub 仓库解析（升级审计 materialize-npm.mjs 用）。
 *
 * 为什么单独成模块：host 判定在这里是**安全判据**（判定通过就真去请求 api.github.com），
 * 必须能被单测直接覆盖（scripts/test/github-repo.test.mjs）。宿主脚本 materialize-npm.mjs
 * 顶层直接执行 npm view/install，import 它就产生副作用，不适合当测试宿主。
 *
 * 为什么必须解析 URL 而不是 includes('github.com')（CodeQL
 * js/incomplete-url-substring-sanitization）：子串判定会把
 * `https://evil.example/github.com/deepseek-ai/dsh` 当成 GitHub 仓库——它的 host 是
 * evil.example，"github.com" 只是路径的一段；判据必须落在解析后的 hostname 上。
 */

/**
 * 解析 repository 值。仅当 host 恰为 `github.com`、且路径恰为 `/<owner>/<repo>` 时返回
 * `{ owner, repo }`；其余（非 GitHub / 无法解析 / 路径段数不符）一律 null，调用方据此跳过
 * GitHub enrichment。
 *
 * 支持的形态（npm 上实际出现的写法）：`https://github.com/o/r`、`git+https://…`、
 * `git://…`、`ssh://git@github.com/o/r`、scp 式 `git@github.com:o/r`、无 scheme 的
 * `github.com/o/r`，尾部 `.git` 一律忽略。
 */
export function parseGithubRepo(repository) {
  const raw = typeof repository === 'string' ? repository.trim() : ''
  if (!raw) return null
  // scp 式 git@host:path 与无 scheme 的 host/path 都要先补成可解析的 URL。
  const normalized = /^[\w.-]+\//.test(raw) ? `https://${raw}` : raw.replace(/^git@([^/:]+):/, 'ssh://git@$1/')
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') return null
  const match = parsed.pathname.replace(/\.git$/i, '').match(/^\/([^/]+)\/([^/]+)$/)
  return match ? { owner: match[1], repo: match[2] } : null
}
