/**
 * 「测试里的固定时长等待」判定（issue #335）—— 纯函数，供 scripts/check-test-sleeps.mjs 与单测使用。
 *
 * ## 为什么要有这个门禁
 *
 * `setTimeout(ms)` / `settle(ms)` 是「我不知道什么时候完成」的自白。同一个根因在 CI 上
 * **复发过 5 次**（#310 / #313 / #317 / #335），每次的修法都一样（实现侧补就绪信号 +
 * 测试侧条件轮询），但每次都是人肉发现、人肉扫。**只要"新增一个固定 sleep"不需要任何
 * 解释就能通过评审，第 6 次只是时间问题。** 本门禁把默认反转过来：新增的固定时长等待
 * 必须写下「为什么不能用条件轮询」的理由，否则 CI 红。
 *
 * ## 分类判据（issue #335 要求「每一类都要有判据」）
 *
 * | 类别 | 判据（AST 层面） | 处置 |
 * | --- | --- | --- |
 * | `yield` 让出事件循环 | 延时实参是字面量 `0`（`setTimeout(fn, 0)`、`new Promise(r => setTimeout(r, 0))`） | **安全**：`setTimeout(0)` 必然晚于已排队的 microtask，语义精确且与机器负载无关 |
 * | `fixed` 固定时长等异步 | 延时实参是**非零数字字面量**（`setTimeout(fn, 50)`、`settle(80)`、`sleep(200)`） | **受管**：必须有 `// sleep-ok: <理由>`，否则违规 |
 * | `dynamic` 动态延时 | 延时实参是标识符/表达式（轮询工具里的 `interval`、`delayMs`） | 不阻断（无法静态判定），仅在报告里列出供 review |
 *
 * 「测试框架自身超时」（vitest 的 `{ timeout: N }`）与「mock 定时器」
 * （`vi.advanceTimersByTime`）不是 `setTimeout(fn, ms)` 调用形态，天然不在扫描面内 ——
 * 判据是**有没有等待真实墙钟**，不是"有没有出现数字"。
 */

/** 需要识别的「固定等待」包装函数名（各插件 helpers 里的历史命名，统一后仅 test-kit/wait.mjs 的 sleepFor）。 */
const SLEEP_WRAPPERS = new Set(['settle', 'sleep', 'sleepMs', 'delay', 'pause', 'wait', 'sleepFor'])

/** 豁免标记：必须写在同一行或紧邻上一行。 */
const EXEMPT_MARK = 'sleep-ok:'

/** 理由最短长度（`// sleep-ok: x` 这类敷衍不算理由）。 */
const MIN_REASON = 8

/** 从注释文本里取豁免理由（无则 undefined）。 */
function exemptReason(text) {
  const idx = text.indexOf(EXEMPT_MARK)
  if (idx === -1) return undefined
  return text.slice(idx + EXEMPT_MARK.length).trim()
}

/** 延时实参 → { category, delay }；非字面量归 dynamic。 */
function classifyDelay(node) {
  if (node === undefined || node === null) return { category: 'yield', delay: 0 }
  if (node.type === 'NumericLiteral') {
    return node.value === 0 ? { category: 'yield', delay: 0 } : { category: 'fixed', delay: node.value }
  }
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'NumericLiteral') {
    return { category: 'dynamic', delay: undefined }
  }
  return { category: 'dynamic', delay: undefined }
}

/** 取调用节点的名字（标识符或成员表达式的属性名）。 */
function calleeName(callee) {
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') return callee.property.name
  return undefined
}

/**
 * 从一个 CallExpression 提取「固定等待点」（不是则返回 undefined）。
 * 覆盖两种形态：`setTimeout(fn, ms)` 与 `settle(ms)` / `sleepFor(reason, ms)`。
 */
function waitFromCall(node) {
  const name = calleeName(node.callee)
  if (name === 'setTimeout' || name === 'setInterval') {
    return { argIndex: 1, name, reasonArgIndex: -1 }
  }
  if (SLEEP_WRAPPERS.has(name)) {
    // sleepFor(reason, ms) 把时长放第二个参数，其余放第一个
    const reasonArgIndex = name === 'sleepFor' ? 0 : -1
    return { argIndex: reasonArgIndex === 0 ? 1 : 0, name, reasonArgIndex }
  }
  return undefined
}

