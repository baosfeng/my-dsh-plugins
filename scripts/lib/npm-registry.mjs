/**
 * npm-registry.mjs — 发版门禁 1a/1c 的 npm 查询件（issue #386）。
 *
 * 为什么必须钉官方源：本机 npm 配置常指向 npmmirror 等镜像 + 缓存，而镜像的**否定性结论
 * 不等于 registry 事实**——实测官方已是 0.1.1 的包本机读成 0.1.0；刚发布的依赖镜像未同步时
 * 直接 404。旧实现把这些结论当事实用，于是同一条根因产生两类错误判定：
 *   · 1a 查询失败（非 404，如镜像超时/限流）→ `return { ok: true }` 静默放行 = **假绿**
 *     （防降级检查失效，latest 可能回退到更低版本）；
 *   · 1c 镜像 404 → 判定「从未发布」硬阻断 = **假红**（先发依赖、随即发依赖方的顺序发版被挡）。
 * CI 环境无镜像配置，本地结论与 CI 结论因此分叉；门禁必须基于 registry 事实。
 *
 * 本模块只做「参数/环境构造 + 判定」，网络副作用由注入的 exec（release.mjs 的 runChild）执行，
 * 因此可单测（测试用假 npm 可执行文件验证参数与环境真的到达子进程）。
 *
 * ⚠️ 只写 `--registry=<官方源>` 不够保险：npm 的 `replace-registry-host=npmjs` 默认值可能把
 * 官方源**反向重写**回本机镜像（npm-audit 门禁的实测教训，见 lib/npm-audit.mjs 文件头与
 * docs/踩坑/）。故 CLI 参数 + 环境变量双保险；`npm_config_*` 优先级高于用户 ~/.npmrc，
 * 不需要使用者改本机配置。
 */

import { isNpmNotFound, rangeMin, versionGte } from './release-checks.mjs'
import { mapWithConcurrency } from './release-concurrency.mjs'

/** 门禁查询的唯一权威源：官方 registry（镜像缓存/同步延迟不得参与放行判定）。 */
export const NPM_OFFICIAL_REGISTRY = 'https://registry.npmjs.org'

/** 查询失败的额外尝试次数：1a 失败即阻断，一次重试避免网络抖动变成假红。 */
const VIEW_ATTEMPTS = 2

/**
 * 注入给 npm 子进程的 npm 配置（env 优先级高于用户 ~/.npmrc）。
 * `replace_registry_host=never` 不可省：否则 npm 会按本机镜像把官方源重写回去。
 */
export function npmRegistryEnv() {
  return {
    npm_config_registry: NPM_OFFICIAL_REGISTRY,
    npm_config_replace_registry_host: 'never',
  }
}

/** 构造一次 npm view 调用（参数 + 环境），调用方负责 spawn。 */
export function npmViewInvocation(target, field) {
  return {
    argv: ['view', target, field, `--registry=${NPM_OFFICIAL_REGISTRY}`],
    env: npmRegistryEnv(),
  }
}

/** 子进程失败的简短归因（取 stderr 首行，没有则取 stdout 首行）。 */
export const failureLine = (result) => String(result.stderr || result.stdout || '').split('\n')[0]

