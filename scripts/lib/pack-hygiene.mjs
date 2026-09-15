/**
 * 包发布卫生判定（纯函数）—— issue #323
 *
 * 插件以 npm 包发布：`exports` 映射 `./client`、`files` 白名单、`dsh.bundle.patch`、
 * `main`。这些字段写错会**直接变成用户侧故障**（安装后 require 失败 / 漏发产物 /
 * 把测试源码一并发布）。本模块只做判定，不碰 fs —— 文件存在性与 pack 结果由调用方
 * 注入（`exists(relPath)` / `packedPaths`），因此全部判据可单测。
 *
 * ── 为什么是"自实现"而不是 `publint`（decision，见 PR #323）────────────────
 * 实测 publint 0.3.24（2026-09 本机）：
 *   · 覆盖度：只覆盖本 issue 需求 1（`exports`/`main`/`types` 与真实文件一致）。需求 2
 *     （pack 内容断言）与需求 3（`dsh.*` 字段断言）它**完全不认识 DSH 的字段**
 *     （`dsh.bundle.patch` / `dsh.client.platform` / `dsh.kind` 在它眼里就是普通未知字段，
 *     不校验、不影响它任何判据）→ 大头无论用不用它都要自实现。
 *   · 噪声：对 19 个插件实测，publint 恒定输出 `pkg.repository.url ... could be a full git URL`
 *     的 suggestion；9 个带 client 的插件另报 `pkg.exports["./client"].default is ./lib/client.js
 *     and is written in CJS, but is interpreted as ESM` warning —— 而 DSH 插件产物正是宿主
 *     `require` 的 CJS bundle，这个判据在本仓库形态下**不适用**。要引入就得写一批压制规则。
 *   · 重复开销：publint 自己会跑一次 `npm pack`（实测输出 `Packing files with npm pack...`），
 *     与本门禁的 pack 断言重复；单插件实测 ~1.0s、19 插件串行 9.15s，而本门禁自己跑 pack
 *     是 0.37s/插件（并发后 19 插件 ~1.5s）。
 *   · 体积：+7 包 / 428K node_modules（publint 156K + @publint 68K + sade 48K +
 *     package-manager-detector 60K + tinyexec 36K + mri 28K + picocolors 28K）；本仓库
 *     `devDependencies` 已精简，为替换 ~40 行判据付这个代价不划算。
 *   · 但它的**判据值得借鉴**：实测对"exports 指向不存在文件"的 fixture，publint 报
 *     `pkg.exports["./client"].default is ./lib/client.js but the file does not exist`，
 *     与 `findMissingTargets` 同判据（同一 fixture 两边一致命中）。
 * 结论：**自实现**（零新依赖、零噪声、覆盖需求 2/3）。若日后需要更严格的 ESM/CJS 语义
 * 检查，可把 publint 作为**第二判据增量引入**，与本模块不冲突。
 *
 * ── 「源在仓库但故意不发布」怎么表达（issue 明确要求，不许一刀切）────────────
 * 判据是**「被已发布面引用才必须在包内」**，不是"不在 files 就报警"：
 *   · `dsh-mermaid-render` 的 `vendor/`（构建期输入）、各插件的 `src/` `test/` `scripts/`、
 *     `dsh-shared` 的 `client-parts/`（monorepo 内 splice 源，代码注释已声明"发布出去的
 *     包里没有它"）—— 都**不在任何 files 里、也不被已发布面引用** → 判定通过，只作为
 *     info 列出（`describeUnpackedEntries`），不报警。
 *   · README 图片（相对路径或 `unpkg.com/<本包>/...`）、`exports`/`main`/`types` 目标、
 *     `dsh.bundle.patch` 目标 —— 属于已发布面 → **必须在 pack 内**，否则 npm 页面/unpkg
 *     上 404 或安装后 require 失败（本门禁首次全量跑就靠这条抓出 3 个真实问题）。
 */

/** npm 恒定打进 tarball 的文件（`files` 管不着），判定"声明了就必须在包内"时要认它们。 */
export const NPM_ALWAYS_PACKED = Object.freeze([
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'LICENCE',
  'NOTICE',
])