/** `sleepFor('理由', ms)` 的第一个参数本身就是豁免理由（运行时强制非空）。 */
function inlineReason(node, reasonArgIndex) {
  if (reasonArgIndex < 0) return undefined
  const arg = node.arguments?.[reasonArgIndex]
  if (arg?.type !== 'StringLiteral') return undefined
  const text = arg.value.trim()
  return text.length >= MIN_REASON ? text : undefined
}

/** 把 AST 节点位置转成 1-based 行号（babel 的 loc 已是 1-based）。 */
function lineOf(node) {
  return node.loc?.start?.line ?? 0
}

/**
 * 扫描一份源码，返回全部等待点。
 * @param source 源码文本
 * @param parse 解析函数（注入以便单测；默认用 @babel/parser）
 */
export function findWaits(source, parse) {
  const ast = parse(source)
  const lines = source.split('\n')
  const found = []
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node.type === 'string') {
      if (node.type === 'CallExpression') {
        const wait = waitFromCall(node)
        if (wait !== undefined) {
          const { category, delay } = classifyDelay(node.arguments?.[wait.argIndex])
          const startLine = lineOf(node)
          const endLine = node.loc?.end?.line ?? startLine
          const text = lines[startLine - 1] ?? ''
          // 豁免标记可写在同一行（调用起始行或结束行）或紧邻上一行
          const reason =
            exemptReason(text) ??
            exemptReason(lines[endLine - 1] ?? '') ??
            exemptReason(lines[startLine - 2] ?? '') ??
            inlineReason(node, wait.reasonArgIndex)
          found.push({
            line: startLine,
            text: text.trim(),
            callee: wait.name,
            category,
            delay,
            exempt: reason !== undefined && reason.length >= MIN_REASON,
            reason,
          })
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue
        visit(node[key])
      }
    }
  }
  visit(ast.program ?? ast)
  return found
}

/** 基线条目：文件 + 行内容指纹（行号会漂移，指纹不会）。 */
export function fingerprint(relativePath, text) {
  let hash = 0
  const normalized = text.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0
  }
  return `${relativePath}::${(hash >>> 0).toString(16)}`
}

/**
 * 判定扫描结果。
 * @param entries [{ file, waits }] —— file 为仓库相对路径
 * @param baseline 已冻结的指纹数组（存量豁免）
 */
export function auditWaits(entries, baseline = []) {
  const remaining = [...baseline]
  const takeFromBaseline = (id) => {
    const idx = remaining.indexOf(id)
    if (idx === -1) return false
    remaining.splice(idx, 1)
    return true
  }
  const violations = []
  const exempted = []
  const dynamic = []
  const counts = { yield: 0, fixed: 0, dynamic: 0 }
  for (const entry of entries) {
    for (const wait of entry.waits) {
      counts[wait.category] += 1
      if (wait.category === 'yield') continue
      if (wait.category === 'dynamic') {
        dynamic.push({ file: entry.file, ...wait })
        continue
      }
      const record = { file: entry.file, ...wait }
      if (wait.exempt) {
        exempted.push(record)
        continue
      }
      if (takeFromBaseline(fingerprint(entry.file, wait.text))) continue
      violations.push(record)
    }
  }
  return { violations, exempted, dynamic, counts, staleBaseline: remaining }
}

/** 违规的修法提示（每个类别都指向对应的正确做法）。 */
export function fixHint(violation) {
  return (
    `${violation.file}:${violation.line} 固定等待 ${violation.callee}(${violation.delay}ms) 无豁免理由。\n` +
    '      改法（按判据选，不要调大数字）：\n' +
    '        · 等异步结果出现 → 实现侧就绪信号（store.whenReady()）或 waitFor(条件, { message })\n' +
    '        · 让出事件循环 → yieldLoop()（等价 setTimeout(0)，与负载无关）\n' +
    '        · 真实时间语义（防抖窗口）/ 断言某事没发生 → sleepFor("理由", ms) 或写 // sleep-ok: <为什么不能用条件轮询>\n' +
    '      统一工具：plugins/dsh-shared/test-kit/wait.mjs'
  )
}
