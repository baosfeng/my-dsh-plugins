#!/usr/bin/env node
/**
 * check-links.mjs — 文档引用完整性门禁（markdown 链接/锚点/路径 token/npm script/skill 名）。
 *
 * 背景：一次全仓引用审计发现并修复了 37 处失效引用（markdown 相对链接层级写错、锚点不匹配、
 * 指向早已删除的文件，其中还包括一个被 13 个文件引用却根本不存在的 skill）。根因是**没有任何
 * 自动校验**——scripts/check-docs.mjs 只覆盖"插件 ↔ 根 README / docs 索引与模块 / 安装章节"的
 * 一致性，完全不看链接与锚点，所以这类腐烂长期无人发现。本脚本把那次审计固化成门禁。
 *
 * 检查的 5 类（任一失败 exit 1）：
 *   1. link   markdown 相对链接与图片 ](path) ](path#anchor)：按「文件所在目录」与「仓库根」
 *             两种基准解析，任一存在即有效；目录链接（尾部 /）与 #anchor-only 同样处理。
 *   2. anchor md 链接的 #fragment 必须命中目标 md 的标题锚点集合（GitHub slug 规则，中文标题的
 *             全角括号等符号按 GitHub 行为剔除：#需求回归（强制要求） → #需求回归强制要求）。
 *   3. path   反引号内的白名单前缀路径 token（docs/ skills/ scripts/ plugins/ verification/
 *             .reasonix/ .github/ .husky/）与 `node <path>` / `bash <path>` 调用。
 *             解析带**就近语义**：文件所在目录的整条祖先链都算基准（插件 build 脚本里自引用的
 *             `scripts/build.mjs`、文档里指插件内约定路径的同名 token 因此不会误报）。
 *   4. npm    `npm run xxx` 必须存在于某个 package.json——按 npm 的就近语义解析：插件 README 里的
 *             `npm run build` 指插件自己的 package.json，不是根 package.json；代码块内 `cd <dir>`
 *             会切换就近基准。
 *   5. name   `` `xxx` skill `` / `skills/<name>/` / `` `dsh-my-xxx` `` 是否存在（skill 在仓库
 *             skills/、.reasonix/skills/、全局 ~/Documents/skills/、~/.dsh/skills/ 或 EXTERNAL_SKILLS
 *             白名单；插件在 plugins/ 或 node_modules/）。
 *
 * 为什么 skip 规则和检查同等重要：这类门禁一旦有误报就会被绕过。已固化的豁免（每条都有单测）：
 *   · 外部 URL（http/https/mailto/data:/tel: 等 scheme）、`~` 家目录路径、工作区外绝对路径；
 *   · glob / 占位符 / 省略号（* ? { } [ ] < > | $、`...`、`<name>`、`url` 这类语法占位词）；
 *   · fenced code block 内的 markdown 链接语法与 `dsh-*`/skill 名（示例文本），但块内的
 *     `node scripts/x.mjs` 与 `npm run x` 仍校验（那是真命令）；
 *   · 历史留痕文件（任意目录下的 CHANGELOG.md、docs/adr/）：记录当时事实，不随改名失效；
 *   · 「有意裁剪」标注（±3 行内的 `not shipped in this trimmed copy`，如 skills/plugin-upgrade/）；
 *   · 宿主仓库布局行（出现 packages/ apps/ bundle/ 的行讲的是 DSH 宿主源码树）与
 *     上游/外部来源行（upstream / 权威来源）；
 *   · 同行已有 markdown 链接目标时，反引号里与之同后缀的 token 视为链接文本（不重复判定）；
 *   · 省略宿主目录的约定路径（`plugins/<任意插件>/<token>`、`skills/<任意 skill>/<token>`）；
 *   · plugins/<name> 的 <name> 已不存在 → 历史改名/示例，不报（存在但子路径失效才报）；
 *   · `dsh-*` 只在 `` `dsh-my-xxx` `` 且不是任何现存插件名的扩展时才当插件名校验——反引号里的
 *     dsh-* 绝大多数是 CSS 类名（`dsh-md-render-copy`）、DOM id、systemPrompt section 保留名、
 *     宿主自身包名（dsh-session/dsh-llm…）或"未被采用的候选包名"，无上下文一律校验必成噪音；
 *   · 宿主内部包名（不在 plugins/、也不像本仓库插件的 dsh-*）；
 *   · HTTP 路由路径（`/plugins/<name>/client.js` 这类浏览器请求路径，不是文件系统路径）；
 *   · npm run 占位名（x / xxx / script 这类散文泛指）与「插件级通用 script」（文档在讲插件目录内的
 *     build/test 操作，而不是根 package.json）；
 *   · 仓库外 skill 内部脚本：登记在 EXTERNAL_SKILL_ASSETS（如 github-ops 的 scripts/ghops.py）——
 *     本地靠真实目录命中，CI 上没有全局 skill 目录，不登记就会本地绿 CI 红；
 *   · 构建/压缩产物（vendor/、*.min.js、plugins/<name>/lib/**）、>1MB 文件、>100k 字符的单行、
 *     以及 scripts/test/*.test.mjs（里面的"失效引用"是 fixture 数据）——前几项还兼作性能保护：
 *     实测单行 8.9MB 的 mermaid.min.js 会让 ]( ) 链接正则退化成 O(n²)，门禁直接挂死不返回；
 *   · 仓库外依赖的全局 skill：必须登记进 EXTERNAL_SKILLS（否则 CI 报错），保证本地/CI 判定一致。
 *
 * 扫描范围：git 已跟踪的文件（门禁管的是仓库内容；新增文件请先 `git add` 再跑，否则不在范围内）。
 *
 * 已知边界（诚实记录，不是 bug 但值得知道）：
 *   · 只解析 inline 链接 `](path)` / 图片 `![alt](path)`；markdown 的引用式链接定义 `[ref]: path`
 *     与 HTML `<a href>` 不在范围内（当前仓库未使用这两种写法，实测 grep 无命中）。
 *   · 逐行解析，跨行拆开的链接不解析（宁漏报不误报）；反引号 token 只校验路径存在，
 *     不校验它自带的 `#anchor`。
 *   · 行内代码 span 与反斜杠转义的 `\[` 已遮蔽（`[标题](./目标.md)` 这类示例不再误报），
 *     但 **HTML 注释**（`<!-- 待补：[稍后](./later.md) -->`）与 **4 空格缩进代码块**里的
 *     链接仍会被当真实引用——当前仓库实测 0 处命中，暂按已知边界记录。
 *   · `npm run "带引号的名字"` 不解析（正则只认裸名）。
 *   · 本地 macOS 文件系统**大小写不敏感**：链接写成 `DOCS/索引.md` 本地会通过、Linux CI 会红
 *     ——失败方向是安全的（CI 拦住），但排查时要知道是这一点。
 *   · `../../x` 这类越过仓库根的相对路径会被归一化后按仓库根解析，理论上可能误判为仓库内文件。
 *
 * 用法：
 *   node scripts/check-links.mjs               # 全仓校验（CI / 本地门禁）
 *   node scripts/check-links.mjs --verbose     # 额外打印豁免统计明细
 *   node scripts/check-links.mjs --root <dir>  # 指定仓库根（单测用）
 *
 * 退出码：0 = 全部通过；1 = 存在失效引用。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 配置：白名单与豁免（新增引用需在此登记，这是本门禁唯一的维护点）───────────

/** 反引号 token / shell 调用里需要校验存在的仓库顶层前缀（其余路径形态不扫，避免歧义噪音）。 */
const PATH_PREFIXES = ['docs', 'skills', 'scripts', 'plugins', 'verification', '.reasonix', '.github', '.husky']

