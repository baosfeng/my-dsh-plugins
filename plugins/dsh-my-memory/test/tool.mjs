/**
 * dsh-my-memory — tool tests: memory_query read-only semantics, scope
 * filtering, keyword filtering, session-cwd resolution, output rendering;
 * memory_save write tool + user-consent approval gate (issue #107).
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MEMORY_ITEM_SCHEMA,
  createMemoryQueryTool,
  createMemorySaveGate,
  createMemorySaveTool,
  filterItems,
  renderQueryResult,
  renderSaveResult,
  saveToolDescription,
} from '../lib/tool.js'
import { createStore, migrateProjectMemory, resolveProjectMemory } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'dmm-tool-test-'))
process.env.DSH_HOME = dir

/** A fake global store with a fixed item list. */
function fakeStore(items) {
  return { list: () => items }
}

/** A fake project-store resolver keyed by cwd. */
function fakeProjectStores(map) {
  return async (cwd) => fakeStore(map.get(cwd) ?? [])
}

const GLOBAL_ITEMS = [
  { id: 'g1', desc: '回复使用中文', createdAt: 1, updatedAt: 2 },
  { id: 'g2', desc: '代码注释用中文', createdAt: 1, updatedAt: 3 },
]
const PROJECT_ITEMS = [{ id: 'p1', desc: '本项目使用 vitest', createdAt: 1, updatedAt: 2 }]
/** store 返回的真实条目字段（memory-scoring 的 withDefaults 恒补齐；issue #191）。 */
const REAL_ITEM_FIELDS = [
  'category',
  'confidence',
  'createdAt',
  'desc',
  'history',
  'id',
  'relatedIds',
  'source',
  'status',
  'updatedAt',
]

test('global query returns the global items (read-only)', async () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const value = await tool.execute({ scope: 'global' }, {})
  assert.equal(value.scope, 'global')
  assert.equal(value.items.length, 2)
  assert.equal(value.items[0].desc, '回复使用中文')
})

test('keyword filter narrows the result (case-insensitive)', async () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const value = await tool.execute({ scope: 'global', keyword: '中文' }, {})
  assert.equal(value.items.length, 2, 'both items contain 中文')
  const narrow = await tool.execute({ scope: 'global', keyword: '代码' }, {})
  assert.equal(narrow.items.length, 1)
  assert.equal(narrow.items[0].id, 'g2')
  const none = await tool.execute({ scope: 'global', keyword: '不存在的词' }, {})
  assert.equal(none.items.length, 0)
})

test('project query resolves the cwd from the calling agent session', async () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map([[dir, PROJECT_ITEMS]])),
  })
  const exec = { agent: { session: { header: { cwd: dir } } } }
  const value = await tool.execute({ scope: 'project' }, exec)
  assert.equal(value.scope, 'project')
  assert.equal(value.cwd, dir)
  assert.equal(value.items.length, 1)
  assert.equal(value.items[0].desc, '本项目使用 vitest')
})

test('project query accepts an explicit cwd argument', async () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map([[dir, PROJECT_ITEMS]])),
  })
  const value = await tool.execute({ scope: 'project', cwd: dir }, {})
  assert.equal(value.cwd, dir)
  assert.equal(value.items.length, 1)
})

test('project query without any cwd returns an empty result', async () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const value = await tool.execute({ scope: 'project' }, {})
  assert.equal(value.cwd, '')
  assert.equal(value.items.length, 0, 'no cwd → no project memories')
})

test('the tool never mutates the stores (read-only)', async () => {
  const globalStore = fakeStore(GLOBAL_ITEMS)
  const tool = createMemoryQueryTool({
    globalStore,
    getProjectStore: fakeProjectStores(new Map([[dir, PROJECT_ITEMS]])),
  })
  await tool.execute({ scope: 'global' }, {})
  await tool.execute({ scope: 'project', cwd: dir }, {})
  assert.equal(globalStore.list().length, 2, 'global store untouched')
})

test('filterItems handles a missing keyword', () => {
  assert.equal(filterItems(GLOBAL_ITEMS, undefined).length, 2)
  assert.equal(filterItems(GLOBAL_ITEMS, '').length, 2)
  assert.equal(filterItems(GLOBAL_ITEMS, '   ').length, 2, 'whitespace keyword → no filter')
  // 空关键词返回原数组引用（不执行过滤）
  assert.equal(filterItems(GLOBAL_ITEMS, ''), GLOBAL_ITEMS, 'empty keyword returns the original array')
})

