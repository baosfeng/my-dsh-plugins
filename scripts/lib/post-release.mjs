/**
 * post-release.mjs — 发版后校验（issue #36）：GitHub Release 创建成功 + npm 版本同步。
 *
 * 从 release.mjs 移出（控制 release.mjs 文件行数 ≤ 300）；逻辑不变：
 *   - waitForRelease：轮询 GitHub API 确认 Release 已创建（需 GH_TOKEN，未配置跳过）
 *   - waitForNpm：轮询 npm registry 确认目标版本已发布
 *
 * issue #246（发版速度）：本模块不再自己 `process.exit(1)`，改为**返回结构化结果**，
 * 由 release.mjs 决定退出码。原因：批量发版把 N 个 tag 一次性推出去之后，N 个
 * Release 的等待可以**并发**（N × ~55s → ~55s）；而并发任务里调 process.exit 会
 * 在其它等待还没结束时把进程杀掉，结果丢失、日志断裂。
 * 判定口径一字未改：GitHub Release 未创建 = 失败；npm 未发布 = 警告（issue #12）。
 */

import { execFileSync } from 'node:child_process'

/** Release 轮询上限（与原实现一致：5 分钟）。 */
export const POST_RELEASE_TIMEOUT_MS = 300000
/** 轮询间隔（与原实现一致：10s）。 */
export const POST_RELEASE_POLL_MS = 10000

/** 轮询 GitHub API 确认 Release 已创建（tag push 后 workflow 需时间跑）。 */
async function waitForRelease(tag, timeoutMs = POST_RELEASE_TIMEOUT_MS, pollMs = POST_RELEASE_POLL_MS) {
  const token = process.env.GH_TOKEN
  if (!token) return { ok: false, skipped: true }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.github.com/repos/baosfeng/my-dsh-plugins/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      },
    )
    if (res.status === 200) return { ok: true }
    if (res.status !== 404) return { ok: false, http: res.status }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return { ok: false, timeout: true }
}

/** 确认 npm 已发布目标版本（npm view <pkg> version）。 */
async function waitForNpm(pkgName, version, timeoutMs = POST_RELEASE_TIMEOUT_MS, pollMs = POST_RELEASE_POLL_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const out = execFileSync('npm', ['view', pkgName, 'version'], { encoding: 'utf8' }).trim()
      if (out === version) return { ok: true }
    } catch {
      // npm view 失败（包未发布）→ 继续轮询
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return { ok: false, timeout: true }
}

/**
 * 把一次发版后校验结果渲染成「级别 + 文案」列表（纯函数，便于单测）。
 *
 * @param {{name: string, version: string, pkgName: string}} target
 * @param {{release: object, npm: object}} result waitForRelease / waitForNpm 的结果
 * @param {number} [timeoutMs] 用于文案的轮询上限
 * @returns {{ok: boolean, lines: Array<{level: 'info'|'ok'|'warn'|'error', text: string}>}}
 */
export function summarizePostRelease(target, result, timeoutMs = POST_RELEASE_TIMEOUT_MS) {
  const { name, version, pkgName } = target
  const tag = `${name}@v${version}`
  const minutes = Math.round(timeoutMs / 60000)
  const lines = []
  let ok = true

  if (result.release?.skipped) {
    lines.push({ level: 'info', text: '- GH_TOKEN 未配置，跳过 GitHub Release 校验（发版后请手动确认）' })
  } else if (result.release?.ok) {
    lines.push({ level: 'ok', text: `✓ GitHub Release ${tag} 已创建` })
  } else {
    ok = false
    lines.push({
      level: 'error',
      text:
        `✗ GitHub Release ${tag} 未在 ${minutes} 分钟内创建（workflow 可能失败）— ` +
        '请检查 https://github.com/baosfeng/my-dsh-plugins/actions',
    })
  }

  if (result.npm?.ok) {
    lines.push({ level: 'ok', text: `✓ npm ${pkgName}@${version} 已发布` })
  } else {
    // npm 发布失败不阻断：workflow 设计为「npm 失败仅 warning，GitHub Release
    // 为主交付物」（issue #12）；实践中 npm 429 限流为暂时性问题，可稍后重试
    // （手动 npm publish 或重新触发 workflow）。GitHub Release 已成功即发版完成。
    lines.push({
      level: 'warn',
      text:
        `⚠ npm ${pkgName}@${version} 未在 ${minutes} 分钟内发布（可能是 429 限流/NPM_TOKEN 问题）— ` +
        `GitHub Release 已成功；如需 npm 发布请手动重试：cd plugins/${name} && npm publish --access public`,
    })
  }

  return { ok, lines }
}

/**
 * 发版后校验：返回 `{ ok, lines }`，**不退出进程**（退出码由调用方决定，issue #246）。
 *
 * @param {string} pkgName npm 包名
 * @param {string} name 插件目录名
 * @param {string} version 目标版本
 * @param {{timeoutMs?: number, pollMs?: number}} [options]
 * @returns {Promise<{ok: boolean, lines: Array<{level: string, text: string}>, result: object}>}
 */
export async function verifyPostRelease(pkgName, name, version, options = {}) {
  const timeoutMs = options.timeoutMs ?? POST_RELEASE_TIMEOUT_MS
  const pollMs = options.pollMs ?? POST_RELEASE_POLL_MS
  const tag = `${name}@v${version}`
  // 两个轮询互不依赖（Release 创建与 npm publish 都由同一个 workflow 促成）→ 并发，
  // 原来「先等 Release 再等 npm」在最坏情况下要 2 × 5 分钟。
  const [release, npm] = await Promise.all([
    waitForRelease(tag, timeoutMs, pollMs),
    waitForNpm(pkgName, version, timeoutMs, pollMs),
  ])
  const summary = summarizePostRelease({ name, version, pkgName }, { release, npm }, timeoutMs)
  return { ...summary, result: { release, npm } }
}