/** 仓库里常见、且**故意不发布**的顶层源目录（构建期输入 / 测试 / 工具链）。 */
export const KNOWN_SOURCE_DIRS = Object.freeze([
  'src',
  'test',
  'tests',
  'scripts',
  'vendor',
  'client-parts',
  'skills',
  'docs',
  'assets',
  'node_modules',
])

/** 仓库里存在就必须随包发布的文件（不存在就不要求，交给 2/3b 等其它门禁管）。 */
export const REQUIRED_IN_PACK = Object.freeze(['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'])

/**
 * 绝对不许出现在包里的内容（卫生红线）。判据是**真实 pack 结果**而不是 `files` 字段：
 * npm 有默认项（README/CHANGELOG/LICENSE/package.json）与 `main` 自动包含等规则，
 * 只看 `files` 会误报/漏报。
 */
export const FORBIDDEN_IN_PACK = Object.freeze([
  {
    code: 'packed-node-modules',
    re: /(^|\/)node_modules\//,
    label: 'node_modules',
    why: '依赖目录随包发布会让 tarball 体积失控，且与宿主的依赖图解析冲突',
    fix: '检查打包时插件目录内是否残留软链/嵌套安装；files 非空时它本不该入选',
  },
  {
    code: 'packed-test',
    re: /^test\//,
    label: 'test/',
    why: '测试随包发布是体积与卫生问题（用户侧用不到，还会被当成公开面）',
    fix: '把 test 从 files 白名单移除；npm 只发 lib/ + cordis.patch.yml + 文档 + assets',
  },
  {
    code: 'packed-src',
    re: /^src\//,
    label: 'src/',
    why: 'TS/模板源码不应随包发布（产物已在 lib/，多一份源码 = 体积 + 两套事实来源）',
    fix: '把 src 从 files 白名单移除',
  },
  {
    code: 'packed-coverage',
    re: /^coverage\//,
    label: 'coverage/',
    why: '覆盖率临时目录是本地/CI 产物，随包发布纯属污染',
    fix: '把 coverage 从 files 白名单移除（并确认 .gitignore 已忽略它）',
  },
  {
    code: 'packed-reports',
    re: /^reports?\//,
    label: 'reports/',
    why: '检查报告目录是构建产物，随包发布纯属污染',
    fix: '把 reports 从 files 白名单移除',
  },
  {
    code: 'packed-ds-store',
    re: /(^|\/)\.DS_Store$/,
    label: '.DS_Store',
    why: 'macOS 元数据文件不该进发布包',
    fix: '从仓库删除该文件；确认 .gitignore 已忽略 .DS_Store',
  },
  {
    code: 'packed-log',
    re: /\.log$/,
    label: '*.log',
    why: '日志文件不该进发布包（可能含本机路径等环境信息）',
    fix: '从 files 白名单移除，或删除该文件',
  },
])

/** 把 `main`/`types`/`dsh.bundle.patch` 这类单值字段规范化成相对路径。 */
function normalizeTarget(spec) {
  if (typeof spec !== 'string' || spec === '') return null
  return spec.startsWith('./') ? spec.slice(2) : spec
}

/** 递归收集 `exports` 里所有字符串值（条件对象/数组都覆盖）。 */
function walkExports(node, keyPath, out) {
  if (typeof node === 'string') {
    const rel = normalizeTarget(node)
    if (rel !== null) out.push({ field: `exports${keyPath}`, relPath: rel })
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkExports(item, `${keyPath}[${i}]`, out))
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) walkExports(node[key], `${keyPath}.${key}`, out)
  }
}

/** 从 package.json 收集「声明即须存在于仓库、且须随包发布」的文件路径。 */
export function collectDeclaredTargets(pkg) {
  const out = []
  if (pkg?.exports !== undefined) walkExports(pkg.exports, '', out)
  const main = normalizeTarget(pkg?.main)
  if (main !== null) out.push({ field: 'main', relPath: main })
  const types = normalizeTarget(pkg?.types)
  if (types !== null) out.push({ field: 'types', relPath: types })
  const patch = normalizeTarget(pkg?.dsh?.bundle?.patch)
  if (patch !== null) out.push({ field: 'dsh.bundle.patch', relPath: patch })
  // 同一个文件可能被多个字段指向：按 relPath 去重，保留首个字段名（报告更短）
  const seen = new Set()
  return out.filter((t) => (seen.has(t.relPath) ? false : (seen.add(t.relPath), true)))
}

