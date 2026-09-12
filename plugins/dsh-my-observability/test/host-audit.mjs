/**
 * Audit core tests for dsh-my-observability: event listeners (agent/status,
 * llm/stream wrap, tools/*), record shapes, session isolation, persistence
 * + restart recovery, per-session and global caps.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import {
  bootPlugin,
  createTempHome,
  cleanupHome,
  mockRequest,
  mockResponse,
  topAgent,
  dispatchEvent,
  invoke,
  jsonOf,
} from './lib/helpers.mjs'

const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
})

/** 等待 store 异步加载/防抖落盘 settle。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40))

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

async function eventsOf(api, query) {
  const res = mockResponse()
  await invoke(api, mockRequest({ url: `/observability/api/events${query}` }), res)
  return jsonOf(res).value
}

test('audit suite', async () => {
  // ── 1. inject 只声明硬依赖 webServer ────────────────────────────────
  const { inject } = await import('../lib/index.js')
  assert.ok(Array.isArray(inject), 'inject is an array')
  assert.deepEqual(inject, ['webServer'], 'only webServer is a hard dependency')

  // ── 2. agent/status → agent_status 事件（含顶层/子代理标记）──────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'running' })
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
    const events = await eventsOf(api, '?sessionId=s1')
    assert.equal(events.length, 2, 'two status events recorded')
    assert.equal(events[0].type, 'agent_status')
    assert.equal(events[0].data.status, 'running')
    assert.equal(events[0].data.agentType, 'top')
    assert.equal(events[1].data.status, 'idle')
    assert.equal(typeof events[0].time, 'number')
    assert.equal(typeof events[0].id, 'number')
  }

  // ── 3. 子代理标记（origin/delegationDepth/subagentDepth）──────────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'agent/status', {
      agent: { id: 'sub1', session: { header: { origin: 'subagent' } } },
      status: 'idle',
    })
    await dispatchEvent(listeners, 'agent/status', {
      agent: { id: 'sub2', options: { subagentDepth: 2 }, session: { header: { cwd: '/x' } } },
      status: 'idle',
    })
    const events = await eventsOf(api, '?sessionId=sub1')
    assert.equal(events[0].data.agentType, 'subagent', 'origin marker classified')
    const events2 = await eventsOf(api, '?sessionId=sub2')
    assert.equal(events2[0].data.agentType, 'subagent', 'runtime depth classified')
  }

  // ── 4. llm/stream：包装流透传全部 chunk + start/end 统计 ─────────────
  {
    const { listeners, api } = boot({})
    await settle()
    const chunks = [
      { type: 'reasoning-delta', index: 0, text: 'hello ' },
      { type: 'reasoning-delta', index: 0, text: 'world' },
      { type: 'text-delta', index: 1, text: '!' },
    ]
    async function* fakeStream() {
      for (const chunk of chunks) yield chunk
    }
    let nextCalled = false
    const wrapped = await dispatchEvent(listeners, 'llm/stream', { sessionId: 's1' }, () => {
      nextCalled = true
      return fakeStream()
    })
    assert.equal(nextCalled, true, 'next() called synchronously')
    const collected = []
    for await (const chunk of wrapped) collected.push(chunk)
    assert.deepEqual(collected, chunks, 'all chunks pass through')
    const events = await eventsOf(api, '?sessionId=s1&type=llm_stream')
    assert.equal(events.length, 2, 'start + end events')
    assert.equal(events[0].data.phase, 'start')
    assert.equal(events[1].data.phase, 'end')
    assert.equal(events[1].data.chunks, 3)
    assert.equal(events[1].data.chars, 12)
    assert.ok(events[1].data.ms >= 0)
  }

  // ── 5. llm/stream 错误：error 事件 + 错误向上传播 ────────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    async function* failingStream() {
      yield { type: 'text-delta', index: 0, text: 'a' }
      throw new Error('boom')
    }
    const wrapped = await dispatchEvent(listeners, 'llm/stream', { sessionId: 's1' }, () => failingStream())
    await assert.rejects(async () => {
      for await (const chunk of wrapped) {
        void chunk
      }
    }, /boom/)
    const events = await eventsOf(api, '?sessionId=s1&type=llm_stream')
    assert.equal(events.length, 2, 'start + error events')
    assert.equal(events[1].data.phase, 'error')
    assert.equal(events[1].data.message, 'boom')
  }

  // ── 6. llm/stream 无 sessionId：不记录，原样返回 next() 流 ───────────
  {
    const { listeners, api } = boot({})
    await settle()
    async function* plain() {
      yield 'raw'
    }
    const wrapped = await dispatchEvent(listeners, 'llm/stream', {}, () => plain())
    const collected = []
    for await (const chunk of wrapped) collected.push(chunk)
    assert.deepEqual(collected, ['raw'], 'stream untouched')
    const events = await eventsOf(api, '?sessionId=')
    assert.equal(events.length, 0, 'no events without sessionId')
  }

  // ── 7. tools/pre-execute → tool_call + next() 透传 ───────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    let nextCalled = false
    await dispatchEvent(
      listeners,
      'tools/pre-execute',
      { name: 'bash', agent: topAgent('s1'), arguments: { command: 'ls -la' } },
      async () => {
        nextCalled = true
      },
    )
    assert.equal(nextCalled, true, 'next() called')
    const events = await eventsOf(api, '?sessionId=s1&type=tool_call')
    assert.equal(events.length, 1)
    assert.equal(events[0].data.name, 'bash')
    assert.deepEqual(events[0].data.args.keys, ['command'])
    assert.equal(events[0].data.args.summary, 'ls -la')
  }

  // ── 8. 参数摘要：长文本截断 + 换行取首行 ─────────────────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    const long = `${'x'.repeat(300)}\nsecond line`
    await dispatchEvent(
      listeners,
      'tools/pre-execute',
      { name: 'bash', agent: topAgent('s1'), arguments: { command: long } },
      async () => {},
    )
    const events = await eventsOf(api, '?sessionId=s1&type=tool_call')
    assert.ok(events[0].data.args.summary.length <= 201, 'summary truncated')
    assert.ok(events[0].data.args.summary.endsWith('…'), 'truncation marker')
    assert.ok(!events[0].data.args.summary.includes('\n'), 'first line only')
  }

  // ── 9. tools/execute → tool_result + next() 结果透传 ─────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    let nextCalled = false
    const result = await dispatchEvent(
      listeners,
      'tools/execute',
      { name: 'bash', agent: topAgent('s1') },
      async () => {
        nextCalled = true
        return { stdout: 'ok' }
      },
    )
    assert.equal(nextCalled, true)
    assert.deepEqual(result, { stdout: 'ok' }, 'tool result passes through')
    const events = await eventsOf(api, '?sessionId=s1&type=tool_result')
    assert.equal(events.length, 1)
    assert.equal(events[0].data.name, 'bash')
    assert.equal(events[0].data.ok, true)
    assert.ok(events[0].data.ms >= 0)
  }

  // ── 10. tools/execute 失败结果 → ok: false ───────────────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'tools/execute', { name: 'bash', agent: topAgent('s1') }, async () => ({
      error: { message: 'failed' },
    }))
    const events = await eventsOf(api, '?sessionId=s1&type=tool_result')
    assert.equal(events[0].data.ok, false, 'error result flagged')
  }

  // ── 11. tools/* 无 agent 时：pre-execute 不记录但 next 照常 ──────────
  {
    const { listeners, api } = boot({})
    await settle()
    let nextCalled = false
    await dispatchEvent(listeners, 'tools/pre-execute', { name: 'bash' }, async () => {
      nextCalled = true
    })
    assert.equal(nextCalled, true)
    const events = await eventsOf(api, '?sessionId=x')
    assert.equal(events.length, 0, 'no session → no record')
  }

  // ── 12. 会话隔离：不同会话事件互不可见 ───────────────────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('sA'), status: 'idle' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('sB'), status: 'idle' })
    const eventsA = await eventsOf(api, '?sessionId=sA')
    const eventsB = await eventsOf(api, '?sessionId=sB')
    assert.equal(eventsA.length, 1)
    assert.equal(eventsB.length, 1)
    assert.equal(eventsA[0].sessionId, 'sA')
    assert.equal(eventsB[0].sessionId, 'sB')
    const sessions = jsonOf(
      await invoke(api, mockRequest({ url: '/observability/api/sessions' }), mockResponse()),
    ).value
    assert.equal(sessions.length, 2, 'both sessions listed')
    assert.deepEqual(
      sessions.map((s) => s.sessionId),
      ['sB', 'sA'],
      'sorted by last activity desc',
    )
  }

  // ── 12b. user/message → user_message 事件 + 会话标题 ─────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(
      listeners,
      'session/event',
      { id: 'sT' },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我修复轨迹回放面板' }] } },
    )
    await dispatchEvent(
      listeners,
      'session/event',
      { id: 'sT' },
      { type: 'user/message', data: { content: [{ type: 'text', text: '第二条消息' }] } },
    )
    // 插件注入消息不作为标题/事件
    await dispatchEvent(
      listeners,
      'session/event',
      { id: 'sT' },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '注入内容' }] } },
    )
    const events = await eventsOf(api, '?sessionId=sT&type=user_message')
    assert.equal(events.length, 2, 'two real user messages recorded')
    assert.equal(events[0].data.text, '帮我修复轨迹回放面板')
    const sessions = jsonOf(
      await invoke(api, mockRequest({ url: '/observability/api/sessions' }), mockResponse()),
    ).value
    const target = sessions.find((s) => s.sessionId === 'sT')
    assert.equal(target.title, '帮我修复轨迹回放面板', 'title = first user message')
  }

  // ── 13. type 过滤 + limit ────────────────────────────────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'running' })
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
    const onlyRunning = await eventsOf(api, '?sessionId=s1&type=agent_status&limit=1')
    assert.equal(onlyRunning.length, 1)
    assert.equal(onlyRunning[0].data.status, 'idle', 'limit takes the tail')
  }

  // ── 14. 持久化 + 重启恢复（共享 DSH_HOME）───────────────────────────
  {
    const sharedHome = createTempHome()
    try {
      const first = bootPlugin({}, { home: sharedHome })
      await settle()
      await dispatchEvent(first.listeners, 'agent/status', {
        agent: topAgent('persist-1'),
        status: 'running',
      })
      const wrapped = await dispatchEvent(first.listeners, 'llm/stream', { sessionId: 'persist-1' }, () =>
        (async function* () {
          yield { type: 'text-delta', index: 0, text: 'hi' }
        })(),
      )
      for await (const chunk of wrapped) {
        void chunk
      }
      await settle()
      first.disposeAll() // flush
      await settle()

      const second = bootPlugin({}, { home: sharedHome })
      await settle()
      const events = await eventsOf(second.api, '?sessionId=persist-1')
      assert.equal(events.length, 3, 'events survive restart (status + llm start/end)')
      assert.equal(events[0].type, 'agent_status')
      assert.equal(events[1].type, 'llm_stream')
      assert.equal(events[2].type, 'llm_stream')
      const sessions = jsonOf(
        await invoke(second.api, mockRequest({ url: '/observability/api/sessions' }), mockResponse()),
      ).value
      assert.equal(sessions[0].sessionId, 'persist-1')
      second.disposeAll()
    } finally {
      cleanupHome(sharedHome)
    }
  }

  // ── 15. 每会话上限：FIFO 截断到 MAX_EVENTS_PER_SESSION ───────────────
  {
    const { listeners, api } = boot({})
    await settle()
    for (let i = 0; i < 2050; i += 1) {
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('cap-1'), status: `s${i}` })
    }
    const events = await eventsOf(api, '?sessionId=cap-1')
    assert.equal(events.length, 2000, 'per-session cap enforced')
    assert.equal(events[0].data.status, 's50', 'oldest dropped (FIFO)')
    assert.equal(events[1999].data.status, 's2049', 'newest kept')
  }

  // ── 16. 路由 fence：跨域/非 loopback 拒绝 ────────────────────────────
  {
    const { api } = boot({})
    await settle()
    const evil = mockResponse()
    await invoke(api, mockRequest({ url: '/observability/api/status', host: 'evil.example.com' }), evil)
    assert.equal(evil.writeHeadStatus, 403, 'cross-authority rejected')
    const cross = mockResponse()
    await invoke(
      api,
      mockRequest({
        url: '/observability/api/status',
        secFetchSite: 'cross-site',
        origin: 'http://evil.example.com',
      }),
      cross,
    )
    assert.equal(cross.writeHeadStatus, 403, 'cross-site rejected')
  }

  // ── 17. 未知方法 → 404 ───────────────────────────────────────────────
  {
    const { api } = boot({})
    await settle()
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/observability/api/nope' }), res)
    assert.equal(res.writeHeadStatus, 404)
  }

  // ── 18. sessionId='*'：全部会话合并（导出范围「全部会话」用）──────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('sa'), status: 'idle' })
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('sb'), status: 'running' })
    const all = await eventsOf(api, '?sessionId=*')
    assert.equal(all.length, 2, 'all sessions merged')
    assert.deepEqual(
      new Set(all.map((e) => e.sessionId)),
      new Set(['sa', 'sb']),
      'both sessions present in all-session view',
    )
    assert.equal(all[0].time <= all[1].time, true, 'all-session events sorted by time asc')
    const single = await eventsOf(api, '?sessionId=sa')
    assert.equal(single.length, 1, 'single-session query unaffected by *')
  }

  // ── 19. 插件事件采集（issue #154）：task-reliability/* → plugin_event ──
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'task-reliability/intervention', {
      sessionId: 's1',
      action: 'repeat-break',
      reason: 'reason',
      count: 1,
    })
    await dispatchEvent(listeners, 'task-reliability/ask-decision', {
      sessionId: 's1',
      action: 'ask-timeout',
      reason: 'ask-timeout',
      question: 'A 还是 B？',
      autopilot: false,
    })
    await dispatchEvent(listeners, 'task-reliability/rescue', {
      sessionId: 's1',
      action: 'rescue-turn',
      reason: 'truncation',
      count: 1,
    })
    const events = await eventsOf(api, '?sessionId=s1&type=plugin_event')
    assert.equal(events.length, 3, 'three plugin events recorded')
    assert.equal(events[0].type, 'plugin_event')
    assert.equal(events[0].data.plugin, 'dsh-task-reliability', 'plugin name derived from prefix')
    assert.equal(events[0].data.event, 'intervention', 'event name without prefix')
    assert.equal(events[0].data.action, 'repeat-break')
    assert.equal(events[0].data.reason, 'reason')
    assert.deepEqual(events[0].data.params, { count: 1 }, 'extra params kept')
    assert.equal(events[1].data.event, 'ask-decision')
    assert.equal(events[1].data.params.question, 'A 还是 B？')
    assert.equal(events[1].data.params.autopilot, false)
    assert.equal(events[2].data.event, 'rescue', 'rescue event collected')
    assert.equal(events[2].data.action, 'rescue-turn')
  }

  // ── 20. 插件事件：无 sessionId 不记录；参数长文本截断 ────────────────
  {
    const { listeners, api } = boot({})
    await settle()
    await dispatchEvent(listeners, 'task-reliability/rescue', { action: 'wake-stalled' })
    const longReason = `${'x'.repeat(300)} tail`
    await dispatchEvent(listeners, 'task-reliability/verify', {
      sessionId: 's1',
      action: 'verify-done',
      reason: longReason,
    })
    const events = await eventsOf(api, '?sessionId=s1&type=plugin_event')
    assert.equal(events.length, 1, 'no sessionId → not recorded')
    assert.ok(events[0].data.reason.length <= 201, 'reason truncated')
    assert.ok(events[0].data.reason.endsWith('…'), 'truncation marker')
  }

  // ── 21. 插件事件持久化 + 重启恢复（与现有审计一致）──────────────────
  {
    const sharedHome = createTempHome()
    try {
      const first = bootPlugin({}, { home: sharedHome })
      await settle()
      await dispatchEvent(first.listeners, 'task-reliability/intervention', {
        sessionId: 'persist-plugin',
        action: 'steer-continue',
        reason: 'turn-stopping',
        taskId: 'task-1',
      })
      await settle()
      first.disposeAll() // flush
      await settle()

      const second = bootPlugin({}, { home: sharedHome })
      await settle()
      const events = await eventsOf(second.api, '?sessionId=persist-plugin')
      assert.equal(events.length, 1, 'plugin event survives restart')
      assert.equal(events[0].type, 'plugin_event')
      assert.equal(events[0].data.action, 'steer-continue')
      assert.equal(events[0].data.params.taskId, 'task-1')
      await second.disposeAll()
    } finally {
      cleanupHome(sharedHome)
    }
  }

  // ── 22. 查询不依赖加载耗时：boot 后零等待即读到磁盘历史（防回归）─────
  //  曾经的 CI flaky：查询前靠 settle(40) 赌异步 readFile 跑完，慢机器上
  //  读到 0 条 → 「plugin event survives restart」0 !== 1。查询侧等 whenReady
  //  后，查询语义与加载耗时无关（docs/踩坑/固定sleep等异步落盘导致CI-flaky.md）。
  {
    const sharedHome = createTempHome()
    try {
      const first = bootPlugin({}, { home: sharedHome })
      await settle()
      await dispatchEvent(first.listeners, 'task-reliability/intervention', {
        sessionId: 'zero-wait',
        action: 'steer-continue',
        reason: 'turn-stopping',
      })
      await settle()
      await first.disposeAll() // await 落盘链：此刻磁盘上已有该事件

      const second = bootPlugin({}, { home: sharedHome })
      // 刻意不等待：boot 后立即查询，加载必然还没完成（至少一个 IO tick）
      const events = await eventsOf(second.api, '?sessionId=zero-wait')
      assert.equal(events.length, 1, 'boot 后零等待查询必须读到磁盘历史')
      assert.equal(events[0].data.action, 'steer-continue')
      await second.disposeAll()
    } finally {
      cleanupHome(sharedHome)
    }
  }

  // ── 23. 插件事件受每会话上限约束（与现有事件同一 FIFO 桶）───────────
  {
    const { listeners, api } = boot({})
    await settle()
    for (let i = 0; i < 2050; i += 1) {
      await dispatchEvent(listeners, 'task-reliability/intervention', {
        sessionId: 'cap-plugin',
        action: 'steer-continue',
        reason: `r${i}`,
      })
    }
    const events = await eventsOf(api, '?sessionId=cap-plugin')
    assert.equal(events.length, 2000, 'per-session cap enforced for plugin events')
    assert.equal(events[0].data.reason, 'r50', 'oldest dropped (FIFO)')
    assert.equal(events[1999].data.reason, 'r2049', 'newest kept')
  }

  console.log('ALL AUDIT TESTS PASSED')
})
