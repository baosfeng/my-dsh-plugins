/**
 * 构建期占位符注入辅助（共享单一来源，issue #186 P2 从 dsh-mermaid-render 收口）：
 * 消费方是各插件的 `scripts/build.mjs`（Node ESM，可直接 import —— 与
 * `client-parts/` 的 client 片段不同，本文件不进浏览器 bundle）。
 *
 * 占位符精确注入：把 `replacement` 写到 `source` 里**恰好一处**占位符位置。
 *
 * 为什么不用 replaceAll（issue #185）：
 * lib/client.src.js 模板顶部的注释曾与 tsc 产物里的引擎占位符**同形**，
 * replaceAll 把两处都换成同一份 4.45 MB base64 → lib/client.js 8,934,938 B、
 * npm 包 13.5 MB（体积翻倍）。当时的门禁只断言"无残留"，而两处都替换后残留
 * 恰好为 0 —— 于是这个缺陷自诞生起静默通过。这里让"不止一处"变成显式失败。
 *
 * 用函数式 replacer（`() => replacement`）而非字符串：字符串 replacer 会把替换值
 * 里的 `$&` / `$1` / `$'` 当特殊模式解释，压缩产物载荷一旦含这些两字符序列
 * 就会被静默改写。
 *
 * @param {string} source 待注入文本
 * @param {string} placeholder 占位符字面量（计数用 split，不受正则元字符影响）
 * @param {string} replacement 注入内容（原样写入，不做特殊模式解释）
 * @param {string} [label] 报错时显示的占位符名，默认取 placeholder 本身
 * @returns {string} 注入后的文本
 * @throws {Error} 占位符出现次数 ≠ 1 时（0 处=拼写漂移；≥2 处=重复注入）
 */
export function spliceExactlyOnce(source, placeholder, replacement, label = placeholder) {
  const found = source.split(placeholder).length - 1
  if (found !== 1) {
    throw new Error(`expected exactly 1 ${label} placeholder, found ${found}`)
  }
  return source.replace(placeholder, () => replacement)
}
/**
 * 判断占位符是否处于**可注入的代码位置**（issue #185 缺陷形态的通用防线，issue #186 P1 复用）。
 *
 * 为什么需要：`spliceExactlyOnce` 只能保证"恰好一处"，不能保证那一处在**代码**里。
 * 占位符曾以注释形出现（模板里写成注释内字面量），替换"成功"、残留为 0，但注入内容
 * 整段落在块注释里 —— 于是常量恒为空串、图标永远不声明，而门禁全绿。
 *
 * 实现：逐字符状态机（不用正则）从文本开头扫到**第一个占位符出现位置**，判定该位置
 * 处于代码 / 行注释 / 块注释 / 字符串字面量中的哪一种。注意不能改成「先剥离注释再
 * includes」：本仓库的占位符本身由块注释定界符包裹（／＊__PART_ICONS__＊／），剥离器
 * 会把占位符整体当成一个空块注释 —— 实测误判，#186 P1 踩到后改为状态机判定。
 * 只用于**小体积模板**（lib/client.src.js），不要在 4.5 MB 单行产物上跑。
 *
 * @param {string} source 模板文本
 * @param {string} placeholder 占位符字面量
 * @returns {boolean} 占位符出现在代码位置（注释或字符串里一律 false）
 */
export function isPlaceholderOutsideComments(source, placeholder) {
  const at = source.indexOf(placeholder)
  if (at === -1) return false
  /** @type {'code'|'line'|'block'|'string'} */
  let state = 'code'
  let quote = ''
  let i = 0
  while (i < at) {
    const ch = source[i]
    const next = source[i + 1]
    if (state === 'line') {
      if (ch === '\n') state = 'code'
      i++
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (state === 'string') {
      if (ch === '\\') {
        i += 2
        continue
      }
      i++
      if (ch === quote) state = 'code'
      continue
    }
    if (ch === '/' && next === '/') {
      state = 'line'
      i += 2
      continue
    }
    if (ch === '/' && next === '*') {
      state = 'block'
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      state = 'string'
      quote = ch
      i++
      continue
    }
    i++
  }
  return state === 'code'
}
