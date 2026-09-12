/**
 * dsh-my-memory — memory_delete 工具 + 删除确认门测试（issue #192）。
 *
 * 覆盖：工具注册 / 参数与输出 schema（复用 #191 的 MEMORY_ITEM_SCHEMA）、
 * 按 id 删除（global/project 范围与会话 cwd 定位）、删除不存在 id 的明确
 * 失败语义、以及「记忆绝不静默变更」——删除必须过 tools/pre-execute 确认门，
 * 未确认/被拒绝时条目仍在（防回归）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEMORY_ITEM_SCHEMA, createMemoryQueryTool, createMemorySaveGate, createMemorySaveTool } from '../lib/tool.js'
import { createMemoryDeleteTool, lookupDeleteTarget, renderDeleteResult } from '../lib/delete-tool.js'
import { createStore } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'dmm-delete-test-'))
process.env.DSH_HOME = dir

/** 记录日志的假 logger（审计断言用）。 */
function createLogger() {
  const lines = { info: [], warn: [] }
  return {
    lines,
    info: (message) => lines.info.push(message),
    warn: (message) => lines.warn.push(message),
  }
}

/** 真实 store 夹具：global + 按 cwd 隔离的 project store。 */
function realMemory() {
  const suffix = Math.random().toString(36).slice(2, 8)
  const globalStore = createStore({ file: join(dir, `global-${suffix}.json`) })
  const projectStores = new Map()
  const getProjectStore = async (cwd) => {
    if (!projectStores.has(cwd)) {
      projectStores.set(cwd, createStore({ file: join(dir, `project-${suffix}-${projectStores.size}.json`) }))
    }
    return projectStores.get(cwd)
  }
  const logger = createLogger()
  return {
    saveTool: createMemorySaveTool({ globalStore, getProjectStore, config: {}, logger }),
    deleteTool: createMemoryDeleteTool({ globalStore, getProjectStore, logger }),
    queryTool: createMemoryQueryTool({ globalStore, getProjectStore }),
    globalStore,
    getProjectStore,
    logger,
  }
}

/** 宿主审批语义下的单次受门控调用：ask 未被批准即视为用户拒绝（工具不执行）。 */
async function callGated(gate, tool, args, exec, approve) {
  const payload = { name: tool.name, arguments: args, ...(exec ?? {}) }
  const decision = await gate(payload, async () => ({ kind: 'allow' }))
  if (decision.kind === 'deny') throw new Error(`denied: ${decision.reason}`)
  if (decision.kind === 'ask' && approve !== true) throw new Error('user rejected the approval request')
  return tool.execute(args, exec ?? {})
}

/** 会话日志折叠用的假 session（宿主 Session 的 seq + eventAt 契约）。 */
function sessionWith(events) {
  return { seq: events.length, eventAt: (index) => events[index] }
}

const NEVER_SESSION = sessionWith([{ type: 'approval/policy', data: { policy: 'never' } }])
const ASK_SESSION = sessionWith([{ type: 'approval/policy', data: { policy: 'ask' } }])

function deleteExec(session, id = 'mem-1') {
  return { name: 'memory_delete', arguments: { id, scope: 'global' }, agent: { id: 'sess-del', session } }
}

function runGate(gate, exec) {
  return gate(exec, async () => ({ kind: 'allow' }))
}

test('memory_delete registers an id-required tool reusing the shared item schema (#192)', () => {
  const { deleteTool } = realMemory()
  assert.equal(deleteTool.name, 'memory_delete')
  const params = deleteTool.parameters
  assert.equal(params.type, 'object')
  assert.deepEqual(params.required, ['id'], 'only id is required')
  assert.equal(params.properties.id.type, 'string')
  assert.deepEqual(params.properties.scope.enum, ['global', 'project'], 'scope enum mirrors save')
  assert.equal(params.properties.cwd.type, 'string')
  assert.equal(params.additionalProperties, false)
  const schema = deleteTool.output.schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['scope', 'cwd', 'projectRoot', 'item'], 'delete output fields')
  assert.equal(schema.properties.item, MEMORY_ITEM_SCHEMA, 'delete item reuses the shared item schema (#191)')
  assert.equal(typeof deleteTool.execute, 'function', 'execute callable')
})

test('memory_delete removes the entry and returns what was deleted (#192)', async () => {
  const { saveTool, deleteTool, queryTool } = realMemory()
  const doomed = await saveTool.execute({ scope: 'global', desc: '要删掉的条目', category: 'preference' }, {})
  await saveTool.execute({ scope: 'global', desc: '要留着的条目' }, {})
  const removed = await deleteTool.execute({ id: doomed.item.id, scope: 'global' }, {})
  assert.equal(removed.scope, 'global')
  assert.equal(removed.item.id, doomed.item.id, 'the removed entry is returned for the model receipt')
  assert.equal(removed.item.desc, '要删掉的条目')
  assert.equal(removed.item.category, 'preference', 'the removed entry keeps its metadata')
  const query = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(query.items.length, 1, 'only the requested entry is gone')
  assert.equal(query.items[0].desc, '要留着的条目')
})

