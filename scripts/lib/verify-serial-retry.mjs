/**
 * 「疑似并发冲突 → 串行复测一次」的通用执行器（方案 B'，issue 跟进 #402 的池化推广）。
 *
 * 背景：多 agent / 多进程同时跑门禁时，同一个仓库里的两个 vitest 会争用 `coverage/` 与临时目录，
 * 表现为「首轮失败、隔离复跑全绿」的**假红**（实测：pre-push 报 10 通过 / 1 失败挡住推送，
 * 几十秒后原样重跑同一项却全绿）。此前 verify-local 只对**插件测试池**做了这件事
 * （内联在 runPluginTests 里），而**检查项并发池**里的 `npm run test:scripts` 等项
 * （自身就是 vitest + coverage）没有这层保护 → 同样的假红照旧挡推送。
 *
 * 本模块把该机制抽成**纯编排**（无 IO、无进程、无计时），两个池共用同一份实现，
 * 并用注入的 `runOne` / `now` / `log` 保证可单测（见 scripts/test/verify-serial-retry.test.mjs
 * 的三类防回归场景：命中→复测通过 / 命中→复测仍失败 / 不命中→不复测直接判红）。
 *
 * 三条不可动摇的纪律：
 *   ① **只在命中并发特征时复测**（判据见 lib/verify-flaky-classify.mjs），绝不变成
 *      「所有失败都重试一次」——那会把真实回归掩盖成一次绿色复测；
 *   ② 复测**只在首轮就是并发执行时才做**（串行跑本来就没有争用，复测等于放宽判据）；
 *   ③ 复测**必须打印**（不静默），且复测仍失败即判红，报告里显式标注「首轮曾失败」。
 */

/** 复测尝试（给调用方渲染/断言用）：{ key, label, ok, ms, note }。 */
export const retryKey = (result) => result?.id ?? result?.name ?? '(未知项)'

/**
 * 是否存在并发争用（= 才需要串行复测）。
 * 首轮串行时不存在争用，复测没有意义。
 * 纯字符串比较，不做 trim —— 显式值写错时宁可当「未开启复测」也不静默放宽判据。
 * @param {string|undefined} requested
 */
export const requestedConcurrency = (requested) => {
  const raw = requested === undefined || requested === null ? '' : String(requested)
  if (raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 该次执行是否启用「疑似并发冲突 → 串行复测」。
 * `requested` 是**首次执行实际使用的**并发度（检查项池 / 插件测试池各自的来源）。
 */
export const serialRetryEnabled = ({ noRetry, requested }) => {
  if (String(noRetry ?? '') === '1') return false
  const n = requestedConcurrency(requested)
  return n !== null && n > 1
}

/**
 * 挑出「失败且特征疑似并发冲突」的复测候选。
 * @param {Array} results 首轮结果
 * @param {object} opts { enabled, looksLikeConflict, candidates? }
 */
export const planSerialRetry = (results, { enabled, looksLikeConflict, candidates }) => {
  if (!enabled) return []
  const list = typeof candidates === 'function' ? candidates(results) : results
  return list.filter((r) => r && r.ok === false && looksLikeConflict(r))
}

/** 复测后的候选（写入结果对象，便于报告区分「首轮失败但已复测」）。 */
export const retriedCandidate = (result) => ({ ...result, retriedSerial: true })

/** 单条复测结果渲染（非静默：通过与否都打印，含耗时）。 */
export const retryNote = ({ label, ok, ms }) =>
  ok
    ? `✓ ${label}（${ms}ms）串行复测通过（首轮失败=疑似并发冲突，非真实回归）`
    : `✗ ${label}（${ms}ms）串行复测仍失败（判定为真实失败，非并发冲突）`

/** 复测后仍失败的项 → 汇总错误文本。调用方拼进自己的输出。 */
export const formatRetryFailures = (results) =>
  results
    .filter((r) => r && r.ok === false && r.retriedSerial)
    .map((r) => `── ${retryKey(r)} 首轮失败（疑似并发冲突）→ 已串行复测，仍未通过 ──`)
    .join('\n')

/**
 * 并发跑一个池 → 只对「命中并发冲突特征」的失败项串行复测一次。
 *
 * @param {object} params
 * @param {Array} params.tasks        任务数组
 * @param {number} params.concurrency 首轮并发度（同时决定是否开启复测）
 * @param {Function} params.runPool   并发执行器 (tasks, limit, onDone) => Promise<results>
 * @param {Function} params.runOne     复测单任务 (task, index) => Promise<result>
 * @param {Function} params.looksLikeConflict 并发冲突判据
 * @param {string} [params.noRetry]   VERIFY_NO_RETRY 的值
 * @param {number} [params.deadlineAt] 整体超时时刻（Date.now() 刻度；超过则跳过复测，不拖死看门狗）
 * @param {Function} [params.now]     取时刻（单测注入）
 * @param {Function} [params.onDone]  首轮每个任务完成回调
 * @param {Function} [params.onRetried] 每次复测完成回调 ({ task, result, ms, ok, note })
 * @param {Function} [params.log]     打印（默认不打印，由调用方注入 verify-local 的 log）
 * @returns {Promise<Array>} 结果数组（复测过的项已就地替换，并带 retriedSerial: true）
 */
export const runCheckPoolWithRetry = async ({
  tasks,
  concurrency,
  runPool,
  runOne,
  looksLikeConflict,
  noRetry,
  deadlineAt,
  now = () => Date.now(),
  onDone,
  onRetried,
  log,
}) => {
  const enabled = serialRetryEnabled({ noRetry, requested: concurrency })
  const listed = await runPool(tasks, concurrency, onDone)
  // 结果按完成顺序返回 → 与 tasks 的下标不对应；改按 id/name 定位（两个池都保证唯一）。
  const results = [...listed]
  const candidates = planSerialRetry(listed, { enabled, looksLikeConflict })
  if (candidates.length === 0) return results

  if (deadlineAt !== undefined && now() >= deadlineAt) {
    log?.(`⚠ 检测到 ${candidates.length} 个疑似并发冲突的失败，但整体超时预算已耗尽 → 跳过串行复测（避免拖死看门狗）`)
    return results
  }

  log?.('')
  log?.(`⚠ 检测到疑似并发冲突 → 串行复测（${candidates.length} 个失败项命中特征，逐个独占重跑以排除相互争用）`)
  for (const candidate of candidates) log?.(`  - ${retryKey(candidate)}`)
  log?.('')
  for (const candidate of candidates) {
    const index = results.findIndex((r) => retryKey(r) === retryKey(candidate))
    const task = index >= 0 ? tasks[index] : undefined
    const started = now()
    const fresh = await runOne(task, index)
    const ms = now() - started
    // 定位失败（理论上不该发生）时只打印复测结果、不写回，绝不静默丢弃一次真实执行。
    if (index >= 0) results[index] = retriedCandidate(fresh)
    const note = retryNote({ label: retryKey(candidate), ok: fresh?.ok === true, ms })
    log?.(note)
    onRetried?.({ task, result: fresh, ms, ok: fresh?.ok === true, note })
  }
  log?.('')
  return results
}