/** 省略宿主目录的约定路径根：文档讲"插件/skill 内部的 scripts/x.mjs"时不会再写一遍 plugins/<name>/。 */
const WILDCARD_ROOTS = ['plugins', 'skills', '.reasonix/skills']

/** 仓库外依赖的全局 skill（不在 skills/ 也不在 .reasonix/skills/ 里）。新增外部 skill 引用必须登记。 */
export const EXTERNAL_SKILLS = [
  'agent-browser',
  'codebase-memory',
  'coding-standards',
  'commit-standards',
  'development-lifecycle',
  'engineering-standards',
  'github-ops',
  'npm-ops',
  'quality-gates',
  'scan-to-docs',
  'ssh-ops',
  'testing-standards',
]

/** 「有意裁剪」标注：其所在行 ±3 行的引用视为上游未随本副本分发，豁免。 */
const TRIMMED_MARK = 'not shipped in this trimmed copy'
const TRIMMED_WINDOW = 3

/**
 * 仓库外 skill 内部被文档引用的相对路径（例如 ~/Documents/skills/github-ops/scripts/ghops.py）。
 * 本地靠真实目录命中即通过，CI 上没有这些全局 skill —— 必须显式登记，否则会变成"本地绿、CI 红"。
 */
export const EXTERNAL_SKILL_ASSETS = ['scripts/ghops.py', 'scripts/test_ghops_224.py']