/** ① 字段指向的文件必须在仓库里真实存在（exports/main/types/dsh.bundle.patch）。 */
export function findMissingTargets(pkg, exists) {
  return collectDeclaredTargets(pkg)
    .filter((t) => !exists(t.relPath))
    .map((t) => ({
      code: 'target-missing',
      where: `package.json ${t.field} → ${t.relPath}`,
      message: `声明的文件在仓库里不存在：${t.relPath}`,
      why:
        t.field === 'dsh.bundle.patch'
          ? 'dsh.bundle.patch 指向的文件缺失 → 用户 `dsh plugin add` 后 patch 应用失败，插件装不上'
          : `宿主按 ${t.field} 解析后 require 该路径 → 用户机器上必然 Cannot find module`,
      fix: `补上 ${t.relPath} 文件，或修正 ${t.field} 指向真实存在的路径`,
    }))
}

/** ② dsh.* 字段自洽：client 声明与 exports 互证、platform 必为 web、patch 有出口。 */
export function findFieldProblems(pkg, exists) {
  const problems = []
  const client = pkg?.dsh?.client
  const hasClientExport = pkg?.exports?.['./client'] !== undefined
  if (client !== undefined) {
    if (client.platform !== 'web') {
      problems.push({
        code: 'client-platform',
        where: 'package.json dsh.client.platform',
        message: `声明了 dsh.client 但 platform=${JSON.stringify(client.platform)}（应为 "web"）`,
        why: '宿主只把 platform=web 的 client 行挂进浏览器 boot 图，其它值等于声明了不生效',
        fix: '改成 "web"；若确实无浏览器端产物，删除整个 dsh.client 声明',
      })
    }
    if (!hasClientExport) {
      problems.push({
        code: 'client-export-missing',
        where: 'package.json exports["./client"]',
        message: '声明了 dsh.client，但 exports 里没有 "./client" 入口',
        why: '宿主按 exports["./client"] 解析客户端产物路径，缺失即加载失败',
        fix: '补 "exports": { "./client": { "default": "./lib/client.js" } }（并确保 lib/client.js 已构建提交）',
      })
    }
  } else if (hasClientExport) {
    problems.push({
      code: 'client-decl-missing',
      where: 'package.json dsh.client',
      message: 'exports 暴露了 "./client" 但未声明 dsh.client',
      why: '宿主靠 dsh.client 判定这是浏览器端插件；只写 exports 等于产物发了但不会被挂载（用户侧"装了没反应"）',
      fix: '补 "dsh": { "client": { "platform": "web" } }',
    })
  } else if (exists('lib/client.js')) {
    // 兜底：产物已在仓库（多半也已提交），却既无 exports["./client"] 也无 dsh.client
    // → 宿主根本不会加载它（发了等于没发）。纯 server 插件不该有 lib/client.js。
    problems.push({
      code: 'client-bundle-undeclared',
      where: 'lib/client.js',
      message: '存在客户端产物 lib/client.js，但既没有 exports["./client"] 也没有 dsh.client 声明',
      why: '宿主按 dsh.client + exports["./client"] 装载浏览器端产物；两者都缺时这份产物永远不会被加载',
      fix: '补 "exports": { "./client": { "default": "./lib/client.js" } } 与 "dsh": { "client": { "platform": "web" } }；若本插件确实无浏览器端产物，删除 lib/client.js 及其构建配置',
    })
  }
  const patch = normalizeTarget(pkg?.dsh?.bundle?.patch)
  if (patch === null && exists('cordis.patch.yml') && pkg?.dsh?.kind !== 'preset') {
    problems.push({
      code: 'patch-undeclared',
      where: 'package.json dsh.bundle.patch',
      message: '仓库里有 cordis.patch.yml，但未声明 dsh.bundle.patch',
      why: '宿主靠 dsh.bundle.patch 找挂载补丁；不声明 → 插件被安装但不会被挂进 profile（用户侧"装了没反应"）',
      fix: '补 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }；若本插件故意不挂 profile（如 preset 资产包），显式声明 dsh.kind',
    })
  }
  return problems
}

