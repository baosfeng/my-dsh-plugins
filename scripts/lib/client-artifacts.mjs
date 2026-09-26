/**
 * client-artifacts.mjs — 「共享件 → 消费方产物」一致性判据（issue #318）。
 *
 * 背景（ADR-0002 明确警告过的坑）：`plugins/dsh-shared/client-parts/*.part.js` 是**纯函数声明
 * 文本片段**，构建期被各消费方的 `scripts/build.mjs` 按占位符 splice 进 `lib/client.js`。
 * 本仓库 CI 不跑构建（只 `node --check` + 测试），所以「改了共享件但漏重建某个消费方」可以
 * 长期潜伏，表现为**插件间行为漂移**：2026-09 实测 commit 735e2fa 加了 3 个图标
 * （arrowUp / powerOff / powerOn），只重建了 my-notify + my-plugin-manager，file-activity 与
 * my-observability 的产物少 27 行图标（这正是 #318 的起因）。
 *
 * 本模块只做**纯解析与判定**（读文件、跑构建由调用方注入），便于单测直接构造
 * 「改了 part 不重建 → 判定漂移」的用例；CLI 在 scripts/check-client-artifacts.mjs。
 *
 * 判定语义（fail-closed）：某消费方的产物与「构建期输入被替换成当前共享件后的期望内容」
 * 不一致 → 漂移。比较基准是 **git 已提交版本**，因为门禁要回答的是
 * 「提交的产物与当前共享件是否同源」，而不是「工作区是否干净」。
 */

/** 只需读取前若干字节即可判定差异，不必把几 MB 产物全载入内存。 */
const MAX_SNIPPET_BYTES = 4096

/**
 * 消费方 build.mjs 里注入共享部件的 PARTS 表条目：`[placeholder, 'xxx.part.js', opts?]`。
 * 三种实际存在的写法都要覆盖（#318 实测）：
 *   'icons.part.js'（think-zh-expand 等）· 'icons.part'（my-guard / my-guardian / my-notify）·
 *   'icons'（file-activity，同一 PARTS 表里 shared: true）。
 * 只匹配「以 .part / .part.js 结尾」或「恰好等于某个真实共享件 basename」的字符串，
 * 其余字符串（占位符、普通片段名）交给调用方与磁盘真实文件名求交集过滤。
 */
const PART_REF_RE = /'([A-Za-z0-9_][A-Za-z0-9_.\-]*?)'/g
const PART_EXT = /\.part(\.js)?$/

/**
 * 从 build.mjs 源码里解析出「候选部件引用」。
 *
 * 为什么不用 `\bp\b\.part` 去扫整文件：那会把注释里的示例、测试里的字符串也算进来
 * （假阳性）。这里要求引用出现在**单引号字符串**里且以 `.part` / `.part.js` 结尾，
 * 再由调用方与磁盘上的真实共享件文件名求交集——两道限制把误报压到 0。
 */
export function parsePartRefs(buildSource) {
  const found = new Set()
  // 注意：matchAll 要求 /g，但**绝不能复用带 lastIndex 的同一个正则对象**——实测
  // 「多个 build.mjs 连续解析」时第二个文件会从错误的 lastIndex 继续，漏掉引用
  // （issue #318 开发期踩到：消费方数量 11 → 8）。这里用 new RegExp 每次取全新实例。
  for (const m of String(buildSource).matchAll(new RegExp(PART_REF_RE.source, 'g'))) found.add(m[1])
  return found
}

/**
 * 找出「消费共享部件」的插件：其 `scripts/build.mjs` 引用了 `sharedNames` 里的文件。
 *
 * @param {Record<string,string>} buildSources 插件名 → build.mjs 源码（缺 scripts/build.mjs 的插件不传）
 * @param {string[]} sharedNames dsh-shared/client-parts 下的真实文件名（如 icons.part.js）
 * @returns {Array<{plugin:string, parts:string[]}>} 按插件名排序
 */
