/**
 * issue #402 防复发：verify-local 的「疑似并发冲突 → 串行复测」判定必须覆盖**纯断言失败**。
 *
 * 复现的缺口：修复前 `looksLikeConcurrencyConflict` 只认 coverage/EACCES/ENOENT/超时等特征词，
 * 而全量并发下真实发生的假红是纯 `AssertionError`（guardian 的 setImmediate 忙等提前耗尽、
 * observability 的固定 40ms sleep 不足）→ 判定 false → 跳过串行复测 → 直接判红挡推送。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  looksLikeConcurrencyConflict,
  CONCURRENCY_CONFLICT_RE,
  ASSERTION_FAILURE_RE,
} from '../lib/verify-flaky-classify.mjs'

test('#402 npm test 阶段的纯断言失败被识别为疑似并发冲突（否则跳过复测、假红挡推送）', () => {
  // CI run 36120528494 的真实失败文本（dsh-my-guardian）
  const guardian = {
    stage: 'npm test',
    timedOut: false,
    out: 'FAIL test/host-boot-readiness.mjs > #217 API dispatch never observes a half-loaded startup pre-check\nAssertionError: initialScan 已完成（API 已注册）\n❯ test/host-boot-readiness.mjs:216:12',
    error: '',
  }
  assert.equal(looksLikeConcurrencyConflict(guardian), true, '纯 AssertionError 在 npm test 阶段应触发串行复测')

  // dsh-my-observability：固定 40ms sleep 不足 → cpuPercent 非 number
  const observability = {
    stage: 'npm test',
    timedOut: false,
    out: 'AssertionError [ERR_ASSERTION]: expected undefined to be a number',
    error: '',
  }
  assert.equal(looksLikeConcurrencyConflict(observability), true, 'observability 的断言失败同样应触发复测')
})

test('#402 非并发相关的失败不触发复测（避免掩盖真回归/掩盖语法错误）', () => {
  // node --check 语法错误：与并发无关，必须立即判红
  assert.equal(
    looksLikeConcurrencyConflict({
      stage: 'node --check lib/index.js',
      timedOut: false,
      out: 'SyntaxError: Unexpected token',
      error: '',
    }),
    false,
    '语法错误不是并发伪影，不得复测掩盖',
  )
  // npm test 阶段但没有断言失败的其它错误码（未命中特征词）→ 保持保守
  assert.equal(
    looksLikeConcurrencyConflict({ stage: 'npm test', timedOut: false, out: 'npm ERR! command failed', error: '' }),
    false,
    '非断言失败、非 IO 特征的失败保持保守（不无条件重试）',
  )
})

test('#402 单步超时与既有 IO 特征仍被识别', () => {
  assert.equal(looksLikeConcurrencyConflict({ stage: 'npm test', timedOut: true }), true, '单步超时算并发伪影')
  assert.equal(
    looksLikeConcurrencyConflict({
      stage: 'npm test',
      out: 'Error: EACCES: permission denied, open coverage/x',
      error: '',
    }),
    true,
    'coverage/EACCES 特征保留',
  )
  assert.equal(CONCURRENCY_CONFLICT_RE.test('testTimeout'), true)
  assert.equal(ASSERTION_FAILURE_RE.test('AssertionError: boom'), true)
})
