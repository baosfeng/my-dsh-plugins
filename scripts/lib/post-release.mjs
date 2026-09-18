/**
 * post-release.mjs — 发版后校验（issue #36）：GitHub Release 是否创建成功。
 *
 * 从 release.mjs 移出（控制 release.mjs 文件行数 ≤ 300）；两层分工不变：
 *   - waitForRelease：轮询 GitHub API 确认 Release 已创建（需 GH_TOKEN，未配置跳过）
 *   - summarizePostRelease：判定 + 文案（纯函数，便于单测）
 *
 * npm 发布状态**不由本地判定**（原 waitForNpm 已删）：npm publish 由
 * .github/workflows/release.yml 在 tag 触发后执行，本地只能事后查询；而本机 npm
 * 版本查询常走 npmmirror 镜像且缓存陈旧（实测本机某包显示 0.1.0、官方 registry
 * 已是 0.1.1）——既会拖满 5 分钟超时窗口，又会给出假警报：最近一次真实批量发版
 * （5 个插件）里 npm 轮询耗满 300s 超时窗口，并对两个**实际已发布成功**的包输出
 * 「未在 5 分钟内发布」。故 npm 只留一行 info 说明，不做任何 ✓/⚠ 判定——workflow
 * 侧 npm 失败本来也只 warning，不阻断 Release 这个主交付物。
 *
 * Release 判定口径一字未改：GH_TOKEN 未配置 = skipped(info)；已创建 = ok；
 * 超时/HTTP 非 404 = error（调用方 exit 1）。
 *
 * issue #246（发版速度）：本模块不再自己 `process.exit(1)`，改为**返回结构化结果**，
 * 由 release.mjs 决定退出码。原因：批量发版把 N 个 tag 一次推出去之后，N 个
 * Release 的等待可以**并发**（N × ~50s → ~50s）；而并发任务里调 process.exit 会
 * 在其它等待还没结束时把进程杀掉，结果丢失、日志断裂。
 */

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

/**
 * 把一次发版后校验结果渲染成「级别 + 文案」列表（纯函数，便于单测）。
 *
 * npm 只输出一行 info（见文件头：本地判定 npm 既慢又不准）；result 里多余的 npm
 * 字段被忽略，历史调用方传进来也不会改变判定。
 *
 * @param {{name: string, version: string, pkgName: string}} target
 * @param {{release: object}} result waitForRelease 的结果
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

  lines.push({
    level: 'info',
    text:
      `- npm 发布由 GitHub Actions 负责（tag 触发 release.yml；需 NPM_TOKEN），本地不再轮询确认：` +
      `https://www.npmjs.com/package/${pkgName}`,
  })

  return { ok, lines }
}

/**
 * 发版后校验：返回 `{ ok, lines }`，**不退出进程**（退出码由调用方决定，issue #246）。
 * 只等 GitHub Release——npm 发布状态不由本地判定（见文件头），不再为它占用超时窗口。
 *
 * @param {string} pkgName npm 包名（仅用于 info 文案里的 npm 页面链接）
 * @param {string} name 插件目录名
 * @param {string} version 目标版本
 * @param {{timeoutMs?: number, pollMs?: number}} [options]
 * @returns {Promise<{ok: boolean, lines: Array<{level: string, text: string}>, result: object}>}
 */
export async function verifyPostRelease(pkgName, name, version, options = {}) {
  const timeoutMs = options.timeoutMs ?? POST_RELEASE_TIMEOUT_MS
  const pollMs = options.pollMs ?? POST_RELEASE_POLL_MS
  const tag = `${name}@v${version}`
  const release = await waitForRelease(tag, timeoutMs, pollMs)
  const summary = summarizePostRelease({ name, version, pkgName }, { release }, timeoutMs)
  return { ...summary, result: { release } }
}
