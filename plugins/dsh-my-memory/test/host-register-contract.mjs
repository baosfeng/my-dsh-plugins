/**
 * dsh-my-memory — 宿主 tools.register 注册契约回归测试（issue #502 修复）。
 *
 * 背景：agent 记忆的四个工具最初没有声明 `output { schema, render }`。宿主
 * `tools.register()` 对此直接抛
 *   TypeError: tool "agent_memory_list" must declare output { schema, render, presentationMeta? }
 * 于是工具在真实环境里**根本注册不上**，而当时的测试是直接调
 * `createAgentMemoryTools().execute`，绕过了 register，所以全绿也拦不住。
 *
 * 本文件把宿主 register 的必需校验内联成断言（等价 dsh-tools/lib/index.js 的
 * 前置检查，仓库约定测试不 import @deepseek-ai/* 官方包），对插件**全部**注册
 * 工具跑一遍——任何工具退回"没有 output"立即红灯；另外用真实成功值验证
 * schema 与 render 的语义（值类型匹配 schema，render 产出 text block）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore } from '../lib/store.js'
import { createMemoryQueryTool, createMemorySaveTool } from '../lib/tool.js'
import { createMemoryDeleteTool } from '../lib/delete-tool.js'
import { createAgentMemoryTools } from '../lib/agent-memory/tools.js'
import { createIndexStore } from '../lib/agent-memory/index-store.js'
import { createAgentMemoryStore } from '../lib/agent-memory/store.js'

/** 隔离的 DSH_HOME（agent-memory 的路径在调用时才求值）。 */
const home = mkdtempSync(join(tmpdir(), 'dmm-host-register-'))
process.env.DSH_HOME = home

/** 宿主 assertSupportedJsonSchema 认得的顶层类型（JSON Schema 七种）。 */
const SUPPORTED_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'null'])

/** 构造插件会注册的全部工具（7 个）。 */
function pluginTools() {
  const globalStore = createStore({ file: join(home, 'memory.json') })
  const getProjectStore = async () => globalStore
  const agentStore = createAgentMemoryStore({ index: createIndexStore({}) })
  return [
    createMemoryQueryTool({ globalStore, getProjectStore }),
    createMemorySaveTool({ globalStore, getProjectStore, config: {} }),
    createMemoryDeleteTool({ globalStore, getProjectStore }),
    ...createAgentMemoryTools({ store: agentStore, resolveProjectPrefix: async () => 'projects/x/' }),
  ]
}

/**
 * 宿主 register 的必需校验（等价实现）。
 *
 * 宿主源码的判定是：缺 output / output 非对象 / render 非函数 → 抛 TypeError；
 * 随后 assertSupportedJsonSchema(schema) 拒绝宿主不支持的 schema 形状。
 */
function assertHostRegisterable(tool) {
  assert.equal(typeof tool.name, 'string', 'name 必须是字符串')
  assert.equal(typeof tool.description, 'string', 'description 必须是字符串')
  assert.equal(typeof tool.parameters, 'object', 'parameters 必须是对象')
  assert.equal(typeof tool.execute, 'function', 'execute 必须是函数')
  const output = tool.output
  if (output === undefined || typeof output !== 'object' || typeof output.render !== 'function') {
    throw new TypeError(`tool "${tool.name}" must declare output { schema, render }`)
  }
  assert.equal(typeof output.schema, 'object', `${tool.name}: output.schema 必须是对象`)
  assert.ok(SUPPORTED_TYPES.has(output.schema.type), `${tool.name}: output.schema.type 必须是受支持的 JSON Schema 类型`)
}

test('插件注册的每个工具都满足宿主 tools.register 的必需契约', () => {
  const tools = pluginTools()
  assert.equal(
    tools.length,
    7,
    '4 个旧工具 + 4 个 agent 记忆工具中的 7 个（query/save/delete + list/read/write/delete）',
  )
  for (const tool of tools) assertHostRegisterable(tool)
})

test('agent 记忆工具的真实成功值符合 output.schema，render 产出 text block', async () => {
  const tools = pluginTools().filter((tool) => tool.name.startsWith('agent_memory_'))
  const write = tools.find((tool) => tool.name === 'agent_memory_write')
  const value = await write.execute({ name: 'user.md', content: '- 回复使用中文' })
  assert.equal(typeof value, 'string', 'output.schema.type === string 与真实值一致')
  assert.deepEqual(write.output.render({}, value), [{ type: 'text', text: 'ok' }], 'render 把值原样包成 text block')
})

test('cleanup', () => {
  rmSync(home, { recursive: true, force: true })
})
