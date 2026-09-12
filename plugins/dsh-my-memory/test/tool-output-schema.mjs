/**
 * dsh-my-memory — 工具输出契约回归测试（issue #191）。
 *
 * 背景：`memory_save` / `memory_query` 的 `output.schema` 曾只声明
 * `id/desc/createdAt/updatedAt` 且 `additionalProperties: false`，而 store 真实
 * 返回的条目恒定带 `category/source/confidence/relatedIds/history/status`——
 * 宿主对每个成功值跑 `validateJsonSchemaValue(tool.output.schema)`，
 * 违规即抛 `ToolOutputError`：save 必炸、query 在记忆库非空时同样必炸
 * （空 items 掩盖了这个 bug，所以本文件特意覆盖非空场景）。
 *
 * 仓库约定：测试不得 import `@deepseek-ai/*` 官方包，故此处内联一个与宿主
 * 校验器核心语义等价的严格校验，拿**真实 store 返回值**（经
 * `createMemorySaveTool` / `createMemoryQueryTool` 的真实 execute 路径）跑校验，
 * 锁死「声明即真实形状」——store 字段再演进而 schema 未同步时立即红灯。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CATEGORIES } from '../lib/memory-scoring.js'
import { createStore, migrateProjectMemory, resolveProjectMemory } from '../lib/store.js'
import { MEMORY_ITEM_SCHEMA, createMemoryQueryTool, createMemorySaveTool } from '../lib/tool.js'

const dir = mkdtempSync(join(tmpdir(), 'dmm-tool-output-schema-'))
process.env.DSH_HOME = dir

/**
 * 严格 JSON Schema 校验，等价宿主 `validateJsonSchemaValue` 的核心语义：
 * type / required / properties 递归 / additionalProperties:false / enum。
 * 返回违规描述数组——宿主在 violations 非空时抛 ToolOutputError，故空数组
 * 即「宿主会接受这个返回值」。
 */
function validateStrict(schema, value, path = 'value') {
  const violations = []
  const allowed = Array.isArray(schema?.enum) ? schema.enum : null
  if (allowed !== null && !allowed.includes(value)) {
    violations.push(`"${path}" must be one of: ${allowed.join(', ')}`)
  }
  if (schema?.type === 'object') return [...violations, ...validateObjectStrict(schema, value, path)]
  if (schema?.type === 'array') {
    if (!Array.isArray(value)) return [...violations, `"${path}" must be an array`]
    const entries = value.flatMap((entry, i) => validateStrict(schema.items ?? {}, entry, `${path}[${i}]`))
    return [...violations, ...entries]
  }
  if (schema?.type === 'string') {
    return typeof value === 'string' ? violations : [...violations, `"${path}" must be a string`]
  }
  if (schema?.type === 'number') {
    return Number.isFinite(value) ? violations : [...violations, `"${path}" must be a number`]
  }
  return violations
}

/** object 分支：required 齐全 + 递归 properties + additionalProperties:false。 */
function validateObjectStrict(schema, value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`"${path}" must be an object`]
  }
  const properties = schema.properties ?? {}
  const violations = []
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) {
      violations.push(`missing required property "${path}.${key}"`)
    }
  }
  for (const [key, child] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) continue
    violations.push(...validateStrict(child, value[key], `${path}.${key}`))
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        violations.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
      }
    }
  }
  return violations
}

/** A save/query tool pair backed by one real file-backed global store. */
function realTools(name) {
  const globalStore = createStore({ file: join(dir, `${name}.json`) })
  const getProjectStore = async () => globalStore
  return {
    globalStore,
    saveTool: createMemorySaveTool({ globalStore, getProjectStore, config: {} }),
    queryTool: createMemoryQueryTool({ globalStore, getProjectStore }),
  }
}

/** A save/query tool pair on the real centralized project store (issue #108). */
function realProjectTools() {
  const projectDir = join(dir, 'proj')
  mkdirSync(join(projectDir, '.git'), { recursive: true })
  const stores = new Map()
  const globalStore = createStore({ file: join(dir, 'project-global.json') })
  const getProjectStore = async (cwd) => {
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
    projectDir,
    stores,
    globalStore,
    saveTool: createMemorySaveTool({ globalStore, getProjectStore, config: {} }),
    queryTool: createMemoryQueryTool({ globalStore, getProjectStore }),
  }
}

test('memory_save 的真实返回值通过 output.schema 严格校验（issue #191）', async () => {
  const { saveTool } = realTools('save')
  const value = await saveTool.execute({ scope: 'global', desc: '用户偏好用 pnpm' }, { agent: { id: 'sess-191' } })
  assert.deepEqual(validateStrict(saveTool.output.schema, value), [], '真实 save 返回值必须零违规')
  assert.equal(value.item.category, 'fact', '未指定分类时回退默认 fact')
  assert.equal(value.item.confidence, 1, '默认置信度')
  assert.deepEqual(value.item.relatedIds, [], '默认无关联')
  assert.deepEqual(value.item.history, [], '默认无历史')
  assert.equal(value.item.status, 'active', '默认状态')
})