export function findClientArtifactConsumers(buildSources, sharedNames) {
  const shared = new Set(sharedNames)
  const out = []
  for (const [plugin, source] of Object.entries(buildSources ?? {})) {
    const parts = new Set()
    for (const ref of parsePartRefs(source)) {
      // 三种实际写法归一（见 PART_REF_RE 注释）：
      //   'icons.part.js'（原样）· 'icons.part'（补 .js）· 'icons'（补 .part.js 与 .js）
      const candidates = PART_EXT.test(ref) ? [ref, `${ref}.js`] : [ref, `${ref}.js`, `${ref}.part.js`]
      for (const candidate of candidates) {
        if (shared.has(candidate)) parts.add(candidate)
      }
    }
    if (parts.size > 0) out.push({ plugin, parts: [...parts].sort() })
  }
  return out.sort((a, b) => a.plugin.localeCompare(b.plugin))
}

/** 差异摘要：首个不同字节的上下文 + 两侧字节数（失败信息要能直接定位，而不是只报"不一致"）。 */
export function describeDrift(expected, actual) {
  const size = Math.min(expected.length, actual.length)
  let at = -1
  for (let i = 0; i < size; i += 1) {
    if (expected[i] !== actual[i]) {
      at = i
      break
    }
  }
  if (at === -1 && expected.length === actual.length) return null
  const from = at === -1 ? size : at
  const snippet = (buf) =>
    JSON.stringify(buf.subarray(Math.max(0, from - 40), from + 120).toString('utf8')).slice(0, 200)
  if (at === -1) {
    return `长度不同：期望 ${expected.length} 字节 / 实际 ${actual.length} 字节（前缀一致，尾部多出或缺失）`
  }
  return `首个差异 @字节 ${at}（期望 ${expected.length} / 实际 ${actual.length}）：期望 ${snippet(expected)} vs 实际 ${snippet(actual)}`
}

/**
 * 逐消费方判定产物一致性。
 *
 * @param {Array<{plugin:string, parts:string[]}>} consumers
 * @param {(plugin:string) => {expected:Buffer|null, actual:Buffer|null}} readArtifacts
 *        期望 = 以当前共享件重建后的内容；实际 = 已提交（HEAD）的产物
 * @returns {{ok:boolean, checked:number, drifted:Array<{plugin:string,parts:string[],reason:string}>}}
 */
export function evaluateClientArtifacts(consumers, readArtifacts) {
  const drifted = []
  for (const { plugin, parts } of consumers) {
    const { expected, actual } = readArtifacts(plugin)
    if (expected === null) {
      drifted.push({ plugin, parts, reason: '缺少构建后的产物（lib/client.js 未生成）' })
      continue
    }
    if (actual === null) {
      drifted.push({ plugin, parts, reason: '仓库里没有已提交的产物（lib/client.js 未纳入版本控制）' })
      continue
    }
    const reason = describeDrift(expected, actual)
    if (reason !== null) drifted.push({ plugin, parts, reason })
  }
  return { ok: drifted.length === 0, checked: consumers.length, drifted }
}

/** 渲染失败报告（CI/本地共用；超限截断由调用方决定）。 */
export function renderClientArtifactReport({ checked, drifted }, { maxPlugins = 8 } = {}) {
  const lines = []
  lines.push(`❌ 客户端产物与共享件不同源：${drifted.length}/${checked} 个消费方漂移`)
  lines.push('   修复：在对应插件目录跑 `node scripts/build.mjs` 并提交 lib/client.js（ADR-0002）')
  for (const d of drifted.slice(0, maxPlugins)) {
    lines.push(`   · ${d.plugin}（共享件：${d.parts.join(', ')}）`)
    lines.push(`     ${d.reason}`)
  }
  if (drifted.length > maxPlugins) lines.push(`   …其余 ${drifted.length - maxPlugins} 个见上文格式（已截断）`)
  return lines.join('\n')
}
