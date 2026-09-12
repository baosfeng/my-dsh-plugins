/**
 * dsh-my-memory — 保存策略判定单测（issue #208）。
 *
 * 覆盖两个纯函数：
 *  - `approvalPolicyOf`：会话审批策略判定（宿主 approval 服务探针优先，
 *    回落到会话日志 approval/policy 折返——与宿主
 *    `ApprovalService.overrideOf` 同构）；
 *  - `decideSaveGate`：saveApproval 三态 × policy 两态 的决策矩阵。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { approvalPolicyOf, decideSaveGate } from '../lib/save-policy.js'

/** 会话日志折叠用的假 session（seq + eventAt，与宿主 Session 同构）。 */
function sessionWith(events) {
  return { seq: events.length, eventAt: (index) => events[index] }
}

const NEVER_EVENT = { type: 'approval/policy', data: { policy: 'never' } }
const ASK_EVENT = { type: 'approval/policy', data: { policy: 'ask' } }

function saveExec(session, id = 'sess-1') {
  return { name: 'memory_save', arguments: { scope: 'global', desc: 'x' }, agent: { id, session } }
}

test('approvalPolicyOf: no session (or no exec) is unknown', () => {
  assert.equal(approvalPolicyOf(undefined), undefined)
  assert.equal(approvalPolicyOf({}), undefined)
  assert.equal(approvalPolicyOf({ agent: {} }), undefined)
})

test('approvalPolicyOf: folds the last approval/policy event of the session log', () => {
  assert.equal(approvalPolicyOf(saveExec(sessionWith([NEVER_EVENT]))), 'never')
  assert.equal(approvalPolicyOf(saveExec(sessionWith([ASK_EVENT]))), 'ask')
  assert.equal(approvalPolicyOf(saveExec(sessionWith([NEVER_EVENT, ASK_EVENT]))), 'ask', 'the last logged policy wins')
  assert.equal(
    approvalPolicyOf(saveExec(sessionWith([ASK_EVENT, NEVER_EVENT]))),
    'never',
    'a later switch to never is honored',
  )
})

test('approvalPolicyOf: a session without an approval/policy event defaults to ask', () => {
  const session = sessionWith([{ type: 'turn/start', data: {} }])
  assert.equal(approvalPolicyOf(saveExec(session)), 'ask', 'host approval config default is ask')
})

test('approvalPolicyOf: an unfoldable session is unknown (fail-safe)', () => {
  assert.equal(approvalPolicyOf(saveExec({})), undefined, 'no seq/eventAt → unknown')
  assert.equal(approvalPolicyOf(saveExec({ seq: 3 })), undefined, 'no eventAt → unknown')
  assert.equal(
    approvalPolicyOf(saveExec({ seq: NaN, eventAt: () => NEVER_EVENT })),
    undefined,
    'non-finite seq → unknown',
  )
})

test('approvalPolicyOf: the approval-service probe wins over the log fold', () => {
  const session = sessionWith([ASK_EVENT])
  assert.equal(
    approvalPolicyOf(saveExec(session), () => 'never'),
    'never',
    'probe overrides the fold',
  )
  assert.equal(
    approvalPolicyOf(saveExec(sessionWith([])), () => 'ask'),
    'ask',
    'probe answers without a log event',
  )
})

test('approvalPolicyOf: an unusable probe falls back to the log fold', () => {
  const session = sessionWith([NEVER_EVENT])
  assert.equal(
    approvalPolicyOf(saveExec(session), () => undefined),
    'never',
  )
  assert.equal(
    approvalPolicyOf(saveExec(session), () => 'sometimes'),
    'never',
    'rogue probe value ignored',
  )
  assert.equal(
    approvalPolicyOf(saveExec(session), () => {
      throw new Error('approval service exploded')
    }),
    'never',
    'a throwing probe never breaks the gate',
  )
})

test('approvalPolicyOf: an unknown policy event value keeps folding', () => {
  const session = sessionWith([NEVER_EVENT, { type: 'approval/policy', data: { policy: 'rogue' } }])
  assert.equal(approvalPolicyOf(saveExec(session)), 'never', 'rogue values are skipped')
})

test('decideSaveGate: auto writes silently under never and asks under ask', () => {
  const never = decideSaveGate({
    args: { scope: 'global', desc: 'x' },
    policy: 'never',
    config: { saveApproval: 'auto' },
  })
  assert.equal(never.kind, 'allow', 'auto + never → silent write')
  const ask = decideSaveGate({ args: { scope: 'global', desc: 'x' }, policy: 'ask', config: { saveApproval: 'auto' } })
  assert.equal(ask.kind, 'ask', 'auto + ask → native confirmation')
})

test('decideSaveGate: always denies with an actionable hint under never', () => {
  const denied = decideSaveGate({
    args: { scope: 'project', desc: '项目约定' },
    policy: 'never',
    config: { saveApproval: 'always' },
  })
  assert.equal(denied.kind, 'deny')
  assert.ok(denied.reason.includes('danger-full-access'), 'names the preset')
  assert.ok(denied.reason.includes('saveApproval'), 'names the plugin setting')
  assert.ok(denied.reason.includes('workspace-write'), 'names the alternative preset')
})

test('decideSaveGate: never mode bypasses the confirmation in every policy', () => {
  for (const policy of ['ask', 'never', undefined]) {
    const decision = decideSaveGate({ args: { scope: 'global', desc: 'x' }, policy, config: { saveApproval: 'never' } })
    assert.equal(decision.kind, 'allow', `never + ${policy} → silent write`)
  }
})

test('decideSaveGate: an unknown/absent policy keeps the native ask in auto', () => {
  for (const config of [{ saveApproval: 'auto' }, {}, undefined, { saveApproval: 'sometimes' }]) {
    const decision = decideSaveGate({ args: { scope: 'global', desc: 'x' }, policy: undefined, config })
    assert.equal(decision.kind, 'ask', 'unknown policy → conservative ask')
  }
})

test('decideSaveGate: the ask reason names the scope and the desc snippet', () => {
  const decision = decideSaveGate({
    args: { scope: 'project', desc: '本项目用 pnpm\n第二行' },
    policy: 'ask',
    config: { saveApproval: 'auto' },
  })
  assert.equal(decision.kind, 'ask')
  assert.ok(decision.reason.includes('保存项目记忆'), 'scope label')
  assert.ok(decision.reason.includes('本项目用 pnpm'), 'desc snippet')
  assert.ok(!decision.reason.includes('第二行'), 'snippet is single-line')
  assert.ok(decision.reason.includes('确认'), 'asks for confirmation')
})