/** 行内含宿主仓库布局 / 上游来源信号 → 该行路径按"别的仓库的结构"处理。 */
const HOST_LAYOUT_RE = /(?:^|[\s`(（[,])(?:packages|apps|bundle)\//
const UPSTREAM_RE = /upstream|权威来源|上游仓库|not shipped/i
/** 宿主 API 名（skill.list / subagent.interrupt 这类）所在行的 skills/ 路径是宿主工具路径，不是仓库 skill。 */
const HOST_API_RE = /`[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9.]*`/
/** 同行有外部仓库链接 → 该行 scripts/ 引用是那个仓库自己的脚本（如 dsh-TUI 的 verify-tps.mjs）。 */
const THIRD_PARTY_RE = /github\.com/
/** 升级审计语料：按设计引用上游 DSH 仓库的文档（如 docs/config-catalog.md）。 */
const UPSTREAM_CORPUS_RE = /^skills\/(?:dsh-upgrade-audit|plugin-upgrade)\//

/** 历史留痕：记录当时事实，不参与改名后的失效判定。 */
const HISTORY_FILE_RE = [/(^|\/)CHANGELOG\.md$/i, /(^|\/)docs\/adr\//]

const MD_RE = /\.(md|markdown)$/i
const SCAN_RE = /\.(md|markdown|ya?ml|sh|bash|mjs|cjs|js|ts|tsx|json|feature|txt)$/i
const SCAN_EXTRA_RE = /(^|\/)\.husky\/|(^|\/)\.(gitignore|prettierignore)$/
const SKIP_WALK = new Set(['node_modules', '.git', 'coverage', '.stryker-tmp', 'reports', 'dist', 'build', '.reasonix'])

/**
 * 不扫的文件：构建产物/压缩产物（不是文档，且超长行会让 markdown 正则退化为 O(n²)——
 * 实测 plugins/dsh-mermaid-render/vendor/mermaid.min.js 单行 8.9MB 直接把脚本挂死）。
 * 与 prettier/eslint 的既有排除保持一致。
 */
const SKIP_PATH_RES = [
  /(^|\/)vendor\//,
  /\.min\.(?:js|css)$/i,
  /^plugins\/[^/]+\/lib\/(?!parts\/)(?!client\.src\.js$).*\.js$/,
  // 测试文件里的"失效引用"是 fixture 数据（本门禁自己的回归测试就靠它们），不是文档引用
  /^scripts\/test\/.*\.test\.mjs$/,
]
const SKIP_FILES = new Set(['package-lock.json'])
/** 单文件/单行上限：超过就不做 markdown 解析（文档不会这么长，正则也不该跑这种输入）。 */
const MAX_FILE_BYTES = 1_000_000
const MAX_LINE_CHARS = 100_000

/** glob / 占位符 / 省略号 / 模板 —— 不是可解析的具体路径。 */
const NON_LITERAL_RE = /[*?{}[\]<>|$`]|\.\.\.|\bxxx\b|\bNNN\b/
/** markdown 语法占位词（教学示例里的 ![alt](url) 之类）。 */
const PLACEHOLDER_RE = /^(?:url|path|link|href|src|file|target|filename|dir|directory)$/i

// ── 纯函数：slug 与锚点 ─────────────────────────────────────────────────────

/**
 * GitHub 标题 slug：去 markdown 装饰与 HTML/全角符号，空格转连字符（collapse=折叠连续空白）。
 *
 * keepUnderscore：GitHub（github-slugger）**保留下划线**（`foo_bar` → `foo_bar`），但下划线在
 * markdown 里也是强调标记（`_foo_` → `foo`）——本脚本不做 markdown 渲染，无法区分，于是两种
 * 变体都收进锚点集合：宁可宽松（不误报），也不要把 GitHub 上有效的锚点判红。
 */
export function slugify(text, collapse = true, keepUnderscore = false) {
  const stripped = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(keepUnderscore ? /[`*~]/g : /[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(keepUnderscore ? /[^\p{L}\p{N}\s_-]/gu : /[^\p{L}\p{N}\s-]/gu, '')
  return collapse ? stripped.replace(/\s+/g, '-') : stripped.replace(/ /g, '-')
}

/** 一个标题可能对应的全部 slug 变体（折叠/非折叠 × 保留下划线/剥下划线）。 */
function slugVariants(raw) {
  return new Set([slugify(raw, true), slugify(raw, false), slugify(raw, true, true), slugify(raw, false, true)])
}

/** 收集 md 内容里全部可锚定 id：ATX/setext 标题、HTML 锚点、{#custom}，并处理重复标题 -1/-2 后缀。 */
export function anchorsOfContent(content) {
  const anchors = new Set()
  const counts = new Map()
  const add = (raw) => {
    for (const s of slugVariants(raw)) {
      if (!s) continue
      const n = counts.get(s) ?? 0
      counts.set(s, n + 1)
      anchors.add(s)
      if (n > 0) anchors.add(`${s}-${n}`)
    }
  }
  const lines = content.split(/\r?\n/)
  let fence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const atx = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (atx) add(atx[1])
    else if (line.trim() && !line.includes('|') && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1] ?? '')) add(line.trim())
    // HTML 命名锚点/显式 id：**原样大小写**也要收（`<a name="UserGuide">` 的 `#UserGuide` 有效），
    // 下面再补小写变体——只存小写会把这个分支变成"怎么写都报错"的死分支。
    for (const re of [/<a\s[^>]*(?:name|id)=["']([^"']+)["']/gi, /<h[1-6]\s[^>]*id=["']([^"']+)["']/gi]) {
      let m
      while ((m = re.exec(line))) {
        anchors.add(m[1])
        anchors.add(m[1].toLowerCase())
      }
      re.lastIndex = 0
    }
    const custom = /\{#([^}]+)\}/g
    let c
    while ((c = custom.exec(line))) for (const s of slugVariants(c[1])) anchors.add(s)
  }
  return anchors
}

/** 从相对路径里提取 skill 名（skills/<name>/… 或 .reasonix/skills/<name>/… 或 ~/Documents/skills/<name>/…）。 */
export function skillFromPath(rel) {
  const norm = rel
    .replace(/\\/g, '/')
    .replace(/^~\/?/, '')
    .replace(/^(\.\.?\/)+/, '')
  const m = /(?:^|\/)skills\/([A-Za-z0-9._-]+)(?:\/|$)/.exec(norm)
  return m ? m[1] : null
}

/** 相对目录及其全部祖先（含仓库根 ''），用于就近解析。 */
export function ancestorDirs(relDir) {
  const out = []
  let cur = relDir.replace(/^\.\/+/, '').replace(/\/+$/, '')
  while (cur && cur !== '.') {
    out.push(cur)
    const i = cur.lastIndexOf('/')
    cur = i < 0 ? '' : cur.slice(0, i)
  }
  out.push('')
  return out
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 在 root 上跑全部检查。
 * @returns {{root:string, files:number, checked:number, skipped:Map<string,number>, findings:Array<object>}}
 */
export function runCheck(options = {}) {
  const root = options.root ?? REPO_ROOT
  const home = options.home ?? homedir()
  const files = listFiles(root)
  const skillDirs = collectSkillDirs(root, home)
  const ctx = {
    root,
    home,
    repoSkills: skillDirs.repo,
    skills: new Set([...skillDirs.repo, ...skillDirs.local, ...skillDirs.global, ...EXTERNAL_SKILLS]),
    plugins: new Set(safeReaddir(join(root, 'plugins'))),
    nodeModules: new Set(safeReaddir(join(root, 'node_modules'))),
    findings: [],
    checked: 0,
    skipped: new Map(),
    pkgCache: new Map(),
    anchorCache: new Map(),
    dirCache: new Map(),
    pluginScripts: null,
  }
  for (const file of files) {
    let content
    try {
      const abs = join(root, file)
      if (statSync(abs).size > MAX_FILE_BYTES) {
        skip(ctx, '超大文件（构建/压缩产物，非文档）')
        continue
      }
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    checkFile(ctx, file, content)
  }
  return { root, files: files.length, checked: ctx.checked, skipped: ctx.skipped, findings: ctx.findings }
}

/**
 * 仓库文件清单：优先 git ls-files（尊重 .gitignore；只含**已纳入版本管理**的文件——门禁管的是
 * 仓库内容，未 `git add` 的草稿不在范围内，新增文件请先 add 再跑），非 git 目录（单测 fixture）
 * 回退目录遍历。
 */
export function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
    })
    const listed = out.split('\0').filter(Boolean)
    if (listed.length > 0) return listed.filter(isScannable)
  } catch {
    /* 非 git 仓库 → 回退目录遍历 */
  }
  return walk(root, '').filter(isScannable)
}

function isScannable(file) {
  const base = file.slice(file.lastIndexOf('/') + 1)
  if (SKIP_FILES.has(base)) return false
  if (SKIP_PATH_RES.some((re) => re.test(file))) return false
  return SCAN_RE.test(file) || SCAN_EXTRA_RE.test(file)
}

function walk(root, rel) {
  const out = []
  for (const entry of safeReaddir(join(root, rel))) {
    const next = rel ? `${rel}/${entry}` : entry
    if (SKIP_WALK.has(entry)) continue
    if (isDirectory(join(root, next))) out.push(...walk(root, next))
    else out.push(next)
  }
  return out
}

function isDirectory(abs) {
  try {
    readdirSync(abs)
    return true
  } catch {
    return false
  }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir).filter((e) => e !== '.DS_Store')
  } catch {
    return []
  }
}