/** ③ pack 内容断言：该有的在不在、不该发的有没有发。 */
export function findPackProblems({ pkg, packedPaths, exists }) {
  const problems = []
  const packed = new Set(packedPaths)
  const covered = (rel) => packed.has(rel) || [...packed].some((p) => p.startsWith(`${rel}/`))
  for (const rel of REQUIRED_IN_PACK) {
    // 仓库里没有的文件不在此处要求（那是别的门禁的判据）；只在"应发而漏发"时报
    if (exists(rel) && !packed.has(rel)) {
      problems.push({
        code: 'pack-missing-required',
        where: `pack 缺少 ${rel}`,
        message: `仓库存在 ${rel}，但它不会随包发布`,
        why: `${rel} 是 npm 包的既定发布面（README/npm 页面/许可展示），漏发后用户在 npm 上看到的是残缺包`,
        fix: `检查 package.json files 白名单是否把 ${rel} 排除了（files 非空时即为白名单语义）`,
      })
    }
  }
  for (const t of collectDeclaredTargets(pkg)) {
    if (!covered(t.relPath)) {
      problems.push({
        code: 'pack-missing-target',
        where: `package.json ${t.field} → ${t.relPath}`,
        message: `${t.field} 指向的 ${t.relPath} 不在发布包里`,
        why: '文件在仓库里存在但不会随包发布 → 用户安装后该入口 404/Cannot find module（本机测试永远发现不了）',
        fix: `把 ${t.relPath} 的目录加进 files 白名单（或修正 ${t.field} 指向包内路径）`,
      })
    }
  }
  for (const path of packedPaths) {
    const hit = FORBIDDEN_IN_PACK.find((rule) => rule.re.test(path))
    if (hit !== undefined) {
      problems.push({
        code: hit.code,
        where: `pack 含 ${path}`,
        message: `不该发布的 ${hit.label} 出现在包里：${path}`,
        why: hit.why,
        fix: hit.fix,
      })
    }
  }
  return dedupeByCode(problems)
}

/** 同一 code 命中多个文件时合并成一条（报告可读，且不刷屏）。 */
function dedupeByCode(problems) {
  const byCode = new Map()
  for (const p of problems) {
    const prev = byCode.get(p.code)
    if (prev === undefined) {
      byCode.set(p.code, { ...p, hits: [p.where] })
      continue
    }
    prev.hits.push(p.where)
  }
  return [...byCode.values()].map((p) =>
    p.hits.length > 1
      ? { ...p, where: `${p.hits.length} 处：${p.hits.slice(0, 4).join('；')}${p.hits.length > 4 ? ' …' : ''}` }
      : p,
  )
}

