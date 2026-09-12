import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * impact-scope.mjs — pre-push「本次变更要跑哪些插件测试」的判定规则（issue #188 抽出）。
 *
 * 为什么抽成模块（而不是留在 verify-local.mjs 里）：
 *   1. **可复现的退化率统计**：scripts/analyze-impact-replay.mjs 回放最近 N 个提交时，
 *      必须与 pre-push 用**同一份规则**，否则统计数字与实际行为两张皮；
 *   2. **可单测**：边界（纯删除提交、已删除的插件目录、package.json 只改元数据）在这里
 *      逐一覆盖，见 scripts/test/impact-scope.test.mjs；
 *   3. 规则本身是纯函数（依赖注入 `plugins` / `dependentsOf`），不碰文件系统。
 *
 * 判定原则：**宁多勿少**。只有能证明「不可能改变任何插件测试结果」的变更才允许收窄范围，
 * 其余一律 escalated=true（安全退化全量）。
 */

/** 文档/skill 目录：只影响 docs 与 format 检查。 */
export const DOC_DIRS = ['docs/', 'skills/']
export const DOC_EXT = ['.md', '.mdx', '.txt']
export const isDocFile = (p) =>
  DOC_DIRS.some((d) => p.startsWith(d)) || DOC_EXT.some((e) => p.endsWith(e)) || p === 'LICENSE'

/**
 * CI 流水线定义目录（.github/）。
 * 改它不会改变任何插件的运行时行为（插件测试结果与流水线 YAML 无关），因此**不应**触发
 * 「仓库根文件变更 → 安全退化全量」（真实事故：一次只改 docs/CI YAML/AGENTS.md 的推送被判为
 * 无法裁剪 → 退化全量，秒级 pre-push 变成跑完 19 个插件的 vitest+cucumber）。
 */
export const CI_CONFIG_DIRS = ['.github/']
export const isRuntimeIrrelevant = (p) => isDocFile(p) || CI_CONFIG_DIRS.some((d) => p.startsWith(d))

/** 根工具链/根配置：改了它们就无法安全推断影响面 → 全量。 */
export const ROOT_TOOLCHAIN_FILES = new Set([
  'package.json',
  'knip.json',
  'tsconfig.json',
  'vitest.config.mjs',
  'eslint.config.js',
  '.dependency-cruiser.js',
  '.jscpd.json',
  '.prettierrc.json',
  '.prettierignore',
  '.commitlintrc.json',
])

/**
 * 「与插件测试结果无关」的文件白名单（issue #188：收窄安全退化）。
 *
 * 入榜条件（三条同时成立，缺一不可）：
 *   1. **没有任何插件测试引用它**——插件测试只跑 plugins/<name>/ 下的 vitest/cucumber，
 *      唯一可能的耦合是源码 import 或 package.json 脚本（已用两路取证确认无命中——在 plugins
 *      各目录的 test/、vitest.config.mjs、package.json 里搜 "scripts/check-" 只匹配到各插件
 *      **自己目录内**的 scripts/build.mjs）；
 *   2. 它自己**有独立的检查项/测试覆盖**，不依赖插件测试兜底：
 *      check-docs → docs 项（fast 恒跑）、check-links → links 项（fast 恒跑）、
 *      check-ts-size → ts-size 项 + scripts/test/ts-size.test.mjs、package-lock.json → 无运行时消费者；
 *   3. **仅对「修改」（M）放行**：删除（D）这些文件会让对应门禁直接消失/失效，必须退化全量
 *      才能被本地发现（例：删 check-ts-size.mjs 且本次无 .ts 变更时，fast 会跳过 ts-size 项）。
 *
 * package-lock.json 单独说明：lockfile 只被 `npm ci/install` 消费，本地插件测试跑的是
 * **已安装的 node_modules**，lockfile 内容不参与任何插件测试；其变更由 CI 的 npm ci 覆盖。
 */
export const PLUGIN_TEST_IRRELEVANT_FILES = new Set([
  'package-lock.json',
  'scripts/check-docs.mjs',
  'scripts/check-links.mjs',
  'scripts/check-ts-size.mjs',
])

/**
 * package.json 顶层字段里**纯元数据**的部分：改这些字段不会改变任何插件测试结果
 * （不参与依赖解析、不改任何脚本、不改变模块类型/引擎要求）。
 * 白名单之外的任何字段变化都视为「可能影响运行时」→ 退化全量。
 */
export const PACKAGE_JSON_METADATA_FIELDS = new Set([
  'description',
  'keywords',
  'author',
  'contributors',
  'license',
  'repository',
  'bugs',
  'homepage',
  'funding',
])