/** skill 名来源：仓库 skills/（跟踪）、.reasonix/skills/（本地）、全局 ~/Documents/skills 与 ~/.dsh/skills。 */
function collectSkillDirs(root, home) {
  const read = (dir) => safeReaddir(dir).filter((n) => existsSync(join(dir, n, 'SKILL.md')))
  return {
    repo: new Set(read(join(root, 'skills'))),
    local: new Set(read(join(root, '.reasonix/skills'))),
    global: new Set([join(home, 'Documents/skills'), join(home, '.dsh/skills')].flatMap(read)),
  }
}

// ── 逐文件 / 逐行检查 ───────────────────────────────────────────────────────

function checkFile(ctx, file, content) {
  // 历史留痕文件整体豁免（记录的是当时的事实，不随后续改名失效）
  if (HISTORY_FILE_RE.some((re) => re.test(file))) {
    skip(ctx, 'history（CHANGELOG / docs/adr 历史留痕，整文件）')
    return
  }
  const isMd = MD_RE.test(file)
  const lines = content.split(/\r?\n/)
  const { flags: fences, unclosedAt } = fenceScan(lines)
  // 未闭合栅栏会把其后全部内容当代码块、静默关掉检查 → 必须显式报（对抗验证 D3）
  if (isMd && unclosedAt >= 0) {
    report(
      ctx,
      'fence',
      file,
      unclosedAt + 1,
      lines[unclosedAt].trim().slice(0, 20),
      '未闭合的代码栅栏：其后内容全部被当作代码块，引用检查对这段已关闭',
    )
  }
  const cdAt = cdContext(lines, fences)
  const trims = trimmedFlags(lines)
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]
    const lc = {
      ctx,
      file,
      line: i + 1,
      text,
      inFence: fences[i],
      trimmed: trims[i],
      hostLayout: HOST_LAYOUT_RE.test(text),
      upstream: UPSTREAM_RE.test(text),
      hostApi: HOST_API_RE.test(text),
      thirdParty: THIRD_PARTY_RE.test(text),
      cdDir: cdAt[i],
      linkTargets: [],
    }
    const mdLine = isMd && !fences[i] && text.length <= MAX_LINE_CHARS
    if (mdLine) {
      // 行内代码里的 `](path)` 是示例文本（如 `![alt](url)`），不是文档导航 →
      // 先把 code span 挖成等长空白再扫链接（长度对齐，索引不变）
      const masked = maskInlineCode(text)
      lc.linkTargets = mdLinkTargets(masked)
      checkMdLinks(lc, masked)
      checkInlinePaths(lc)
      checkSkillNames(lc)
    }
    checkNpmRuns(lc)
    checkShellCalls(lc)
  }
}

function skip(ctx, reason) {
  ctx.skipped.set(reason, (ctx.skipped.get(reason) ?? 0) + 1)
}

function report(ctx, kind, file, line, target, detail) {
  ctx.findings.push({ kind, file, line, target, detail })
}

/** fenced code block 标记（开/闭栅栏行本身也算"块内"，不做 markdown 解析）。 */
function fenceScan(lines) {
  const flags = new Array(lines.length).fill(false)
  let open = null // { ch, len }：CommonMark 要求闭合栅栏**同字符且不短于**开启栅栏
  let openLine = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*(`{3,}|~{3,})/.exec(lines[i])
    if (m) {
      const ch = m[1][0]
      const len = m[1].length
      if (!open) {
        open = { ch, len }
        openLine = i
        flags[i] = true
        continue
      }
      if (ch === open.ch && len >= open.len) {
        flags[i] = true
        open = null
        continue
      }
      // 字符/长度不匹配的栅栏行落在块内 → 它是块内容（`~~~` 关不掉 ``` 块）
    }
    flags[i] = open !== null
  }
  return { flags, unclosedAt: open ? openLine : -1 }
}

/** 标注「not shipped in this trimmed copy」的行 ±N 视为豁免窗口。 */
function trimmedFlags(lines) {
  const marks = []
  for (let i = 0; i < lines.length; i += 1) if (lines[i].includes(TRIMMED_MARK)) marks.push(i)
  return lines.map((_, i) => marks.some((m) => Math.abs(m - i) <= TRIMMED_WINDOW))
}