test('memory_delete defaults its scope to global (#192)', async () => {
  const { saveTool, deleteTool, queryTool } = realMemory()
  const saved = await saveTool.execute({ scope: 'global', desc: '默认范围删除' }, {})
  await deleteTool.execute({ id: saved.item.id }, {})
  const query = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(query.items.length, 0, 'a scope-less delete targets the global store')
})

test('memory_delete locates project memories by explicit cwd and by the session cwd (#192)', async () => {
  const { saveTool, deleteTool, queryTool } = realMemory()
  const cwd = join(dir, 'proj-del')
  mkdirSync(cwd, { recursive: true })
  const explicit = await saveTool.execute({ scope: 'project', cwd, desc: '显式目录约定' }, {})
  const exec = { agent: { id: 'sess-p', session: { header: { cwd } } } }
  const fromSession = await saveTool.execute({ scope: 'project', desc: '会话目录约定' }, exec)
  const global = await saveTool.execute({ scope: 'global', desc: '全局保留' }, {})
  await deleteTool.execute({ id: explicit.item.id, scope: 'project', cwd }, {})
  await deleteTool.execute({ id: fromSession.item.id, scope: 'project' }, exec)
  const project = await queryTool.execute({ scope: 'project', cwd }, {})
  assert.equal(project.items.length, 0, 'both project entries removed')
  const after = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(after.items.length, 1, 'a project deletion never touches global memory')
  assert.equal(after.items[0].id, global.item.id)
})

test('memory_delete fails loudly for a missing id, an empty id and a project without cwd (#192)', async () => {
  const { saveTool, deleteTool, queryTool } = realMemory()
  const saved = await saveTool.execute({ scope: 'global', desc: '保留条目' }, {})
  await assert.rejects(() => deleteTool.execute({ id: 'mem-404', scope: 'global' }, {}), /not found/)
  await assert.rejects(() => deleteTool.execute({ id: 'mem-404', scope: 'global' }, {}), /mem-404/)
  await assert.rejects(() => deleteTool.execute({ id: '   ', scope: 'global' }, {}), /id is required/)
  await assert.rejects(
    () => deleteTool.execute({ id: saved.item.id, scope: 'project' }, {}),
    /project scope requires a cwd/,
  )
  const query = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(query.items.length, 1, 'a failed deletion never mutates the store')
})

test('memory_delete logs the removed entry and the calling session (#192 audit trail)', async () => {
  const { saveTool, deleteTool, logger } = realMemory()
  const saved = await saveTool.execute({ scope: 'global', desc: '要删除的条目' }, {})
  await deleteTool.execute({ id: saved.item.id, scope: 'global' }, { agent: { id: 'sess-audit' } })
  const line = logger.lines.info.find((message) => message.includes('已删除'))
  assert.ok(line, `an info line records the deletion: ${logger.lines.info.join(' | ')}`)
  assert.ok(line.includes(saved.item.id), 'the log names the removed item')
  assert.ok(line.includes('sess-audit'), 'the log names the calling session')
})

test('renderDeleteResult renders scope, category, desc and id (#192)', () => {
  const text = renderDeleteResult({
    scope: 'global',
    cwd: '',
    projectRoot: '',
    item: { id: 'mem-1', desc: '用 pnpm 装依赖', category: 'preference' },
  })
  assert.ok(text.includes('已删除全局记忆'), 'scope label')
  assert.ok(text.includes('偏好'), 'category label')
  assert.ok(text.includes('用 pnpm 装依赖'), 'desc')
  assert.ok(text.includes('mem-1'), 'id')
})

test('lookupDeleteTarget resolves the pending desc and stays undefined for a missing id (#192)', async () => {
  const { saveTool, globalStore, getProjectStore } = realMemory()
  const saved = await saveTool.execute({ scope: 'global', desc: '用 pnpm 装依赖' }, {})
  const deps = { globalStore, getProjectStore }
  assert.equal(await lookupDeleteTarget({ id: saved.item.id, scope: 'global' }, deps), '用 pnpm 装依赖')
  assert.equal(await lookupDeleteTarget({ id: 'mem-nope', scope: 'global' }, deps), undefined)
})

// ── 确认门（记忆绝不静默变更）─────────────────────────────────────────