/**
 * 受影响闭包的规模上限（占插件总数的比例）：闭包超过一半插件时，「逐个跑依赖闭包」的收益
 * 已接近全量，直接全量更简单、也不给「漏掉某个间接依赖方」留口子。
 *
 * 历史演进（issue #188 用回放统计修正，见 scripts/analyze-impact-replay.mjs）：
 *   · 旧规则 = 直接依赖方数量 ≥ 3 就全量。回放最近 200 提交发现它把 dsh-md-render
 *     （只有 3 个依赖方）的 21 次变更全部顶成全量——而它的**传递闭包**只有 4 个插件；
 *   · 新规则 = 先算传递闭包（依赖方 + 依赖方的依赖方 …），闭包超过一半插件才全量。
 *     闭包 ⊇ 直接依赖方，所以范围只会更准，不会更小。
 */
export const HIGH_FANIN_RATIO = 0.5

/**
 * 解析 `git diff --name-status` 输出（--no-renames：重命名拆成 D + A，更保守也更可预测）。
 * 返回 [{ status, path }]；输入非法行直接跳过（宁少勿错——调用方据空数组会走「无变更证据」路径）。
 */
export function parseNameStatus(out) {
  const result = []
  for (const line of String(out ?? '').split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const status = line.slice(0, tab).trim()
    const path = line.slice(tab + 1)
    if (status === '' || path === '') continue
    result.push({ status: status[0], path })
  }
  return result
}

/**
 * 反向依赖解析器工厂：依赖 plugins/<pluginName> 的插件集合（两路取证，宁多勿少）。
 *   1. package.json 依赖声明——按包名（"dsh-shared": "^0.1.0"）或 file 路径匹配；
 *   2. 源码 import/require——本仓库存在「源码 import 了 dsh-shared 但 package.json 未声明」
 *      的情况（15 个插件 import、仅 6 个声明），只查 package.json 会漏检。
 *
 * 抽到本模块（issue #188）：pre-push 与回放统计脚本（scripts/analyze-impact-replay.mjs）
 * 必须共用同一份依赖图口径，否则两边算出的「受影响插件」会对不上。
 */
export function createDependentsResolver(root, plugins) {
  const SOURCE_SCAN_CACHE = new Map()

  /** 插件包名映射：目录名 → package.json name（本仓库两者一致，仍按实际值匹配以免未来漂移）。 */
  const PLUGIN_NAMES = new Map()
  for (const name of plugins) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'plugins', name, 'package.json'), 'utf8'))
      PLUGIN_NAMES.set(name, pkg.name ?? name)
    } catch {
      PLUGIN_NAMES.set(name, name)
    }
  }

  /**
   * 反向依赖：依赖 plugins/<pluginName> 的插件集合（两路取证，宁多勿少）。
   *   1. package.json 依赖声明——按包名（`"dsh-shared": "^0.1.0"`）或 file 路径匹配；
   *   2. 源码 import/require——本仓库存在「源码 import 了 dsh-shared 但 package.json 未声明」
   *      的情况（15 个插件 import、仅 6 个声明），只查 package.json 会漏检。
   */
  function dependentsOf(pluginName) {
    const result = new Set()
    const pkgName = PLUGIN_NAMES.get(pluginName) ?? pluginName
    const sourceCache = (name) => {
      if (!SOURCE_SCAN_CACHE.has(name)) {
        const dirs = [join(root, 'plugins', name, 'lib'), join(root, 'plugins', name, 'src')]
        const texts = []
        for (const dir of dirs) {
          if (!existsSync(dir)) continue
          try {
            for (const entry of readdirSync(dir, { recursive: true })) {
              const file = join(dir, String(entry))
              if (!/\.(mjs|cjs|js|ts|tsx)$/.test(file)) continue
              if (file.includes('/test/') || file.includes('/coverage/')) continue
              texts.push(readFileSync(file, 'utf8'))
            }
          } catch {
            /* 目录不可读：忽略该目录 */
          }
        }
        SOURCE_SCAN_CACHE.set(name, texts)
      }
      return SOURCE_SCAN_CACHE.get(name)
    }

    for (const name of plugins) {
      if (name === pluginName) continue
      if (result.has(name)) continue
      let hit = false
      try {
        const pkg = JSON.parse(readFileSync(join(root, 'plugins', name, 'package.json'), 'utf8'))
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
        hit = Object.entries(deps).some(([dep, spec]) => {
          if (dep === pkgName) return true
          return typeof spec === 'string' && (spec.includes(`plugins/${pluginName}`) || spec.includes(`/${pluginName}`))
        })
      } catch {
        /* package.json 不可读：继续走源码扫描 */
      }
      if (!hit) {
        // 匹配 import ... from 'dsh-shared' / require('dsh-shared') / from '../dsh-shared'
        const re = new RegExp(`(?:from|require\\()\\s*['"](?:\\.\\.?/)*${pluginName}['"]`)
        hit = sourceCache(name).some((text) => re.test(text))
      }
      if (hit) result.add(name)
    }
    return result
  }

  return dependentsOf
}