/** 每个代码块内 `cd <dir>` 建立的工作目录上下文（供 npm run 就近解析）。 */
function cdContext(lines, fences) {
  const out = new Array(lines.length).fill(null)
  let cur = null
  for (let i = 0; i < lines.length; i += 1) {
    if (!fences[i]) cur = null
    const m = /^\s*(?:\$\s+)?cd\s+("([^"]+)"|'([^']+)'|(\S+))/.exec(lines[i])
    if (m) {
      const p = m[2] ?? m[3] ?? m[4]
      if (p === '..') cur = cur ? dirname(cur) : null
      else if (p.startsWith('/') || p.startsWith('~')) cur = null
      else cur = cur ? `${cur}/${p}` : p
    }
    out[i] = cur
  }
  return out
}

// ── 1 + 2：markdown 链接与锚点 ──────────────────────────────────────────────

const MD_LINK_RE = /!?\[[^\]]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g

/** 该行全部 markdown 链接目标（用于"反引号 token 只是链接文本"的豁免判定）。 */
/** 把行内代码 span 替换成等长空白（保留索引，供链接扫描用）。 */
function maskInlineCode(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== '`') j += 1
      if (j < text.length) {
        out += ' '.repeat(j - i + 1)
        i = j + 1
        continue
      }
    }
    // 反斜杠转义的 `\[` `\]` 是字面量方括号，不构成链接语法（对抗验证 D4）
    if (text[i] === '\\' && '[]'.includes(text[i + 1] ?? '')) {
      out += '  '
      i += 2
      continue
    }
    out += text[i]
    i += 1
  }
  return out
}

function mdLinkTargets(text) {
  const out = []
  MD_LINK_RE.lastIndex = 0
  let m
  while ((m = MD_LINK_RE.exec(text))) out.push(m[1].replace(/^<|>$/g, ''))
  return out
}

function checkMdLinks(lc, text) {
  MD_LINK_RE.lastIndex = 0
  let m
  while ((m = MD_LINK_RE.exec(text ?? lc.text))) {
    let target = m[1]
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim()
    const verdict = classifyTarget(lc, target)
    if (verdict.kind === 'skip') skip(lc.ctx, verdict.reason)
    else if (verdict.kind === 'miss') report(lc.ctx, 'link', lc.file, lc.line, target, verdict.detail)
    if (verdict.kind !== 'skip') checkAnchor(lc, target, verdict.file)
  }
}

/** 判定 markdown 链接目标：skip（豁免）/ hit（命中）/ miss（失效）。 */
function classifyTarget(lc, raw) {
  const target = decode(raw)
  if (!target) return { kind: 'skip', reason: 'empty' }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return { kind: 'skip', reason: 'url / scheme（外部地址）' }
  if (NON_LITERAL_RE.test(target)) return { kind: 'skip', reason: 'glob / 占位符 / 省略号' }
  if (PLACEHOLDER_RE.test(target)) return { kind: 'skip', reason: 'markdown 语法占位词' }
  if (target.startsWith('#')) return { kind: 'hit', file: lc.file }
  const pathPart = target.split('#')[0]
  if (!pathPart) return { kind: 'skip', reason: 'empty' }
  if (pathPart.startsWith('~')) {
    const name = skillFromPath(pathPart)
    if (name && lc.ctx.skills.has(name)) return { kind: 'hit', file: null }
    return { kind: 'skip', reason: '~ 家目录路径（环境相关）' }
  }
  if (pathPart.startsWith('/')) {
    if (!resolve(pathPart).startsWith(lc.ctx.root)) return { kind: 'skip', reason: '工作区外绝对路径' }
    if (fsExistsCaseSensitive(lc.ctx, pathPart)) return { kind: 'hit', file: null }
    return { kind: 'miss', detail: `绝对路径不存在：${pathPart}` }
  }
  const hit = resolveExisting(lc, pathPart)
  if (hit) return { kind: 'hit', file: hit.file }
  const name = skillFromPath(pathPart)
  if (name && lc.ctx.skills.has(name) && !lc.ctx.repoSkills.has(name)) {
    return { kind: 'hit', file: null } // 仓库外 skill（.reasonix / 全局）：只保证 skill 名有效
  }
  return { kind: 'miss', detail: `目标不存在（文件目录、祖先目录、仓库根均未命中）：${pathPart}` }
}

/** 目录项集合（缓存 readdir 结果——大小写敏感判定要逐段核对真实名字）。 */
function dirEntries(ctx, absDir) {
  if (!ctx.dirCache.has(absDir)) {
    let set = null
    try {
      set = new Set(readdirSync(absDir))
    } catch {
      set = null
    }
    ctx.dirCache.set(absDir, set)
  }
  return ctx.dirCache.get(absDir)
}

/**
 * 大小写敏感的"存在"判定：逐段枚举真实目录项做**精确名字比对**。
 *
 * 为什么不能直接 existsSync：macOS/Windows 文件系统大小写不敏感，`DOCS/索引.md` 会命中
 * `docs/索引.md`；Linux CI 不命中 —— 于是门禁在本地**永远测不出**大小写写错，第一次上 CI
 * 就红（2026-09-11 CI run #15 实测：文档写 `.github/pull_request_template.md`，真实文件是
 * `.github/PULL_REQUEST_TEMPLATE.md`，同时打红 12/13 门禁与 7/13 的真实仓库自检测试）。
 * 自己核对名字才能让本地与 CI 判定一致。
 */