test('filterItems matches case-insensitively on mixed-case keywords', () => {
  const items = [{ id: 'e1', desc: 'Use Vitest for tests', createdAt: 1, updatedAt: 2 }]
  assert.equal(filterItems(items, 'Vitest').length, 1, 'mixed-case keyword matches')
  assert.equal(filterItems(items, 'vitest').length, 1, 'lowercase keyword matches')
  assert.equal(filterItems(items, 'VITEST').length, 1, 'uppercase keyword matches')
  assert.equal(filterItems(items, 'jest').length, 0, 'non-matching keyword excluded')
})

test('renderQueryResult renders scopes, counts and items', () => {
  const text = renderQueryResult({ scope: 'global', cwd: '', projectRoot: '', items: GLOBAL_ITEMS })
  assert.ok(text.includes('全局记忆'), 'global label')
  assert.ok(text.includes('2 条'), 'count')
  assert.ok(text.includes('回复使用中文'), 'item desc')
  const project = renderQueryResult({
    scope: 'project',
    cwd: dir,
    projectRoot: dir,
    items: PROJECT_ITEMS,
  })
  assert.ok(project.includes('项目记忆'), 'project label')
  assert.ok(project.includes(dir), 'project root shown')
  const empty = renderQueryResult({ scope: 'global', cwd: '', projectRoot: '', items: [] })
  assert.equal(empty, '没有找到全局记忆。', 'empty global result message')
  const unknown = renderQueryResult({ scope: 'project', cwd: '', projectRoot: '', items: [] })
  assert.ok(unknown.includes('项目目录未知'), 'unknown project dir message')
  // 全局 scope 即使带 projectRoot 也不显示项目根（scope 决定 where）
  const globalWithRoot = renderQueryResult({
    scope: 'global',
    cwd: '',
    projectRoot: '/x',
    items: [],
  })
  assert.ok(!globalWithRoot.includes('（项目：'), 'global scope never shows a project root')
})

test('project query tolerates a missing exec (no agent session)', async () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const value = await tool.execute({ scope: 'project' }, undefined)
  assert.equal(value.cwd, '')
  assert.equal(value.items.length, 0, 'no exec → no project memories, no throw')
})

test('the tool schema declares scope required with global/project enum', () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const params = tool.parameters
  assert.equal(params.type, 'object')
  assert.deepEqual(params.required, ['scope'], 'scope is the only required parameter')
  assert.deepEqual(params.properties.scope.enum, ['global', 'project'], 'scope enum')
  assert.equal(params.properties.scope.type, 'string')
  assert.equal(params.properties.keyword.type, 'string', 'keyword is a string')
  assert.equal(params.properties.cwd.type, 'string', 'cwd is a string')
  assert.equal(params.additionalProperties, false, 'no extra parameters')
})

test('the tool output schema declares the query result shape', () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const schema = tool.output.schema
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['scope', 'cwd', 'projectRoot', 'items'], 'top-level fields required')
  const props = schema.properties
  assert.equal(props.scope.type, 'string')
  assert.equal(props.cwd.type, 'string')
  assert.equal(props.projectRoot.type, 'string')
  assert.equal(props.items.type, 'array')
  const itemSchema = props.items.items
  assert.equal(itemSchema, MEMORY_ITEM_SCHEMA, 'query items[] reuse the shared item schema (issue #191)')
  assert.deepEqual(
    Object.keys(itemSchema.properties).sort(),
    REAL_ITEM_FIELDS,
    'item schema fields = real store fields',
  )
  assert.deepEqual([...itemSchema.required].sort(), REAL_ITEM_FIELDS, 'every real field is required')
  const itemProps = itemSchema.properties
  assert.equal(itemProps.id.type, 'string')
  assert.equal(itemProps.desc.type, 'string')
  assert.equal(itemProps.createdAt.type, 'number')
  assert.equal(itemProps.updatedAt.type, 'number')
})

test('the tool render produces text blocks', () => {
  const tool = createMemoryQueryTool({
    globalStore: fakeStore(GLOBAL_ITEMS),
    getProjectStore: fakeProjectStores(new Map()),
  })
  const blocks = tool.output.render(
    { scope: 'global' },
    { scope: 'global', cwd: '', projectRoot: '', items: GLOBAL_ITEMS },
  )
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.ok(blocks[0].text.includes('回复使用中文'))
})

// ── memory_save 写工具 + 用户确认门（issue #107）──────────────────────

