/**
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
 * 读取源码里 NAME = '...' 这种**字符串字面量赋值**的取值。
 *
 * 用途是构建后校验：确认注入结果真的落进了字符串字面量，而不是注释 ——
 * issue #185 扩展里占位符曾写成注释形，替换后 base64 全在块注释里，「占位符已替换」
 * 成立但常量恒为空串、内联引擎永远加载不了。所以校验必须落到**取值**，而不是
 * 「占位符没了」。用 indexOf 逐字符跳过空白，不在 4.5 MB 单行产物上跑正则。
 *
 * @param {string} source 待检查的源码文本
 * @param {string} name 常量名（独立标识符）
 * @returns {string|null} 字面量取值；该名字不是字符串字面量赋值时返回 null
 */
export function readAssignedStringLiteral(source, name) {
  const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
  let from = 0
  for (;;) {
    const at = source.indexOf(name, from)
    if (at === -1) return null
    from = at + name.length
    // 必须是独立标识符：前一个字符不能是标识符字符（避免匹配到 MyMERMAID_UMD_B64）
    if (at > 0 && /[\w$]/.test(source[at - 1])) continue
    let i = from
    while (i < source.length && isSpace(source[i])) i++
    if (source[i] !== '=') continue
    i++
    while (i < source.length && isSpace(source[i])) i++
    // 找到了 `NAME =`：取值不是字符串字面量（例如落在块注释里）→ 明确返回 null
    if (source[i] !== "'") return null
    const end = source.indexOf("'", i + 1)
    return end === -1 ? null : source.slice(i + 1, end)
  }
}