export function fsExistsCaseSensitive(ctx, absPath) {
  const segs = absPath.split('/').filter(Boolean)
  let cur = absPath.startsWith('/') ? '/' : '.'
  for (const seg of segs) {
    if (seg === '.') continue
    if (seg === '..') {
      cur = dirname(cur)
      continue
    }
    const entries = dirEntries(ctx, cur)
    if (!entries || !entries.has(seg)) return false
    cur = cur === '/' ? `/${seg}` : `${cur}/${seg}`
  }
  return true
}

/** 就近解析：文件所在目录 → 祖先目录链 → 仓库根；返回命中的仓库内相对路径。 */
function resolveExisting(lc, rel) {
  const relDir = lc.file.includes('/') ? lc.file.slice(0, lc.file.lastIndexOf('/')) : ''
  for (const base of ancestorDirs(relDir)) {
    const cand = normalizeRel(join(base, rel))
    if (fsExistsCaseSensitive(lc.ctx, join(lc.ctx.root, cand))) return { file: cand }
  }
  // home 兜底**只对 `~/x` 路径**生效：相对路径若也去 home 下找，`scripts/xxx` 会被本机真实存在的
  // ~/scripts/ 命中（对抗验证 D6 的根因）——那是"本地绿、CI 红"式的假命中，必须限定在 `~/` 前缀。
  if (rel.startsWith('~/') && fsExistsCaseSensitive(lc.ctx, join(lc.ctx.home, rel.slice(2)))) return { file: null }
  return null
}

