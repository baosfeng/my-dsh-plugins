/**
 * 方案 B' 防回归：verify-local 的「疑似并发冲突 → 串行复测一次」必须
 *   ① 覆盖**所有并发执行的检查项**（不只是插件测试池）；
 *   ② 只在**命中并发冲突特征**时触发（绝不退化成「所有失败都重试一次」，那会掩盖真实回归）；
 *   ③ 复测仍失败 → 仍然报红；不命中特征的真失败 → 不触发复测、直接报红。
 *
 * 三类场景（对应任务书的「3 类场景」）在本文件里各有独立用例 + 断言；
 * 运行时真实行为另有端到端实证（`node scripts/verify-local.mjs --only <id>` 注入假检查项）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  formatRetryFailures,
  planSerialRetry,
  requestedConcurrency,
  retriedCandidate,
  retryNote,
  runCheckPoolWithRetry,
  serialRetryEnabled,
} from '../lib/verify-serial-retry.mjs'
import { looksLikeConcurrencyConflict } from '../lib/verify-flaky-classify.mjs'

/** 真实形态的检查项结果（test-scripts 在并发下的实测假红文本）。 */
const conflictResult = (id, over = {}) => ({
  id,
  label: id,
  ok: false,
  code: 1,
  stage: id,
  out: "FAIL scripts/test/ci-tools-server-reap.test.mjs\nError: ENOENT: no such file or directory, open 'coverage/tmp/x.json'",
  error: '',
  extra: [],
  ms: 100,
  ...over,
})

/** 真实形态的**非并发**失败（真回归：断言/构建错误）。 */
const realFailureResult = (id, over = {}) => ({
  id,
  label: id,
  ok: false,
  code: 1,
  stage: id,
  out: 'check-client-size 失败：dsh-md-render 体积超基线 12%（基线 40KB，实测 44.8KB）',
  error: '',
  extra: [],
  ms: 100,
  ...over,
})

/** 并发执行器替身：记录并发度，按给定结果表返回。 */
const poolStub = (scripted) => {
  const calls = []
  const runPool = async (tasks, limit, onDone) => {
    calls.push({ limit, size: tasks.length })
    return tasks.map((t) => {
      const r = scripted[t.id]
      onDone?.(r)
      return r
    })
  }
  return { runPool, calls }
}

test("方案B' 场景①：命中并发特征 → 触发串行复测，复测通过则整体通过", async () => {
  const fail = conflictResult('test-scripts')
  const pass = { id: 'test-scripts', label: 'test-scripts', ok: true, code: 0, out: '44/44 通过', extra: [], ms: 80 }
  const { runPool, calls } = poolStub({ 'test-scripts': fail })
  const printed = []
  const retried = []

  const results = await runCheckPoolWithRetry({
    tasks: [{ id: 'test-scripts' }],
    concurrency: 4,
    runPool,
    runOne: async () => pass,
    looksLikeConflict: looksLikeConcurrencyConflict,
    log: (m) => printed.push(m),
    onRetried: (e) => retried.push(e),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].limit, 4, '首轮按配置并发 4')
  assert.equal(retried.length, 1, '命中特征应触发 1 次复测')
  assert.equal(retried[0].ok, true)
  assert.equal(results[0].ok, true, '复测通过 → 该项最终为通过')
  assert.equal(results[0].retriedSerial, true, '结果带标记，报告里可区分「首轮失败但已复测」')
  const text = printed.join('\n')
  assert.match(text, /检测到疑似并发冲突 → 串行复测/, '复测必须打印（非静默）')
  assert.match(text, /串行复测通过/, '复测翻转要显式打印')
})

test("方案B' 场景②：命中特征但复测仍失败 → 仍报红（不掩盖真实回归）", async () => {
  const fail = conflictResult('test-scripts', { out: 'Error: ENOENT: ... cov', code: 1 })
  const again = { ...fail, ms: 90 }
  const { runPool } = poolStub({ 'test-scripts': fail })
  const printed = []

  const results = await runCheckPoolWithRetry({
    tasks: [{ id: 'test-scripts' }],
    concurrency: 4,
    runPool,
    runOne: async () => again,
    looksLikeConflict: looksLikeConcurrencyConflict,
    log: (m) => printed.push(m),
  })

  assert.equal(results[0].ok, false, '复测仍失败 → 判红')
  assert.equal(results[0].retriedSerial, true)
  assert.match(printed.join('\n'), /串行复测仍失败（判定为真实失败/, '必须打印「复测仍失败」')
  assert.match(formatRetryFailures(results), /test-scripts 首轮失败（疑似并发冲突）→ 已串行复测，仍未通过/)
})

test("方案B' 场景③：不命中特征的真失败 → 不触发复测、直接报红", async () => {
  const real = realFailureResult('client-size')
  const { runPool } = poolStub({ 'client-size': real })
  let runOneCalls = 0
  const printed = []

  const results = await runCheckPoolWithRetry({
    tasks: [{ id: 'client-size' }],
    concurrency: 4,
    runPool,
    runOne: async () => {
      runOneCalls += 1
      return { ...real, ok: true }
    },
    looksLikeConflict: looksLikeConcurrencyConflict,
    log: (m) => printed.push(m),
  })

  assert.equal(runOneCalls, 0, '未命中并发特征 → 一次复测都不许跑（否则真实回归被一次绿色复测掩盖）')
  assert.equal(results[0].ok, false, '直接判红')
  assert.equal(results[0].retriedSerial, undefined)
  assert.equal(printed.filter((m) => m.includes('串行复测')).length, 0, '不打印复测横幅')
})

