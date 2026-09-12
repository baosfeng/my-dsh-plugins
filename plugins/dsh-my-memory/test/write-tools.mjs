/**
 * dsh-my-memory — 写工具装配测试（issue #192）。
 *
 * 覆盖 registerMemoryWriteTools：memory_save / memory_delete 的注册与释放、
 * 共享 tools/pre-execute 确认门的挂载、宿主 approval 服务探针（#208）以及
 * 删除门的待删内容解析（lookupTarget 真的接到 store 上）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerMemoryWriteTools } from '../lib/write-tools.js'
import { createStore } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'dmm-write-tools-'))
process.env.DSH_HOME = dir

/** mock DshContext：记录注册的工具 / 监听器 / effect disposer。 */
function fakeCtx(approval) {
  const state = { tools: [], listeners: [], effectDisposers: [] }
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    get: (name) => (name === 'approval' ? approval : undefined),
    tools: {
      register: (tool) => {
        state.tools.push(tool)
        return () => {
          state.tools = state.tools.filter((entry) => entry !== tool)
        }
      },
    },
    on: (name, listener) => {
      const entry = { name, listener }
      state.listeners.push(entry)
      return () => {
        state.listeners = state.listeners.filter((item) => item !== entry)
      }
    },
    effect: (callback) => {
      const disposer = callback()
      if (typeof disposer === 'function') state.effectDisposers.push(disposer)
      return disposer
    },
  }
  return { ctx, state }
}

/** 真实 store 夹具（与 index.ts 的 getProjectStore 同构）。 */
function realStores() {
  const globalStore = createStore({ file: join(dir, `wt-global-${Math.random().toString(36).slice(2, 7)}.json`) })
  const projectStores = new Map()
  const getProjectStore = async (cwd) => {
    if (!projectStores.has(cwd)) {
      projectStores.set(cwd, createStore({ file: join(dir, `wt-project-${projectStores.size}.json`) }))
    }
    return projectStores.get(cwd)
  }
  return { globalStore, getProjectStore }
}

function gateOf(state) {
  return state.listeners.find((entry) => entry.name === 'tools/pre-execute')?.listener
}

test('registerMemoryWriteTools registers save + delete and the shared approval gate (#192)', () => {
  const { ctx, state } = fakeCtx(undefined)
  registerMemoryWriteTools(ctx, realStores())
  assert.deepEqual(
    state.tools.map((tool) => tool.name).sort(),
    ['memory_delete', 'memory_save'],
    'both write tools are registered',
  )
  assert.ok(gateOf(state), 'the shared approval gate is mounted on tools/pre-execute')
  assert.equal(state.effectDisposers.length, 2, 'both registrations are held by effects (HMR-safe)')
})

test('the effect disposers unregister both tools and the gate (#192)', () => {
  const { ctx, state } = fakeCtx(undefined)
  registerMemoryWriteTools(ctx, realStores())
  for (const dispose of state.effectDisposers) dispose()
  assert.equal(state.tools.length, 0, 'tools released')
  assert.equal(state.listeners.length, 0, 'gate released')
})

test('the approval service probe drives the gate decision (#192/#208)', async () => {
  const { ctx, state } = fakeCtx({ effectivePolicy: () => 'never' })
  registerMemoryWriteTools(ctx, { ...realStores(), config: { saveApproval: 'auto' } })
  const gate = gateOf(state)
  const decision = await gate(
    { name: 'memory_save', arguments: { scope: 'global', desc: 'x' }, agent: { id: 's', session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'allow', 'probe-visible policy=never + auto writes without a prompt')
})

test('the delete gate resolves the pending entry through the wired stores (#192)', async () => {
  const stores = realStores()
  const { ctx, state } = fakeCtx(undefined)
  registerMemoryWriteTools(ctx, stores)
  const saved = await stores.globalStore.add({ desc: '用 pnpm 装依赖', category: 'preference' })
  const decision = await gateOf(state)(
    { name: 'memory_delete', arguments: { id: saved.id, scope: 'global' }, agent: { id: 's', session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'ask', 'a deletion asks for consent')
  assert.ok(decision.reason.includes('用 pnpm 装依赖'), `the reason names the entry: ${decision.reason}`)
  assert.ok(decision.reason.includes('不可撤销'), 'the reason warns the deletion is irreversible')
})

test('cleanup', () => {
  rmSync(dir, { recursive: true, force: true })
})