/** 该相对路径是否解析到一个真实存在的**目录**（用于排除"收缩后只剩目录"的假命中）。 */
function isExistingDirectory(lc, rel) {
  const hit = resolveExisting(lc, rel)
  if (!hit) return false
  const abs = hit.file ? join(lc.ctx.root, hit.file) : join(lc.ctx.home, rel.replace(/^~\//, ''))
  return isDirectory(abs)
}

function normalizeRel(p) {
  const parts = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function checkAnchor(lc, rawTarget, resolvedFile) {
  const hash = rawTarget.indexOf('#')
  if (hash < 0) return
  const frag = decode(rawTarget.slice(hash + 1))
  if (!frag) return
  let targetFile = resolvedFile
  if (!targetFile) {
    const pathPart = rawTarget.split('#')[0]
    if (!pathPart) targetFile = lc.file
    else {
      const relDir = lc.file.includes('/') ? lc.file.slice(0, lc.file.lastIndexOf('/')) : ''
      targetFile = [...ancestorDirs(relDir), ...['', '..']]
        .map((base) => normalizeRel(join(base, pathPart)))
        .find((c) => fsExistsCaseSensitive(lc.ctx, join(lc.ctx.root, c)))
    }
  }
  if (!targetFile || !MD_RE.test(targetFile)) return
  // 标题 slug 都是小写，但 HTML 命名锚点（<a name="UserGuide">）原样大小写也有效 → 两种都比
  const want = frag.replace(/^user-content-/, '')
  const anchors = anchorsOf(lc.ctx, targetFile)
  if (anchors.has(want) || anchors.has(want.toLowerCase())) return
  report(lc.ctx, 'anchor', lc.file, lc.line, rawTarget, `目标 ${targetFile} 无锚点 #${frag}`)
}

function anchorsOf(ctx, file) {
  if (!ctx.anchorCache.has(file)) {
    let content = ''
    try {
      content = readFileSync(join(ctx.root, file), 'utf8')
    } catch {
      content = ''
    }
    ctx.anchorCache.set(file, anchorsOfContent(content))
  }
  return ctx.anchorCache.get(file)
}

// ── 3：反引号路径 token 与 shell 调用 ───────────────────────────────────────

const INLINE_CODE_RE = /`([^`\n]+)`/g
const TOKEN_RE = /(?:~\/|\.{1,2}\/)?[A-Za-z0-9._\u4e00-\u9fa5-]+(?:\/[A-Za-z0-9._\u4e00-\u9fa5-]+)+/g
const TRAILING_RE = /[)\]}>,.;:，。；：、）】]+$/
const SAFE_PREFIX_RE = /^[\w./-]*/

function checkInlinePaths(lc) {
  INLINE_CODE_RE.lastIndex = 0
  let code
  while ((code = INLINE_CODE_RE.exec(lc.text))) {
    // `/plugins/<name>/client.js` 这类是 DSH 提供的 HTTP 路由（浏览器请求路径），不是文件系统路径
    if (code[1].trimStart().startsWith('/')) {
      skip(lc.ctx, 'HTTP 路由路径 / 绝对路径')
      continue
    }
    TOKEN_RE.lastIndex = 0
    let tok
    while ((tok = TOKEN_RE.exec(code[1]))) {
      // glob 的后半段会被 token 正则截断（`.github/workflows/*.yml` → `.github/workflows`）：
      // 取 token 起、到下一个分隔符为止的整个"路径样片段"，含 glob 字符就整体豁免。
      const segment = code[1].slice(tok.index).split(/[\s`,;，；、|）)】]/)[0]
      if (/[*?{<[$]/.test(segment)) {
        skip(lc.ctx, 'glob / 占位符 / 省略号')
        continue
      }
      verifyToken(lc, tok[0].replace(TRAILING_RE, ''))
    }
  }
}

function isCandidatePath(token) {
  const norm = token.replace(/^(\.\.?\/)+/, '')
  if (norm.startsWith('~')) return /skills\//.test(norm)
  return PATH_PREFIXES.some((p) => norm.startsWith(`${p}/`))
}

function verifyToken(lc, token) {
  if (!isCandidatePath(token)) return
  if (NON_LITERAL_RE.test(token) || PLACEHOLDER_RE.test(token)) {
    skip(lc.ctx, 'glob / 占位符 / 省略号')
    return
  }
  // 目录泛指（skills/、.reasonix/skills/）不是具体文件
  if (/(?:^|\/)skills\/?$/.test(token)) {
    skip(lc.ctx, 'skill 目录泛指（未指名具体 skill）')
    return
  }
  if (resolveExisting(lc, token)) {
    lc.ctx.checked += 1
    return
  }
  const reason = fallbackExemption(lc, token)
  if (reason) {
    skip(lc.ctx, reason)
    return
  }
  lc.ctx.checked += 1
  report(lc.ctx, 'path', lc.file, lc.line, token, `路径不存在（文件目录、祖先目录、仓库根均未命中）：${token}`)
}

/** 未命中时的豁免链：这些语境下 token 本来就指别处（链接文本/宿主树/上游/省略宿主目录）。 */
function fallbackExemption(lc, token) {
  if (lc.trimmed) return '有意裁剪的上游引用（not shipped in this trimmed copy）'
  if (lc.linkTargets.some((t) => t.endsWith(token))) return 'markdown 链接文本（同行已有真实链接目标）'
  if (lc.hostLayout) return '宿主仓库布局（packages/ apps/ bundle/ 路径）'
  if (lc.upstream) return '上游/外部来源引用'
  if (lc.thirdParty && /^scripts\//.test(token)) return '第三方仓库的脚本引用（同行有外部仓库链接）'
  if (lc.hostApi && /^skills\//.test(token)) return '宿主 skill 工具路径（同行有 skill.list 这类 API 名）'
  if (UPSTREAM_CORPUS_RE.test(lc.file) && /^docs\/[^/]+\.md$/.test(token))
    return '上游 DSH 仓库文档（升级审计语料按设计引用）'
  if (wildcardExists(lc, token)) return '省略宿主目录的约定路径（plugins/* 或 skills/* 内存在）'
  if (EXTERNAL_SKILL_ASSETS.includes(token)) return '仓库外 skill 内部脚本（已登记，CI 上无全局 skill 目录）'
  const m = /^plugins\/([^/]+)/.exec(token.replace(/^(\.\.?\/)+/, ''))
  if (m && !lc.ctx.plugins.has(m[1])) return 'plugins/<name> 非现存插件（历史改名/示例）'
  const name = skillFromPath(token)
  // 只有**仓库外** skill 才靠"skill 名有效"豁免；仓库内 skill 的子路径必须真实存在，
  // 否则 skills/<现有 skill>/已删除文件.md 这类引用会被整块放行（对抗验证 D1）。
  if (name && lc.ctx.skills.has(name) && !lc.ctx.repoSkills.has(name))
    return '仓库外 skill 内部路径（skill 名有效即豁免）'
  return null
}

/** 省略宿主目录的约定路径：<root>/<any>/<token> 存在即算（文档讲"某插件/某 skill 内部的 x"）。 */
function wildcardExists(lc, token) {
  const roots = WILDCARD_ROOTS.map((r) => join(lc.ctx.root, r)).concat([
    join(lc.ctx.home, 'Documents/skills'),
    join(lc.ctx.home, '.dsh/skills'),
  ])
  return roots.some((r) => safeReaddir(r).some((name) => fsExistsCaseSensitive(lc.ctx, join(r, name, token))))
}

const SHELL_CALL_RE =
  /\b(?:node|bash|sh|zsh|npx\s+tsx)\s+(?:"|')?((?:\.{1,2}\/)?(?:scripts|plugins|skills|verification|docs)\/[^\s"'`;&|)]+)/g

function checkShellCalls(lc) {
  SHELL_CALL_RE.lastIndex = 0
  let m
  while ((m = SHELL_CALL_RE.exec(lc.text))) {
    const target = m[1].replace(TRAILING_RE, '')
    if (NON_LITERAL_RE.test(target)) {
      skip(lc.ctx, 'glob / 占位符 / 省略号')
      continue
    }
    // 命令后面的中文说明/标点会被贪婪吃进来：完整 token 不命中时收缩到路径安全前缀再试
    const safe = SAFE_PREFIX_RE.exec(target)[0].replace(TRAILING_RE, '')
    // 收缩只能用于"命令后跟着中文说明/标点"的场景：收缩结果若只是个**目录**（`node scripts/<中文名>.mjs`
    // 会被截断成 `scripts/`），那不算命中——否则中文脚本名的失效调用会被静默放行（对抗验证 D6）。
    const shrunkHit = safe !== target && resolveExisting(lc, safe) && !isExistingDirectory(lc, safe)
    if (resolveExisting(lc, target) || shrunkHit) {
      lc.ctx.checked += 1
      continue
    }
    const reason = fallbackExemption(lc, target)
    if (reason) {
      skip(lc.ctx, reason)
      continue
    }
    lc.ctx.checked += 1
    report(lc.ctx, 'shell', lc.file, lc.line, target, `被调用的脚本不存在：${target}`)
  }
}

// ── 4：npm run（就近 package.json 语义）──────────────────────────────────────

const NPM_RUN_RE = /\bnpm run ([a-z][a-z0-9:_-]*)/g
/** 散文里的占位名（"块内的 `npm run x` 仍校验"这类），不是真实 script 引用。 */
const NPM_PLACEHOLDERS = new Set(['x', 'xx', 'xxx', 'script', 'name', 'task', 'cmd', 'foo'])

function checkNpmRuns(lc) {
  NPM_RUN_RE.lastIndex = 0
  let m
  while ((m = NPM_RUN_RE.exec(lc.text))) {
    const name = m[1]
    if (NPM_PLACEHOLDERS.has(name)) {
      skip(lc.ctx, 'npm run 占位名（散文里的泛指写法）')
      continue
    }
    lc.ctx.checked += 1
    if (scriptExists(lc, name)) continue
    if (pluginScriptExists(lc.ctx, name)) {
      skip(lc.ctx, '插件级通用 script（文档在讲插件目录内的操作）')
      lc.ctx.checked -= 1
      continue
    }
    report(
      lc.ctx,
      'npm',
      lc.file,
      lc.line,
      `npm run ${name}`,
      `package.json scripts 里没有 "${name}"（就近 + 仓库根都查过）`,
    )
  }
}

/** npm run 的就近语义：文件所在目录链、cd 上下文链、仓库根，任一 package.json 有该 script 即有效。 */
function scriptExists(lc, name) {
  const relDir = lc.file.includes('/') ? lc.file.slice(0, lc.file.lastIndexOf('/')) : ''
  const dirs = new Set(ancestorDirs(relDir))
  if (lc.cdDir) for (const d of ancestorDirs(normalizeRel(join(relDir, lc.cdDir)))) dirs.add(d)
  for (const d of ancestorDirs(lc.cdDir ?? '')) dirs.add(d)
  for (const dir of dirs) if (scriptsOf(lc.ctx, dir).has(name)) return true
  return false
}

/** 该 script 名是否出现在任意插件 package.json（= 插件级通用操作，如 build/test/typecheck）。 */
function pluginScriptExists(ctx, name) {
  if (!ctx.pluginScripts) {
    ctx.pluginScripts = new Set()
    for (const p of ctx.plugins) for (const s of scriptsOf(ctx, `plugins/${p}`)) ctx.pluginScripts.add(s)
  }
  return ctx.pluginScripts.has(name)
}

function scriptsOf(ctx, relDir) {
  if (!ctx.pkgCache.has(relDir)) {
    let names = new Set()
    try {
      const pkg = JSON.parse(readFileSync(join(ctx.root, relDir, 'package.json'), 'utf8'))
      names = new Set(Object.keys(pkg.scripts ?? {}))
    } catch {
      names = new Set()
    }
    ctx.pkgCache.set(relDir, names)
  }
  return ctx.pkgCache.get(relDir)
}

// ── 5：skill 名与插件名 ─────────────────────────────────────────────────────

const SKILL_REF_RES = [
  /`([A-Za-z0-9][A-Za-z0-9._-]*)`\s*(?:skill|Skill|SKILL)\b/g,
  /\b(?:skill|Skill|SKILL)\s+`([A-Za-z0-9][A-Za-z0-9._-]*)`/g,
]
const PLUGIN_REF_RE = /`(dsh-my-[a-z0-9][a-z0-9-]*)`/g

function checkSkillNames(lc) {
  for (const re of SKILL_REF_RES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(lc.text))) {
      // 占位名（`xxx` / `...` / `<name>` 形态）是文档在讲"新建一个 skill"，不是具体引用（对抗验证 D5）
      if (NON_LITERAL_RE.test(m[1]) || PLACEHOLDER_RE.test(m[1])) {
        skip(lc.ctx, 'skill 占位名')
        continue
      }
      lc.ctx.checked += 1
      if (lc.ctx.skills.has(m[1])) continue
      report(
        lc.ctx,
        'skill',
        lc.file,
        lc.line,
        m[1],
        `skill "${m[1]}" 不存在（仓库 skills/ 与 EXTERNAL_SKILLS 白名单均无）`,
      )
    }
  }
  PLUGIN_REF_RE.lastIndex = 0
  let m
  while ((m = PLUGIN_REF_RE.exec(lc.text))) {
    const name = m[1]
    // 反引号里的 dsh-my-* 绝大多数是 CSS 类名 / DOM id（dsh-my-memory-btn-save）：
    // 只有"不是任何现存插件名扩展"的名字才当插件名判定（否则必成噪音）。
    if (extendOfExistingPlugin(lc.ctx, name)) {
      skip(lc.ctx, 'dsh-* 为插件前缀的 CSS 类名 / DOM id')
      continue
    }
    // 占位名（`dsh-my-xxx` 这类"新插件包名形如…"的示例）不是具体引用（对抗验证 D5）
    if (NON_LITERAL_RE.test(name) || PLACEHOLDER_RE.test(name)) {
      skip(lc.ctx, 'dsh-* 占位名')
      continue
    }
    lc.ctx.checked += 1
    if (lc.ctx.plugins.has(name) || lc.ctx.nodeModules.has(name) || lc.ctx.skills.has(name)) continue
    report(lc.ctx, 'plugin', lc.file, lc.line, name, `插件 "${name}" 不存在（plugins/ 与 node_modules/ 都没有）`)
  }
}

function extendOfExistingPlugin(ctx, name) {
  return [...ctx.plugins].some((p) => name.startsWith(`${p}-`))
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function decode(value) {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function main(argv) {
  const verbose = argv.includes('--verbose')
  const rootIdx = argv.indexOf('--root')
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1] ?? '.') : REPO_ROOT
  const result = runCheck({ root })
  const skippedTotal = [...result.skipped.values()].reduce((a, b) => a + b, 0)
  if (result.findings.length > 0) {
    console.error(`✗ 引用完整性检查失败（${result.findings.length} 项）：`)
    for (const f of [...result.findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.error(`  ${f.file}:${f.line}  [${f.kind}] ${f.target}  → ${f.detail}`)
    }
    console.error('修复后重跑：node scripts/check-links.mjs')
    return 1
  }
  console.log(
    `✓ 引用完整性检查通过（扫描 ${result.files} 个文件，校验 ${result.checked} 条引用，豁免 ${skippedTotal} 条）：` +
      'markdown 链接与锚点 / 路径 token / shell 调用 / npm script / skill 与插件名',
  )
  if (verbose)
    for (const [reason, n] of [...result.skipped].sort((a, b) => b[1] - a[1])) console.log(`    豁免 ${n} × ${reason}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