test("方案B' 多个失败项：只有命中特征的那个被复测", async () => {
  const conflict = conflictResult('test-scripts')
  const real = realFailureResult('client-size')
  const { runPool } = poolStub({ 'test-scripts': conflict, 'client-size': real })
  const ran = []
  const results = await runCheckPoolWithRetry({
    tasks: [{ id: 'test-scripts' }, { id: 'client-size' }],
    concurrency: 4,
    runPool,
    runOne: async (task) => {
      ran.push(task.id)
      return { id: task.id, ok: true, extra: [], ms: 1 }
    },
    looksLikeConflict: looksLikeConcurrencyConflict,
    log: () => {},
  })
  assert.deepEqual(ran, ['test-scripts'], '复测集合 = 命中特征的失败项，不多不少')
  const byId = Object.fromEntries(results.map((r) => [r.id, r]))
  assert.equal(byId['test-scripts'].ok, true)
  assert.equal(byId['client-size'].ok, false, '真失败项保持红')
  assert.deepEqual(results.map((r) => r.id).sort(), ['client-size', 'test-scripts'], '结果集合与原地替换不丢项、不乱序')
})

test("方案B' 复测闸门：首轮本就串行 / VERIFY_NO_RETRY=1 / 超时预算耗尽 → 不复测", async () => {
  const entries = [
    { name: '并发 1（首轮无争用，复测等于放宽判据）', args: { concurrency: 1, noRetry: undefined } },
    { name: 'VERIFY_NO_RETRY=1（显式关闭）', args: { concurrency: 4, noRetry: '1' } },
  ]
  for (const { name, args } of entries) {
    const { runPool } = poolStub({ 'test-scripts': conflictResult('test-scripts') })
    let runOneCalls = 0
    const results = await runCheckPoolWithRetry({
      tasks: [{ id: 'test-scripts' }],
      runPool,
      runOne: async () => {
        runOneCalls += 1
        return { id: 'test-scripts', ok: true, extra: [], ms: 1 }
      },
      looksLikeConflict: looksLikeConcurrencyConflict,
      log: () => {},
      ...args,
    })
    assert.equal(runOneCalls, 0, `${name}：不得复测`)
    assert.equal(results[0].ok, false, `${name}：保持判红（不放宽判据）`)
  }

  // 超时预算已耗尽：印出提示但不复测（避免拖死整体看门狗）
  const { runPool } = poolStub({ 'test-scripts': conflictResult('test-scripts') })
  let runOneCalls = 0
  const printed = []
  await runCheckPoolWithRetry({
    tasks: [{ id: 'test-scripts' }],
    concurrency: 4,
    runPool,
    runOne: async () => {
      runOneCalls += 1
      return { id: 'test-scripts', ok: true, extra: [], ms: 1 }
    },
    looksLikeConflict: looksLikeConcurrencyConflict,
    deadlineAt: 1000,
    now: () => 2000,
    log: (m) => printed.push(m),
  })
  assert.equal(runOneCalls, 0, '预算耗尽 → 不复测')
  assert.match(printed.join('\n'), /整体超时预算已耗尽 → 跳过串行复测/, '跳过也要打印（非静默）')
})

test("方案B' 判据纯函数：并发度解析 / 特征筛选 / 渲染", () => {
  assert.equal(requestedConcurrency(undefined), null)
  assert.equal(requestedConcurrency(''), null)
  assert.equal(requestedConcurrency('4'), 4)
  assert.equal(requestedConcurrency('abc'), null, '非法值不当作「开启了复测」')
  assert.equal(requestedConcurrency('0'), null)

  assert.equal(serialRetryEnabled({ requested: 6 }), true)
  assert.equal(serialRetryEnabled({ requested: 1 }), false)
  assert.equal(serialRetryEnabled({ requested: 6, noRetry: '1' }), false)
  assert.equal(serialRetryEnabled({ requested: 6, noRetry: '0' }), true, '只有严格等于 1 才关闭')

  const ok = { id: 'a', ok: true }
  const conflict = conflictResult('b')
  const real = realFailureResult('c')
  assert.deepEqual(
    planSerialRetry([ok, conflict, real], { enabled: true, looksLikeConflict: looksLikeConcurrencyConflict }).map(
      (r) => r.id,
    ),
    ['b'],
    '只挑「失败 + 命中特征」的项',
  )
  assert.deepEqual(
    planSerialRetry([ok, conflict], { enabled: false, looksLikeConflict: looksLikeConcurrencyConflict }),
    [],
  )
  assert.equal(retriedCandidate({ id: 'x', ok: false }).retriedSerial, true)
  assert.match(retryNote({ label: 'x', ok: true, ms: 12 }), /串行复测通过/)
  assert.match(retryNote({ label: 'x', ok: false, ms: 12 }), /串行复测仍失败/)
  assert.equal(formatRetryFailures([ok, { id: 'y', ok: false, retriedSerial: true }]).includes('y'), true)
})