test('memory_query 在非空记忆库下的真实返回值通过严格校验（空 items 不再掩盖 bug）', async () => {
  const { saveTool, queryTool } = realTools('query')
  await saveTool.execute({ scope: 'global', desc: '回复使用中文' }, {})
  const value = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(value.items.length, 1, '记忆库非空——本 bug 的触发条件')
  assert.deepEqual(validateStrict(queryTool.output.schema, value), [], '非空 items 必须零违规')
})

test('project scope 的 save / query 真实返回值同样通过严格校验', async () => {
  const { saveTool, queryTool, projectDir } = realProjectTools()
  const saved = await saveTool.execute({ scope: 'project', cwd: projectDir, desc: '本项目使用 vitest' }, {})
  assert.deepEqual(validateStrict(saveTool.output.schema, saved), [], 'project save 零违规')
  const queried = await queryTool.execute({ scope: 'project', cwd: projectDir }, {})
  assert.equal(queried.items.length, 1, 'project 记忆库非空')
  assert.deepEqual(validateStrict(queryTool.output.schema, queried), [], 'project query 零违规')
})

test('合并产出的非默认元数据（category/confidence/history）也通过严格校验', async () => {
  const { globalStore, queryTool } = realTools('merge')
  const at = Date.now()
  await globalStore.mergeAdd({ desc: '本项目使用 vitest', category: 'stack' }, at)
  await globalStore.mergeAdd({ desc: '本项目使用 vitest', category: 'stack' }, at + 1000)
  const value = await queryTool.execute({ scope: 'global' }, {})
  const item = value.items[0]
  assert.equal(item.category, 'stack', '候选的明确分类被保留')
  assert.equal(item.confidence, 2, '同主题合并升权')
  assert.equal(item.history.length, 1, '合并写入 history 记录')
  assert.deepEqual(validateStrict(queryTool.output.schema, value), [], '带 history 的真实值零违规')
})

test('schema 的 item 字段集与真实条目双向一致，且 save/query 复用同一常量（防漂移）', async () => {
  const { saveTool, queryTool } = realTools('fields')
  const value = await saveTool.execute({ scope: 'global', desc: '字段集一致性' }, {})
  const actualFields = Object.keys(value.item).sort()
  const itemSchema = saveTool.output.schema.properties.item
  assert.deepEqual(
    Object.keys(itemSchema.properties).sort(),
    actualFields,
    '声明字段集 === 真实条目字段集（多字段/少字段都红灯）',
  )
  assert.deepEqual(
    [...itemSchema.required].sort(),
    actualFields,
    '每个真实字段都必须声明为 required（withDefaults 恒补齐）',
  )
  assert.equal(itemSchema, MEMORY_ITEM_SCHEMA, 'save.item 复用共享字段常量')
  assert.equal(
    queryTool.output.schema.properties.items.items,
    MEMORY_ITEM_SCHEMA,
    'query.items[] 复用同一常量（#192 可直接扩展复用）',
  )
})

test('item 的 category/status 枚举与 source/history 嵌套形状与真实值一致', () => {
  const { saveTool } = realTools('enums')
  const itemSchema = saveTool.output.schema.properties.item
  assert.deepEqual(itemSchema.properties.category.enum, [...CATEGORIES], 'category 枚举与 memory-scoring 单一来源一致')
  assert.deepEqual(itemSchema.properties.status.enum, ['active', 'conflict-pending'], 'status 枚举')
  assert.equal(itemSchema.properties.source.additionalProperties, false, 'source 闭合')
  assert.deepEqual(itemSchema.properties.source.required, ['sessionId', 'at'], 'source 形状')
  assert.equal(itemSchema.properties.history.items.additionalProperties, false, 'history 条目闭合')
  assert.deepEqual(itemSchema.properties.history.items.required, ['at', 'action', 'desc'], 'history 条目形状')
  assert.equal(itemSchema.properties.relatedIds.items.type, 'string', 'relatedIds 为字符串数组')
  assert.equal(itemSchema.properties.confidence.type, 'number', 'confidence 为数值')
})

test('空 items 的 query 结果同样通过严格校验（原有用例条件保留）', async () => {
  const { queryTool } = realTools('empty')
  const value = await queryTool.execute({ scope: 'global' }, {})
  assert.equal(value.items.length, 0, '空记忆库')
  assert.deepEqual(validateStrict(queryTool.output.schema, value), [], '空结果零违规')
})

test('cleanup', () => {
  rmSync(dir, { recursive: true, force: true })
})