/** A save tool bound to real stores (temp dirs) so writes can be verified. */
function realSaveTool(logger) {
  const globalStore = createStore({ file: join(dir, 'memory.json') })
  const projectDir = join(dir, 'proj')
  mkdirSync(join(projectDir, '.git'), { recursive: true })
  const stores = new Map()
  const getProjectStore = async (cwd) => {
    // 与 server 端 getProjectStore 一致：集中路径（issue #108）+ 旧数据迁移
    const { file, legacyFile } = await resolveProjectMemory(cwd)
    let store = stores.get(file)
    if (store === undefined) {
      await migrateProjectMemory({ file, legacyFile })
      store = createStore({ file })
      stores.set(file, store)
    }
    return store
  }
  return {
    tool: createMemorySaveTool({ globalStore, getProjectStore, config: {}, logger }),
    queryTool: createMemoryQueryTool({ globalStore, getProjectStore }),
    stores,
    projectDir,
  }
}

test('memory_save registers a write tool with scope+desc required', () => {
  const { tool } = realSaveTool()
  assert.equal(tool.name, 'memory_save', 'tool name')
  const params = tool.parameters
  assert.equal(params.type, 'object')
  assert.deepEqual(params.required, ['scope', 'desc'], 'scope and desc are required')
  assert.deepEqual(params.properties.scope.enum, ['global', 'project'], 'scope enum')
  assert.equal(params.properties.desc.type, 'string')
  assert.equal(params.properties.cwd.type, 'string')
  assert.equal(params.additionalProperties, false)
  assert.equal(typeof tool.execute, 'function', 'execute callable')
  assert.ok(tool.output.schema.additionalProperties === false, 'output schema closed')
  assert.deepEqual(tool.output.schema.required, ['scope', 'cwd', 'projectRoot', 'item'], 'save output fields')
  assert.equal(tool.output.schema.properties.item, MEMORY_ITEM_SCHEMA, 'save item reuses the shared item schema (#191)')
})

test('memory_save saves into the global store and becomes queryable at once', async () => {
  const { tool, queryTool } = realSaveTool()
  const value = await tool.execute({ scope: 'global', desc: '用户偏好用 pnpm' }, {})
  assert.equal(value.scope, 'global')
  assert.equal(value.cwd, '')
  assert.equal(value.item.desc, '用户偏好用 pnpm')
  assert.ok(value.item.id.startsWith('mem-'), 'generated id')
  // 保存后 memory_query 立即可查（同一 store 的内存缓存即时更新）
  const query = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(query.items.length, 1, 'saved memory immediately queryable')
  assert.equal(query.items[0].desc, '用户偏好用 pnpm')
})

test('memory_save accepts a project scope with an explicit cwd', async () => {
  const { tool, queryTool, projectDir } = realSaveTool()
  const value = await tool.execute({ scope: 'project', cwd: projectDir, desc: '本项目使用 pnpm' }, {})
  assert.equal(value.scope, 'project')
  assert.equal(value.cwd, projectDir)
  assert.equal(value.item.desc, '本项目使用 pnpm')
  const query = await queryTool.execute({ scope: 'project', cwd: projectDir }, {})
  assert.equal(query.items.length, 1)
  assert.equal(query.items[0].desc, '本项目使用 pnpm')
  // 全局不受影响
  const global = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(global.items.length, 0, 'project save isolated from global')
})

test('memory_save resolves the project cwd from the calling agent session', async () => {
  const { tool, queryTool, projectDir } = realSaveTool()
  const exec = { agent: { session: { header: { cwd: projectDir } } } }
  await tool.execute({ scope: 'project', desc: '会话目录约定' }, exec)
  const query = await queryTool.execute({ scope: 'project' }, exec)
  assert.equal(query.items.length, 1)
  assert.equal(query.items[0].desc, '会话目录约定')
})

test('memory_save rejects empty desc and project-without-cwd with clear errors', async () => {
  const { tool } = realSaveTool()
  await assert.rejects(() => tool.execute({ scope: 'global', desc: '   ' }, {}), /desc is required/)
  await assert.rejects(() => tool.execute({ scope: 'project', desc: 'x' }, {}), /project scope requires a cwd/)
})

test('the approval gate answers memory_save with an ask gate', async () => {
  const gate = createMemorySaveGate()
  const callback = { called: false, decision: null }
  const next = async () => {
    callback.called = true
    callback.decision = { kind: 'allow' }
    return callback.decision
  }
  const decision = await gate({ name: 'memory_save', arguments: { scope: 'global', desc: '回复使用中文' } }, next)
  assert.equal(callback.called, true, 'next() invoked first (waterfall contract)')
  assert.equal(decision.kind, 'ask', 'memory_save raises an ask gate')
  assert.ok(decision.reason.includes('保存全局记忆'), 'reason names the target scope')
  assert.ok(decision.reason.includes('回复使用中文'), 'reason shows the desc snippet')
  assert.ok(decision.reason.includes('确认'), 'reason asks for confirmation')
})

