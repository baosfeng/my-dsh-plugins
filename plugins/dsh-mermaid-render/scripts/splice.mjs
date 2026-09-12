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
