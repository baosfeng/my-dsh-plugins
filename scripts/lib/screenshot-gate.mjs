/**
 * screenshot-gate.mjs — README 效果图门禁判定（issue #227）。
 *
 * 发版门禁要求插件 README 引用真实存在的截图（`./assets/<file>` 相对路径或
 * `https://unpkg.com/<pkg>/assets/<file>` 绝对 URL），防止 README 出现死图/无图。
 * 无用户可见 UI 的插件无法产出有意义的界面截图，按**显式声明**豁免：
 *
 *   - `dsh.kind === 'library'`：共享工具包（非 DSH 插件，无 UI）——原有豁免；
 *   - `dsh.ui === false` + 非空 `dsh.uiReason`：显式声明「无用户可见 UI」并写明理由。
 *
 * 判据「可判定、可测试、不自欺」的三条硬约束（issue #227 的关键）：
 *   1. 豁免只认显式声明——**不写插件名单**，新增插件不会自动获得豁免（名单会腐烂）；
 *   2. `dsh.ui=false` 必须带非空 `uiReason`——随手豁免会被门禁拦下并提示补理由；
 *   3. `dsh.ui=false` 与 `dsh.client` 互斥——声明无 UI 却提供 client 端即自相矛盾，
 *      客户端插件必须补真实截图（真实 UI 效果图要求不放松）。
 *
 * 豁免结果由 release.mjs 在发版输出中**显式列出**（含理由），不悄悄放行。
 */

/** markdown 图片与 HTML <img> 的引用形态（捕获 assets/ 下的文件名）。 */
const IMG_RE =
  /(?:!\[[^\]]*\]\((?:\.\/assets\/([^)]+)|https:\/\/unpkg\.com\/[^"/]+\/assets\/([^)]+))\)|<img[^>]*src="(?:\.\/assets\/([^"]+)|https:\/\/unpkg\.com\/[^"/]+\/assets\/([^"]+))")/g

/**
 * 提取 README 中引用的截图文件名（去重、保持出现顺序）。
 * @param {string|null|undefined} readme README 文本
 * @returns {string[]} assets/ 下的文件名列表
 */
export function extractScreenshotRefs(readme) {
  const refs = []
  for (const match of String(readme ?? '').matchAll(IMG_RE)) {
    refs.push(match[1] || match[2] || match[3] || match[4])
  }
  return [...new Set(refs)]
}

/**
 * 解析截图门禁豁免声明（纯函数，便于单测覆盖每条判据）。
 * @param {object} pkg 插件 package.json 解析结果
 * @returns {{ exempt: boolean, kind: 'library'|'ui-none'|null, reason: string, problem: string|null }}
 *   `problem` 非 null 表示豁免声明本身不合法（门禁拒绝豁免并报错，必须修正声明）。
 */
export function resolveScreenshotExemption(pkg) {
  const dsh = pkg?.dsh ?? {}
  if (dsh.kind === 'library') {
    return {
      exempt: true,
      kind: 'library',
      reason: '共享工具包（dsh.kind=library）豁免 README 效果图校验（无 UI）',
      problem: null,
    }
  }
  if (dsh.ui === undefined) return { exempt: false, kind: null, reason: '', problem: null }
  if (typeof dsh.ui !== 'boolean') {
    return {
      exempt: false,
      kind: null,
      reason: '',
      problem: `dsh.ui 只接受布尔 false（显式声明无 UI）；收到: ${JSON.stringify(dsh.ui)}`,
    }
  }
  if (dsh.ui !== false) return { exempt: false, kind: null, reason: '', problem: null }
  if (dsh.client !== undefined) {
    return {
      exempt: false,
      kind: null,
      reason: '',
      problem: 'dsh.ui=false 与 dsh.client 互斥：声明无 UI 却提供 client 端，自相矛盾——请补真实截图而不是豁免',
    }
  }
  const uiReason = typeof dsh.uiReason === 'string' ? dsh.uiReason.trim() : ''
  if (uiReason === '') {
    return {
      exempt: false,
      kind: null,
      reason: '',
      problem: 'dsh.ui=false 必须同时声明非空 dsh.uiReason（写明「为什么没有可截图产物」，防止随手豁免）',
    }
  }
  return {
    exempt: true,
    kind: 'ui-none',
    reason: `已豁免 README 效果图校验（dsh.ui=false：${uiReason}）`,
    problem: null,
  }
}

/**
 * 运行 README 效果图门禁。
 * @param {{ name: string, pkg: object, readme: string|null, assetExists: (file: string) => boolean }} input
 * @returns {{ status: 'exempt'|'pass'|'fail', exemption: object|null, refs: string[], missing: string[], detail: string }}
 */
export function checkScreenshotGate({ name, pkg, readme, assetExists }) {
  const exemption = resolveScreenshotExemption(pkg)
  if (exemption.problem !== null) {
    return {
      status: 'fail',
      exemption: null,
      refs: [],
      missing: [],
      detail: `${name}/package.json ${exemption.problem}`,
    }
  }
  if (exemption.exempt) {
    return { status: 'exempt', exemption, refs: [], missing: [], detail: exemption.reason }
  }
  const refs = extractScreenshotRefs(readme)
  const missing = refs.filter((file) => !assetExists(file))
  if (refs.length > 0 && missing.length > 0) {
    return {
      status: 'fail',
      exemption: null,
      refs,
      missing,
      detail: `${name}/README.md references missing screenshots: ${missing.join(', ')}`,
    }
  }
  if (refs.length === 0) {
    return {
      status: 'fail',
      exemption: null,
      refs,
      missing: [],
      detail:
        `${name}/README.md has no real screenshot reference (./assets/... or unpkg URL) — ` +
        'update README + assets/ per the 效果图规范；确无用户可见 UI 的插件须在 package.json ' +
        '声明 dsh.ui=false + dsh.uiReason（见 skills/dsh-plugin-development 效果图规范）',
    }
  }
  return {
    status: 'pass',
    exemption: null,
    refs,
    missing: [],
    detail: `README references ${refs.length} screenshot(s) under assets/`,
  }
}