test('the approval gate passes unrelated tools through untouched', async () => {
  const gate = createMemorySaveGate()
  const decision = { kind: 'allow' }
  const next = async () => decision
  const pass = await gate({ name: 'memory_query', arguments: { scope: 'global' } }, next)
  assert.equal(pass, decision, 'downstream decision returned as-is for other tools')
  const passProject = await gate({ name: 'bash', arguments: { command: 'ls' } }, next)
  assert.equal(passProject, decision, 'bash tool also untouched')
})

test('the approval gate tolerates a missing exec and missing args', async () => {
  const gate = createMemorySaveGate()
  const decision = { kind: 'allow' }
  const next = async () => decision
  const pass = await gate(undefined, next)
  assert.equal(pass, decision, 'no exec → pass through')
  const ask = await gate({ name: 'memory_save' }, next)
  assert.equal(ask.kind, 'ask', 'memory_save without args still asks for consent')
})

test('saveToolDescription switches with proactivePropose (default off)', () => {
  const plain = saveToolDescription(undefined)
  assert.ok(plain.includes('需用户确认'), 'default description mentions user consent')
  assert.ok(!plain.includes('主动向用户提议'), 'default: no proactive proposal guidance')
  const proactive = saveToolDescription(true)
  assert.ok(proactive.includes('主动向用户提议'), 'proactivePropose on guides proactive saving')
  assert.equal(saveToolDescription(false), plain, 'explicit false equals default')
})

test('renderSaveResult renders scope and the saved desc', () => {
  const global = renderSaveResult({
    scope: 'global',
    cwd: '',
    projectRoot: '',
    item: { id: 'm1', desc: '用户偏好用 pnpm', createdAt: 1, updatedAt: 1 },
  })
  assert.ok(global.includes('已保存全局记忆'), 'global label')
  assert.ok(global.includes('用户偏好用 pnpm'), 'desc shown')
  assert.ok(global.includes('m1'), 'id shown')
  const project = renderSaveResult({
    scope: 'project',
    cwd: '/p',
    projectRoot: '/p',
    item: { id: 'p1', desc: '本项目使用 pnpm', createdAt: 1, updatedAt: 1 },
  })
  assert.ok(project.includes('已保存项目记忆'), 'project label')
  assert.ok(project.includes('/p'), 'project root shown')
})

test('the save tool render produces text blocks', () => {
  const { tool } = realSaveTool()
  const blocks = tool.output.render(
    { scope: 'global', desc: 'x' },
    {
      scope: 'global',
      cwd: '',
      projectRoot: '',
      item: { id: 'm1', desc: '用户偏好用 pnpm', createdAt: 1, updatedAt: 1 },
    },
  )
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.ok(blocks[0].text.includes('用户偏好用 pnpm'))
})

test('memory_save logs an info line with [dsh-my-memory] prefix (issue #155)', async () => {
  const logs = []
  const { tool } = realSaveTool({ info: (m) => logs.push(m), warn: () => {} })
  const value = await tool.execute({ scope: 'global', desc: '用户偏好用 pnpm' }, { agent: { id: 'sess-1' } })
  assert.ok(value.item.id, 'item saved')
  assert.ok(logs.length >= 1, 'at least one log line emitted')
  assert.ok(logs[0].startsWith('[dsh-my-memory]'), 'log line carries the unified plugin prefix')
  assert.ok(logs[0].includes('记忆已保存'), 'log line describes the save')
  assert.ok(logs[0].includes('sess-1'), 'log line carries the session id')
})

test('memory_save logs a warn when desc is empty (issue #155)', async () => {
  const warns = []
  const { tool } = realSaveTool({ info: () => {}, warn: (m) => warns.push(m) })
  await assert.rejects(() => tool.execute({ scope: 'global', desc: '   ' }, { agent: { id: 'sess-2' } }))
  assert.ok(warns.length >= 1, 'warn emitted for empty desc')
  assert.ok(warns[0].startsWith('[dsh-my-memory]'), 'warn carries the unified plugin prefix')
  assert.ok(warns[0].includes('sess-2'), 'warn carries the session id')
})

test('cleanup', () => {
  rmSync(dir, { recursive: true, force: true })
})