/**
 * git diff base...HEAD 的变更文件（含状态）；失败返回 null。
 *
 * 关键实现点：
 *   · --diff-filter=ACMRD 里的 **D（删除）是 issue #188 补的**：漏掉 D 会让「删掉
 *     plugins/foo/lib/x.js」这类提交整条不出现在变更列表 → 该插件的测试跑 0 个却退出 0，
 *     而 CI matrix 仍会跑（本地假绿）；
 *   · --no-renames 把重命名拆成 D + A 两条，语义更保守，也免掉 R100\told\tnew 三列格式的
 *     解析分支；
 *   · -c core.quotepath=false 让中文路径按原样输出（本仓库 docs/ 大量中文名），否则 git 输出
 *     C 风格转义路径，影响面规则的前缀匹配（docs/、plugins/）会全部失配。
 *
 * @param base 比较基准（ref）
 * @param runGit (args: string[]) => { ok: boolean, out: string }，由调用方注入（便于单测）
 */
export function listChangedFiles(base, runGit) {
  const r = runGit([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-status',
    '--no-renames',
    '--diff-filter=ACMRD',
    base + '...HEAD',
  ])
  if (!r.ok) return null
  return parseNameStatus(r.out)
}

/**
 * 对比 package.json 变更前后的文本，返回**发生变化的非元数据字段**名（升序）。
 *   - 返回 [] = 只有元数据变化（description/keywords/…），不影响插件测试 → 可收窄；
 *   - 返回非空数组 = 有运行时语义字段（dependencies/scripts/…）变化 → 必须退化；
 *   - 返回 null = 无法判定（JSON 解析失败/旧版本不存在）→ 调用方按退化处理。
 */
export function diffPackageJsonRuntimeFields(beforeText, afterText) {
  let before
  let after
  try {
    before = JSON.parse(beforeText)
    after = JSON.parse(afterText)
  } catch {
    return null
  }
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return null
  if (Array.isArray(before) || Array.isArray(after)) return null
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed = []
  for (const key of keys) {
    if (PACKAGE_JSON_METADATA_FIELDS.has(key)) continue
    // 序列化比较：键顺序不同会被判为「变化」——只会更保守（退化全量），不会漏检
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key)
  }
  return changed.sort()
}

const escalate = (reasons, plugins) => ({ plugins: new Set(plugins), escalated: true, reasons, docsOnly: false })

/** 插件变更的「受影响闭包」：自身 + 直接依赖方 + 依赖方的依赖方 …（含传递依赖）。 */
export function closureOf(pluginName, dependentsOf, plugins) {
  const seen = new Set([pluginName])
  const queue = [pluginName]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const dependent of dependentsOf(current)) {
      if (seen.has(dependent) || !plugins.includes(dependent)) continue
      seen.add(dependent)
      queue.push(dependent)
    }
  }
  return seen
}

/** 闭包规模上限：超过插件总数的一半就退化全量（下限 4，避免小仓库里阈值过窄）。 */
export function scopedLimit(plugins) {
  return Math.max(4, Math.ceil(plugins.length * HIGH_FANIN_RATIO))
}

