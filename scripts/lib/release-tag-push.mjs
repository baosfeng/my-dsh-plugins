/**
 * release-tag-push.mjs — tag 推送策略与触发确认（issue #375-#380 根因修复）。
 *
 * ## 症状（实测）
 *
 * 批量发版把 tag 推上去之后，GitHub Actions **一个 run 都不触发**：远端 tag 齐全、
 * 本地脚本报成功，CI 侧却零 run；只能人工逐个「删远端 tag → 重推」才开始跑。
 * 2026-09-17「批量发版 14 个插件」全流程实测：
 *
 *   · release commit 16:14:45Z —— tag 推完
 *   · 第一个 run 18:27:42Z —— **2h12m57s 完全空白**（零触发）
 *   · 收尾 20:58:24Z —— 从推 tag 到全部完成 4h43m39s，大头是人工逐个重推的等待
 *
 * ## 根因
 *
 * 一次 `git push origin t1 t2 … tN` 带多个 tag ref 时，GitHub 侧对这批 ref 的 push
 * 事件会合并/丢弃——**一次 push 只应当承载一个 ref**。逐个推，每个 tag 都拿到独立的
 * push 事件，才会各自触发 workflow。
 *
 * ## 修法（本模块）
 *
 *   1. `pushTagsIndividually`：逐个推（一次网络往返 → 一个 ref），保序、失败即停；
 *   2. `confirmTagTriggered`：推完逐个轮询 GitHub API「该 tag 下有没有 run」，把
 *      **静默零触发**变成显式可见——没触发就不必再干等 post-release 的 5 分钟超时；
 *   3. `retriggerHint`：确认不到时给出的补救命令（人工确认后执行）。
 *
 * **绝不自动删远端 tag**：删除 ref 是破坏性外发动作，只提示、不代做（fail-closed）。
 * 本模块只返回结果，不 exit、不决定放行/阻断——判定权留在调用方。
 */

/** 默认仓库（与 .github/workflows/release.yml 的 push 目标一致）。 */
export const RELEASE_REPO = 'baosfeng/my-dsh-plugins'
/** 单 tag 触发确认的默认上限与间隔（tag 推送到 run 可见通常 < 5s）。 */
export const TRIGGER_CONFIRM_TIMEOUT_MS = 90_000
export const TRIGGER_CONFIRM_POLL_MS = 5_000

/**
 * 单个 tag 的 git push 参数：**一次只推一个 ref**（正确做法）。
 * @param {string} tag
 * @returns {string[]}
 */
export function tagPushArgv(tag) {
  return ['push', 'origin', tag]
}

/**
 * 一次推多个 ref 的参数（**反模式**：会零触发）。
 * 保留导出，让单测把「不许回退成一次推 N 个」钉死（scripts/test/release-tag-push.test.mjs）。
 * @param {string[]} tags
 * @returns {string[]}
 */
export function bulkTagPushArgv(tags) {
  return ['push', 'origin', ...tags]
}

/**
 * 逐个推送 tag：保序执行，任一失败即停（后续 tag 不再推，由调用方 fail-closed 处理）。
 *
 * @param {Array<{tag: string}>} targets
 * @param {(argv: string[]) => Promise<{code?: number}>} runGit 注入的 git 执行器（便于单测）
 * @param {(line: string) => void} [log]
 * @returns {Promise<{ok: boolean, results: Array<{tag: string, code: number}>, failedTag: string|null}>}
 */
export async function pushTagsIndividually(targets, runGit, log = () => {}) {
  const results = []
  for (const target of targets) {
    const result = await runGit(tagPushArgv(target.tag))
    const code = typeof result?.code === 'number' ? result.code : 1
    results.push({ tag: target.tag, code })
    if (code !== 0) return { ok: false, results, failedTag: target.tag }
    log(`✓ tag ${target.tag} pushed → origin（单 ref push：独立 push 事件 → 该 tag 的 workflow 触发）`)
  }
  return { ok: true, results, failedTag: null }
}

/**
 * GitHub API：查该 tag（tag push 的 run 里 head_branch = tag 名）下是否已有 workflow run。
 * @param {string} tag
 * @param {string} [repo]
 * @returns {string}
 */
export function tagRunsUrl(tag, repo = RELEASE_REPO) {
  return `https://api.github.com/repos/${repo}/actions/runs?head_branch=${encodeURIComponent(tag)}&per_page=1`
}

/**
 * 响应 → 触发判定（纯函数）。
 *
 * 三态，避免把「查不到」当成「没触发」下否定结论：
 *   · 200 + total_count>0 → `{ known: true, created: true }`
 *   · 200 + total_count=0 → `{ known: true, created: false }`（等满超时即为「确实没触发」）
 *   · 非 200（401/403 限流等）→ `{ known: false, created: false }`（**无法判定**，不得据此判红）
 *
 * @param {number} status
 * @param {unknown} payload
 * @returns {{known: boolean, created: boolean}}
 */
export function readTriggeredFromResponse(status, payload) {
  if (status !== 200) return { known: false, created: false }
  const total =
    typeof payload?.total_count === 'number'
      ? payload.total_count
      : Array.isArray(payload?.workflow_runs)
        ? payload.workflow_runs.length
        : 0
  return { known: true, created: total > 0 }
}

/**
 * 确认单个 tag 是否触发了 workflow run。
 *
 * status 语义：
 *   · `created`  —— 已触发（有 run）
 *   · `pending`  —— 查得到、但等满超时仍无 run（强证据：**确实没触发**）
 *   · `unknown`  —— 无法判定（非 200，如限流/未授权）——调用方不得据此判失败
 *   · `skipped`  —— 未配置 GH_TOKEN，跳过（保持既有「无 token 不判红」语义）
 *
 * @param {string} tag
 * @param {{token?: string, fetchImpl?: typeof fetch, timeoutMs?: number, pollMs?: number, repo?: string}} [options]
 */
export async function confirmTagTriggered(tag, options = {}) {
  const token = options.token ?? process.env.GH_TOKEN
  if (!token) return { tag, status: 'skipped', reason: 'GH_TOKEN 未配置——跳过触发确认（无法确认 ≠ 没触发）' }
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? TRIGGER_CONFIRM_TIMEOUT_MS
  const pollMs = options.pollMs ?? TRIGGER_CONFIRM_POLL_MS
  const url = tagRunsUrl(tag, options.repo)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    })
    const verdict = readTriggeredFromResponse(res.status, await res.json().catch(() => null))
    if (verdict.created) return { tag, status: 'created' }
    if (!verdict.known) return { tag, status: 'unknown', http: res.status }
    if (Date.now() >= deadline) return { tag, status: 'pending' }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/**
 * 触发确认失败时的补救命令（**人工确认后执行**；脚本绝不自动删远端 tag）。
 * @param {string} tag
 * @returns {string[]}
 */
export function retriggerHint(tag) {
  return [
    `${tag} 未确认到 workflow run —— GitHub 可能合并/丢弃了这次 tag push 的事件`,
    '  补救（破坏性：删远端 tag 后重推同一 commit；先确认 tag 指向当前 HEAD 再执行）：',
    `    git push --delete origin '${tag}'`,
    `    git push origin '${tag}'`,
  ]
}