/**
 * 1a. 语义 gate（plugin-release 增量）：stable 版本发布前查 npm latest 防降级。
 * 当前版本低于 npm latest 时拒绝发布（防止 latest 回退）；首次发布（404）跳过。
 *
 * issue #386：查询异常是**否定性结论**——「不知道 latest 是多少」≠「没有降级」，
 * 旧实现静默放行（假绿）。现在 fail-closed：重试后仍失败即拒绝发布（消息含归因与官方源，
 * 便于区分「网络问题」与「真的降级」）。这是本门禁唯一的硬阻断新增路径，且只在
 * 官方源查询异常时触发。
 *
 * @param {{exec: Function, name: string, pkgName: string, version: string, say: Function, attempts?: number}} deps
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export async function npmLatestGate({ exec, name, pkgName, version, say, attempts = VIEW_ATTEMPTS }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { ok: true }
  const { argv, env } = npmViewInvocation(pkgName, 'dist-tags.latest')
  let result
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await exec('npm', argv, { quiet: true, env })
    if (result.code === 0) break
    // 404 = 从未发布（首次发布），重试不会有别的结论
    if (isNpmNotFound(result.stderr)) break
    if (attempt < attempts) {
      say(`- npm latest 查询失败（${failureLine(result)}）— 重试（官方源 ${NPM_OFFICIAL_REGISTRY}）`)
    }
  }
  if (result.code === 0) {
    const latest = result.stdout.trim().split('\n').pop()
    if (latest && !versionGte(version, latest)) {
      return {
        ok: false,
        message: `${name} 版本 ${version} 低于 npm latest ${latest} — 拒绝发布（防止 latest 回退，plugin-release 语义 gate）`,
      }
    }
    say(`✓ npm latest ${latest} ≤ 当前版本 ${version}（无降级）`)
    return { ok: true }
  }
  if (isNpmNotFound(result.stderr)) {
    say(`- ${pkgName} 尚未发布到 npm（首次发布，跳过 latest 防降级检查）`)
    return { ok: true }
  }
  return {
    ok: false,
    message:
      `npm latest 查询失败（${failureLine(result)}）— 拒绝发布：无法判定是否降级` +
      `（官方源 ${NPM_OFFICIAL_REGISTRY}，已尝试 ${attempts} 次；确认网络后重跑）`,
  }
}

/**
 * 1c 依赖发布状态预热：把仓库内依赖的 `npm view` 并发跑完，再交给纯函数
 * `findUnpublishedDeps` 做同步判定——判定规则一字未改，只是把原来「每个依赖
 * 一次同步 execFileSync」（实测单次 0.3–2.5s）并发化，并把查询钉在官方源
 * （issue #386：镜像未同步新发布的依赖会返回 404，被误判成「从未发布」= 假红）。
 *
 * @param {Function} exec `(cmd, argv, options) => Promise<{code, stdout, stderr}>`
 * @param {string[]} deps
 * @param {number} concurrency
 * @returns {Promise<Map<string, {version: string, notFound: boolean}>>}
 */
export async function prefetchNpmVersions(exec, deps, concurrency) {
  const settled = await mapWithConcurrency(deps, concurrency, async (dep) => {
    const { argv, env } = npmViewInvocation(dep, 'version')
    const result = await exec('npm', argv, { quiet: true, env })
    if (result.code === 0)
      return [
        dep,
        {
          version: result.stdout.trim().split('\n').pop() ?? '',
          notFound: false,
        },
      ]
    return [dep, { version: '', notFound: isNpmNotFound(result.stderr) }]
  })
  const map = new Map()
  for (const item of settled) {
    if (item.status === 'fulfilled') map.set(item.value[0], item.value[1])
  }
  return map
}

/**
 * 1c 判定规则（原 release.mjs 内联闭包，为可测性抽出；规则一字未改，issue #39/#72/#294）：
 *   · 预热缺失 / 声明范围无下限 → 不放行；
 *   · npm view 成功：版本满足范围即放行；
 *   · 官方 404（真的从未发布）→ 必须阻断（依赖方安装/运行必然失败，issue #72）；
 *   · 429 限流等临时错误：仓库内依赖以「已打 tag」兜底（tag push 必触发 Release workflow，
 *     GitHub Release 是仓库主交付物，issue #12）；但 library 依赖（运行时 import）必须
 *     确认 npm 发布成功才放行，不允许 tag 兜底（issue #72）。
 *
 * @param {{npmVersions: Map<string, {version: string, notFound: boolean}>, pluginIndex: Map<string, {dir: string, version: string}>, isTagged: Function, isLibraryDep: Function}} deps
 * @returns {(dep: string, range: string) => boolean}
 */
export function createIsPublished({ npmVersions, pluginIndex, isTagged, isLibraryDep }) {
  return (dep, range) => {
    const min = rangeMin(range)
    if (!min) return false
    const cached = npmVersions.get(dep)
    if (cached === undefined) return false
    // npm view 成功：版本满足范围即通过
    if (!cached.notFound && cached.version) return versionGte(cached.version, min)
    // 404（npm 从未发布）→ 必须阻断：依赖方安装/运行必然失败（issue #72）。
    if (cached.notFound) return false
    // 429 限流等临时错误：仓库内依赖（pluginIndex）认可「已打 tag」——
    // tag push 必触发 Release workflow，GitHub Release 为仓库主交付物（issue #12）；
    // npm 发布失败不阻塞依赖顺序校验（发布后可手动重试）。
    const entry = pluginIndex.get(dep)
    if (entry !== undefined && isTagged(entry.dir, entry.version)) {
      // 但 library 依赖（dsh.kind=library）是运行时 import 的共享工具包：
      // npm 未发布 = 依赖方安装失败，必须确认 npm 发布成功才放行（issue #72）。
      if (isLibraryDep(entry.dir)) return false
      return true
    }
    return false
  }
}
