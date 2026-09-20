/**
 * 两个已发布版本 → manifest-diff.txt 文本（materialize-npm.mjs 用）。
 *
 * 为什么单独成模块：宿主机脚本 materialize-npm.mjs 顶层直接跑 npm view/install，
 * import 它就产生副作用，不适合当测试宿主（与 ./commit-lines.mjs、./github-repo.mjs 同样的理由）。
 *
 * 为什么需要净化（issue #388）：本文件的每个字段都来自不可信来源——版本头来自
 * `npm view --json` 的响应，包名与 manifest 字段来自下载包的 package.json。同脚本的
 * commits.txt / reverts.txt 早已走 ./commit-lines.mjs 的 scrubField，而这条路径曾是原样拼接，
 * 于是同一个脚本出现两套净化口径。分叉的成因是**数据取得方式**不同（fetch vs execFileSync）：
 * CodeQL js/http-to-file-access 只追踪 fetch，未追踪 execFileSync 的 npm CLI 响应，
 * 所以这条路径当时没被一并处置。判据不是"扫描报不报"，而是"产物里的字段可不可信"——
 * 因此这里与 commit-lines 共用同一个 scrubField，不再另起一套实现。
 *
 * 净化范围与理由（与 commit-lines 一致）：换行类字符（含 U+2028/U+2029）折成空格，
 * 其余 C0/C1 控制字符、DEL 与双向控制符删除，再按上限截断——杜绝伪造行、终端转义
 * 序列注入与 Trojan Source 类显示欺骗。
 */

import { scrubField } from './commit-lines.mjs'

/**
 * 单个 manifest 字段值的上限。
 *
 * 取值理由：manifest 字段经 JSON.stringify 后是**结构化数据**（dependencies/exports 等
 * 对象可以合法地很长），日常 dsh 闭包远小于此值，因此正常产物逐字不变；只有异常/恶意
 * 包（字段被塞到几十 KB）才会被截断。取值比 commit 的 200 字符宽，正是为了不损失
 * 「人工阅读 + 密度对比」需要的信息。
 */
export const MAX_MANIFEST_FIELD_CHARS = 4000

/** 包名/版本号上限：npm 包名上限 214 字符，200 足够表达且与 commit 字段口径一致。 */
export const MAX_MANIFEST_NAME_CHARS = 200

/**
 * 单次 diff 最多列出的包条数。
 *
 * 取值理由：dsh CLI 依赖闭包实测为几十个包，1000 = 一个数量级以上的余量——正常产物
 * 永远够用，只有异常闭包才会被截断。截断保留字典序最前的若干条，不改变输出结构。
 */
export const MAX_MANIFEST_PACKAGES = 1000

/** 参与 diff 对比的 manifest 字段（与产物既有格式一致，不增删）。 */
const MANIFEST_FIELDS = [
  'version',
  'bin',
  'files',
  'exports',
  'dependencies',
  'peerDependencies',
  'main',
  'types',
  'engines',
]

/** 字段值：先按既有格式 JSON.stringify（保证结构可读），再净化（长度上限比 commit 宽）。 */
function fieldValue(value) {
  return scrubField(JSON.stringify(value ?? null), MAX_MANIFEST_FIELD_CHARS)
}

/**
 * 构造 manifest-diff.txt 的完整文本（纯函数，无 IO）。
 *
 * 产物结构与净化前完全一致：同样的版本头、`## 包名: ADDED/REMOVED in b`、
 * `## 包名 (a -> b)` 与 `- 字段:\n  a: ...\n  b: ...`，只是每个不可信字段先过 scrubField。
 *
 * @param {{cli: string, from: string, to: string, packagesA: Map<string, object>, packagesB: Map<string, object>}} input
 *   两侧包名 → 已解析的 package.json 对象（缺失的包不出现在对应 Map 里）。
 */
export function manifestDiffText({ cli, from, to, packagesA, packagesB }) {
  const cliLabel = scrubField(cli, MAX_MANIFEST_NAME_CHARS)
  const fromLabel = scrubField(from, MAX_MANIFEST_NAME_CHARS)
  const toLabel = scrubField(to, MAX_MANIFEST_NAME_CHARS)
  let text = `# package.json manifest diff: ${cliLabel} ${fromLabel} -> ${toLabel}\n\n`

  const names = [...new Set([...packagesA.keys(), ...packagesB.keys()].sort())].slice(0, MAX_MANIFEST_PACKAGES)
  for (const name of names) {
    const label = scrubField(name, MAX_MANIFEST_NAME_CHARS)
    const fa = packagesA.get(name)
    const fb = packagesB.get(name)
    if (!fa || !fb) {
      text += `## ${label}: ${fa ? 'REMOVED in b' : 'ADDED in b'}\n\n`
      continue
    }
    const deltas = MANIFEST_FIELDS.filter((f) => JSON.stringify(fa[f] ?? null) !== JSON.stringify(fb[f] ?? null)).map(
      (f) => `- ${f}:\n  a: ${fieldValue(fa[f])}\n  b: ${fieldValue(fb[f])}`,
    )
    if (deltas.length) {
      const versionA = scrubField(fa.version, MAX_MANIFEST_NAME_CHARS)
      const versionB = scrubField(fb.version, MAX_MANIFEST_NAME_CHARS)
      text += `## ${label} (${versionA} -> ${versionB})\n\n${deltas.join('\n')}\n\n`
    }
  }
  return text
}