/** README 里引用的"发布面资产"：相对路径 `assets/x.png` 或 unpkg 指向**本包**的路径。 */
export function extractReadmeRefs(readme, pkgName) {
  if (typeof readme !== 'string' || readme === '') return []
  const refs = []
  // markdown 链接/图片：![alt](./assets/x.png "title")、[x](assets/x.png)
  for (const m of readme.matchAll(/\]\(\s*(?:\.\/)?(assets\/[^)\s"']+)/g)) {
    refs.push({ kind: 'relative', relPath: m[1], raw: m[1] })
  }
  // HTML：<img src="./assets/x.png">
  for (const m of readme.matchAll(/<img[^>]*\ssrc=["'](?:\.\/)?(assets\/[^"']+)["']/g)) {
    refs.push({ kind: 'relative', relPath: m[1], raw: m[1] })
  }
  // unpkg：只有指向**本包**时才能判定（别的包不归我们管）
  for (const m of readme.matchAll(/https:\/\/unpkg\.com\/([^)\s"']+)/g)) {
    const parts = m[1].match(/^([^/]+)\/(.+)$/)
    if (parts === null || parts[1] !== pkgName) continue
    refs.push({ kind: 'unpkg', relPath: parts[2], raw: `https://unpkg.com/${m[1]}` })
  }
  const seen = new Set()
  return refs.filter((r) => (seen.has(r.relPath) ? false : (seen.add(r.relPath), true)))
}

/**
 * ④ README 引用的资产必须「存在且随包发布」。
 * 这一条是 3b（README 效果图门禁）的盲区：3b 只查文件**在仓库里**存不存在，
 * 查不到"文件存在但 files 白名单没带它" → npm 页面与 unpkg 上图片 404。
 */
export function findReadmeRefProblems(refs, { exists, isPacked }) {
  const problems = []
  for (const ref of refs) {
    if (!exists(ref.relPath)) {
      problems.push({
        code: 'readme-ref-missing',
        where: `README.md → ${ref.raw}`,
        message: `README 引用的文件在仓库里不存在：${ref.relPath}`,
        why: '读者点开是裂图；且 unpkg/相对路径都不会命中任何文件',
        fix: `补上 ${ref.relPath}，或修正 README 里的引用路径`,
      })
      continue
    }
    if (!isPacked(ref.relPath)) {
      problems.push({
        code: 'readme-ref-unpacked',
        where: `README.md → ${ref.raw}`,
        message: `README 引用的 ${ref.relPath} 不会随包发布（仓库里有，包里没有）`,
        why:
          ref.kind === 'unpkg'
            ? 'unpkg 直接从 npm 包取文件 → 包内没有该文件时图片 404（用户看到裂图）'
            : 'npm 页面只渲染随包发布的文件 → 相对路径图片在 npm 上必然裂图',
        fix: `把 assets 加进 package.json 的 files 白名单（"files": [..., "assets"]）`,
      })
    }
  }
  return problems
}

/**
 * ⑤ 「源在仓库但故意不发布」的表达：列出仓库里存在、却不随包发布的顶层条目。
 * **只作为 info 输出、绝不报警** —— 判据是「是否被已发布面引用」（见 findReadmeRefProblems /
 * findPackProblems），不是"不在 files 就报警"。
 *
 * `entries` 为 `{ name, isDirectory }`。顶层**文件**（`tsconfig.json` / `vitest.config.mjs` /
 * `stryker.config.mjs` 这类构建配置）不发布是常识，不提示；只有**目录**才有"是不是漏发了"的
 * 疑问，因此只对不在 KNOWN_SOURCE_DIRS 里的目录标 `unexpected`（报告里加一句确认提示）。
 */
export function describeUnpackedEntries(entries, packedPaths) {
  const packed = new Set(packedPaths)
  const isPacked = (rel) => packed.has(rel) || [...packed].some((p) => p.startsWith(`${rel}/`))
  return entries
    .filter((e) => !isPacked(e.name))
    .map((e) => ({ name: e.name, unexpected: e.isDirectory && !KNOWN_SOURCE_DIRS.includes(e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 汇总单插件判定（problems 空 = 通过）。纯函数：fs 与 pack 结果全部由调用方注入。 */
export function auditPlugin({ pkg, readme, packedPaths, repoEntries, exists }) {
  const isPacked = (rel) => packedPaths.includes(rel) || packedPaths.some((p) => p.startsWith(`${rel}/`))
  const problems = [
    ...findMissingTargets(pkg, exists),
    ...findFieldProblems(pkg, exists),
    ...findPackProblems({ pkg, packedPaths, exists }),
    ...findReadmeRefProblems(extractReadmeRefs(readme, pkg?.name), { exists, isPacked }),
  ]
  return {
    name: typeof pkg?.name === 'string' ? pkg.name : null,
    problems,
    unpacked: describeUnpackedEntries(repoEntries, packedPaths),
  }
}

/**
 * 解析 `npm pack --dry-run --json` 的输出。**fail-closed**：拿不到可解析的文件清单
 * 一律抛错（绝不返回空数组静默变绿——"没解析出来"和"包里没东西"必须区分开）。
 */
export function parsePackJson(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`npm pack --json 输出不是合法 JSON（${error instanceof Error ? error.message : error}）`)
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.files)) {
    throw new Error('npm pack --json 输出缺少 files 数组（npm 版本行为变化？）')
  }
  const files = entry.files.map((f) => (typeof f === 'string' ? f : f?.path))
  if (files.some((p) => typeof p !== 'string' || p === '')) {
    throw new Error('npm pack --json 的 files 数组含非法条目')
  }
  return { paths: files, entryCount: entry.entryCount ?? files.length, unpackedSize: entry.unpackedSize ?? 0 }
}