/** 单条变更的处理结果：'plugin'（已纳入）/ 'escalate' / 'counted'（仅计数）/ 'other-root'。 */
function classify(entry, opts, state) {
  const { path: file, status } = entry
  const pluginMatch = /^plugins\/([^/]+)\//.exec(file)
  if (pluginMatch) {
    const name = pluginMatch[1]
    if (!opts.plugins.includes(name)) {
      // 插件目录当前已不存在：只有「删除」会走到这里（新增/修改必然有对应目录）。
      // 删除会改变依赖图（可能有插件依赖它），而当前工作区已无从推断旧依赖方 → 全量。
      if (status === 'D') {
        state.reasons.push(`删除 plugins/${name}/**（该插件当前已不存在）→ 依赖图已变、无法推断旧依赖方，全量`)
        return 'escalate'
      }
      return 'counted'
    }
    // 受影响闭包（含传递依赖）替代旧的「直接依赖方数量 ≥ 3 就全量」：
    // 闭包 ⊇ 直接依赖方（范围只增不减），闭包过大时仍退化全量（见 HIGH_FANIN_RATIO）。
    const closure = closureOf(name, opts.dependentsOf, opts.plugins)
    const limit = scopedLimit(opts.plugins)
    if (closure.size > limit) {
      state.reasons.push(
        `plugins/${name}/** 的受影响闭包有 ${closure.size} 个插件（上限 ${limit} / 共 ${opts.plugins.length} 个）→ 裁剪无意义，全量`,
      )
      return 'escalate'
    }
    const extra = [...closure].filter((n) => n !== name).sort()
    for (const dep of closure) state.affected.add(dep)
    if (extra.length > 0) state.reasons.push(`plugins/${name}/** 变更 → 额外纳入依赖闭包：${extra.join('、')}`)
    return 'plugin'
  }
  if (PLUGIN_TEST_IRRELEVANT_FILES.has(file)) {
    // 白名单仅对 M/A 放行；删除（D）会让对应门禁消失 → 进取退化路径
    if (status === 'D') {
      state.rootToolchain.push(file)
      return 'counted'
    }
    state.reasons.push(`${file} 与插件测试结果无关（无插件测试引用，且有独立检查项覆盖）→ 不扩大插件测试范围`)
    state.irrelevant += 1
    return 'counted'
  }
  if (file === 'package.json') {
    const fields = opts.packageJsonRuntimeFields
    if (status === 'M' && Array.isArray(fields) && fields.length === 0) {
      state.reasons.push('package.json 仅元数据字段变化（description/keywords/…）→ 不改变插件测试结果')
      state.irrelevant += 1
      return 'counted'
    }
    state.rootToolchain.push(file)
    return 'counted'
  }
  if (file.startsWith('scripts/')) {
    // 校验/发版脚本变更：可能影响任何插件结果，保守全量（白名单已在上面提前返回）
    state.rootToolchain.push(file)
    return 'counted'
  }
  if (ROOT_TOOLCHAIN_FILES.has(file)) {
    state.rootToolchain.push(file)
    return 'counted'
  }
  if (isRuntimeIrrelevant(file)) {
    state.docOnly += 1
    return 'counted'
  }
  state.otherRoot.push(file)
  return 'other-root'
}

const summarize = (list, max = 3) => `${list.slice(0, max).join('、')}${list.length > max ? '…' : ''}`

/**
 * 计算受影响插件集合。
 * @param changed [{ status, path }] | null（null = git diff 失败）
 * @param opts {
 *   plugins: string[],                   当前存在的插件目录名
 *   dependentsOf: (name) => Iterable,    反向依赖查询
 *   packageJsonRuntimeFields?: string[] | null   package.json 变化的非元数据字段
 * }
 * @returns { plugins: Set<string>, escalated: boolean, reasons: string[], docsOnly: boolean }
 *   escalated = true 表示必须全量（无证据可裁剪）
 */
export function computeImpactScope(changed, opts) {
  if (changed === null) {
    return escalate(['无法获取变更文件列表（git diff 失败）'], opts.plugins)
  }
  const state = { reasons: [], affected: new Set(), rootToolchain: [], otherRoot: [], docOnly: 0, irrelevant: 0 }
  for (const entry of changed) {
    if (classify(entry, opts, state) === 'escalate') return escalate(state.reasons, opts.plugins)
  }

  if (state.irrelevant > 0)
    state.reasons.push(`其中 ${state.irrelevant} 个与插件测试结果无关的变更：不影响插件测试范围`)
  if (state.docOnly > 0) state.reasons.push(`其中文档/skill/CI 配置 ${state.docOnly} 个：不影响插件测试范围`)
  if (state.rootToolchain.length > 0) {
    state.reasons.push(`根工具链/校验脚本变更（${summarize(state.rootToolchain)}）→ 无法安全裁剪，全量`)
    return escalate(state.reasons, opts.plugins)
  }
  if (state.otherRoot.length > 0) {
    state.reasons.push(`仓库根文件变更（${summarize(state.otherRoot)}）→ 全量`)
    return escalate(state.reasons, opts.plugins)
  }
  const docsOnly = changed.length > 0 && state.docOnly === changed.length
  if (docsOnly) state.reasons.push('本次变更为纯文档/skill/CI 配置 → 跳过一切与插件源码相关的检查')
  return { plugins: state.affected, escalated: false, reasons: state.reasons, docsOnly }
}