test('the gate asks before memory_delete and names the pending entry (#192)', async () => {
  const gate = createMemorySaveGate({ lookupTarget: async () => '用 pnpm 装依赖' })
  const decision = await gate({ name: 'memory_delete', arguments: { id: 'mem-1', scope: 'global' } }, async () => ({
    kind: 'allow',
  }))
  assert.equal(decision.kind, 'ask', 'memory_delete raises the native approval')
  assert.ok(decision.reason.includes('删除'), `reason is about deletion: ${decision.reason}`)
  assert.ok(decision.reason.includes('用 pnpm 装依赖'), 'reason shows the entry being deleted')
  assert.ok(decision.reason.includes('mem-1'), 'reason shows the entry id')
  assert.ok(decision.reason.includes('不可撤销'), 'reason warns the deletion is irreversible')
  assert.ok(!decision.reason.includes('保存'), 'a deletion reason never talks about saving')
})

test('the gate still asks when the target cannot be read (never a silent delete) (#192)', async () => {
  const gate = createMemorySaveGate({ lookupTarget: async () => undefined })
  const decision = await gate({ name: 'memory_delete', arguments: { id: 'mem-gone', scope: 'global' } }, async () => ({
    kind: 'allow',
  }))
  assert.equal(decision.kind, 'ask', 'an unreadable target still requires consent')
  assert.ok(decision.reason.includes('mem-gone'), 'reason still names the id')
})

test('delete goes through the gate: rejected keeps the entry, approved removes it (#192)', async () => {
  const r = realMemory()
  const saved = await r.saveTool.execute({ scope: 'global', desc: '用 pnpm 装依赖' }, {})
  const gate = createMemorySaveGate({
    lookupTarget: (args) =>
      lookupDeleteTarget(args, { globalStore: r.globalStore, getProjectStore: r.getProjectStore }),
  })
  await assert.rejects(
    () => callGated(gate, r.deleteTool, { id: saved.item.id, scope: 'global' }, {}, false),
    /rejected/,
    'a rejected approval aborts the call',
  )
  let query = await r.queryTool.execute({ scope: 'global' }, {})
  assert.equal(query.items.length, 1, 'a rejected deletion never removes the entry')
  await callGated(gate, r.deleteTool, { id: saved.item.id, scope: 'global' }, {}, true)
  query = await r.queryTool.execute({ scope: 'global' }, {})
  assert.equal(query.items.length, 0, 'an approved deletion removes the entry')
})

test('gate: auto + policy=never lets memory_delete through like memory_save (#208/#192)', async () => {
  const gate = createMemorySaveGate({ config: { saveApproval: 'auto' } })
  const decision = await runGate(gate, deleteExec(NEVER_SESSION))
  assert.equal(decision.kind, 'allow', 'danger-full-access deletes without an ask gate, same as saving')
})

test('gate: auto + policy=ask keeps the native confirmation for deletes (#192)', async () => {
  const gate = createMemorySaveGate({ config: { saveApproval: 'auto' } })
  const decision = await runGate(gate, deleteExec(ASK_SESSION))
  assert.equal(decision.kind, 'ask', 'workspace-write still asks before deleting')
})

test('gate: always + policy=never denies the deletion with an actionable hint (#192)', async () => {
  const gate = createMemorySaveGate({ config: { saveApproval: 'always' } })
  const decision = await runGate(gate, deleteExec(NEVER_SESSION))
  assert.equal(decision.kind, 'deny', 'always cannot ask under policy=never → explicit deny')
  for (const needle of ['删除', 'danger-full-access', 'saveApproval', 'workspace-write', 'auto']) {
    assert.ok(decision.reason.includes(needle), `hint mentions "${needle}": ${decision.reason}`)
  }
})

test('gate: saveApproval=never deletes without confirmation in every preset (#192)', async () => {
  for (const session of [ASK_SESSION, NEVER_SESSION, undefined]) {
    const gate = createMemorySaveGate({ config: { saveApproval: 'never' } })
    const decision = await runGate(gate, deleteExec(session))
    assert.equal(decision.kind, 'allow', 'saveApproval=never never asks before deleting')
  }
})

test('gate: unrelated tools still pass through untouched with delete support on (#192)', async () => {
  const gate = createMemorySaveGate()
  const downstream = { kind: 'allow' }
  const pass = await gate({ name: 'memory_query', arguments: { scope: 'global' } }, async () => downstream)
  assert.equal(pass, downstream)
})

test('gate: memory_delete without args or exec still asks (fail-safe, #192)', async () => {
  const gate = createMemorySaveGate()
  const decision = await gate({ name: 'memory_delete' }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'ask', 'a malformed delete call still requires consent')
})

test('cleanup', () => {
  rmSync(dir, { recursive: true, force: true })
})
