/**
 * GitHub compare 数据 → commits.txt / reverts.txt 行文本（materialize-npm.mjs 用）。
 *
 * 为什么单独成模块：这两个文件的内容**逐字来自 HTTP**（`api.github.com` 的
 * `commits[].commit.message` 等字段），随后被 `writeFileSync` 落盘。CodeQL
 * js/http-to-file-access 标注的正是这条"网络数据 → 文件"路径。
 *
 * 判定与处置：属**设计使然**（本脚本的产物就是"两个版本之间的提交清单"），
 * 因此不做"阻断"，而是把不可信字段**净化后再写**：
 *   · 控制字符（含换行/回车/制表/NUL 与 DEL）→ 空格或删除，杜绝伪造行、注入终端转义序列；
 *   · 单字段长度截断，避免超长消息把产物撑爆；
 *   · 每条提交固定输出一行 `sha 日期 首行摘要`，结构由本模块保证，输入只能落在字段里。
 *
 * 为什么能被单测直接覆盖：宿主脚本 materialize-npm.mjs 顶层直接跑 npm view/install，
 * import 它就产生副作用，不适合当测试宿主（与 ./github-repo.mjs 同样的理由）。
 */

/** 单字段上限（防御性截断：提交消息可以任意长，产物不需要全量正文）。 */
const MAX_FIELD_CHARS = 200

/**
 * 单次响应最多落盘的提交条数。
 *
 * 取值理由：GitHub compare API 一页最多返回 250 条提交，1000 = 4 倍余量——正常响应
 * 永远够用，只有异常/恶意响应（数组被塞到成千上万条）才会被截断。截断保留**最前面**
 * 的若干条且不改变顺序（与 API 返回顺序一致，不做重排序）。
 */
const MAX_COMMITS = 1000

/**
 * 净化单个不可信字段：换行类字符 → 空格，其余控制字符与显示控制符 → 删除，再按上限截断。
 *
 * 覆盖三类"能穿透朴素净化"的字符（都只影响人工阅读，不参与执行/路径构造）：
 *   · `\r\n\t`；
 *   · U+2028/U+2029（LINE/PARAGRAPH SEPARATOR）——部分消费者按行分隔处理，可用来伪造行；
 *   · C0/C1 控制字符与 DEL——终端转义序列注入；
 *   · 双向控制符 U+202A–U+202E / U+2066–U+2069——只用于显示重排，属 Trojan Source 类显示欺骗。
 */
export function scrubField(value, max = MAX_FIELD_CHARS) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  // eslint 风格：先把换行/制表（含语义等同换行的 U+2028/U+2029）折成空格，
  // 再删掉其余 C0/C1 控制字符、DEL 与双向控制符。
  const flattened = text.replace(/[\r\n\t\u2028\u2029]+/g, ' ')
  const stripped = flattened.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
  return stripped.slice(0, max)
}

/** 把一次 GitHub compare 响应的 commits 映射成 commits.txt 的行数组（超出 MAX_COMMITS 的部分丢弃）。 */
export function commitLines(commits) {
  if (!Array.isArray(commits)) return []
  return commits.slice(0, MAX_COMMITS).map((c) => {
    const sha = scrubField(c?.sha, 10)
    const date = scrubField(c?.commit?.author?.date, 10)
    const message = scrubField(String(c?.commit?.message ?? '').split('\n')[0])
    return `${sha} (${date}) ${message}`
  })
}

/** 从 commits.txt 的行里挑出 revert 行（判定与老实现一致：行内含 revert）。 */
export function revertLines(lines) {
  return lines.filter((line) => /revert/i.test(line))
}
