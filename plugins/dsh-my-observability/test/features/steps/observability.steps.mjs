/**
 * Step definitions for dsh-my-observability Gherkin acceptance tests
 * (observability / git / review features).
 *
 * World + helpers live in world.mjs. Steps boot the plugin against a mocked
 * ctx, drive events + API routes, and assert on recorded audit data, typed
 * commits and diff review reports (real temporary git repos).
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { topAgent } from '../../lib/helpers.mjs'

// ── Given ─────────────────────────────────────────────────────────────────
Given('可观测性插件已启动', async function () {
  this.boot({})
  await settle()
})

Given('可观测性插件已启动且 AI 审查服务可用', async function () {
  this.boot({}, { agents: aiAgentsMock() })
  await settle()
})

Given('存在一个临时 git 仓库', async function () {
  this.repo = this.createRepo()
})

Given('存在一个临时 git 仓库且已修改文件', async function () {
  this.repo = this.createRepo()
  writeFileSync(join(this.repo, 'src/a.js'), 'const x = 1\n')
})

Given('存在一个含调试语句变更的临时 git 仓库', async function () {
  this.repo = this.createRepo()
  seedCommit(this, 'const x = 1\n')
  writeFileSync(join(this.repo, 'src/a.js'), 'const x = 1\nconsole.log("debug")\n')
})

Given('存在一个含密钥硬编码变更的临时 git 仓库', async function () {
  this.repo = this.createRepo()
  seedCommit(this, 'const x = 1\n')
  writeFileSync(join(this.repo, 'src/a.js'), 'const x = 1\nconst password = "supersecret123"\n')
})

Given('存在一个含干净变更的临时 git 仓库', async function () {
  this.repo = this.createRepo()
  seedCommit(this, 'const x = 1\n')
  writeFileSync(join(this.repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
})

function seedCommit(world, content) {
  writeFileSync(join(world.repo, 'src/a.js'), content)
  world.git(world.repo, 'add', 'src/a.js')
  world.git(world.repo, 'commit', '-m', 'chore: seed')
}

// ── When ──────────────────────────────────────────────────────────────────
When('顶层代理 {string} 的状态变为 {string}', async function (id, status) {
  await this.dispatch('agent/status', { agent: topAgent(id), status })
})

When('代理 {string} 的状态变为 {string}', async function (id, status) {
  await this.dispatch('agent/status', { agent: topAgent(id), status })
})

When('代理 {string} 的模型流输出 {int} 个数据块', async function (id, count) {
  async function* stream() {
    for (let i = 0; i < count; i += 1) yield { type: 'text-delta', index: i, text: 'x' }
  }
  const wrapped = await this.dispatch('llm/stream', { sessionId: id }, () => stream())
  for await (const chunk of wrapped) {
    void chunk
  }
})

When('代理 {string} 调用 bash 工具并成功返回', async function (id) {
  await this.dispatch(
    'tools/pre-execute',
    { name: 'bash', agent: topAgent(id), arguments: { command: 'ls' } },
    async () => {},
  )
  await this.dispatch('tools/execute', { name: 'bash', agent: topAgent(id) }, async () => ({
    stdout: 'ok',
  }))
})

When('插件重启', async function () {
  // 落盘等待用确定性信号：disposeAll 内部 store.dispose() 返回落盘链 promise，
  // await 它返回即「本进程事件已写完」——不靠墙钟赌 IO 完成（同一根因见
  // test/host-audit.mjs 用例 14：CI 上固定 sleep 不足 → 重启后读到 0 条）。
  await this.handle.disposeAll()
  this.handle = null
  this.boot({})
  await settle()
})

When('代理 {string} 持续产生 {int} 条状态事件', async function (id, count) {
  for (let i = 0; i < count; i += 1) {
    await this.dispatch('agent/status', { agent: topAgent(id), status: `s${i}` })
  }
})

When('等待落盘稳定', async function () {
  await new Promise((resolve) => setTimeout(resolve, 1600))
})

When('请求提交类型 {string} 描述 {string}', async function (type, description) {
  await this.invoke('/observability/api/git/commit', {
    method: 'POST',
    body: JSON.stringify({ repoPath: this.repo, type, description }),
  })
})

When('请求提交类型 {string} 范围 {string} 描述 {string}', async function (type, scope, description) {
  await this.invoke('/observability/api/git/commit', {
    method: 'POST',
    body: JSON.stringify({ repoPath: this.repo, type, scope, description }),
  })
})

When('对该仓库请求提交类型 {string} 描述 {string}', async function (type, description) {
  await this.invoke('/observability/api/git/commit', {
    method: 'POST',
    body: JSON.stringify({ repoPath: this.repo, type, description }),
  })
})

When('查询该仓库的状态', async function () {
  await this.invoke(`/observability/api/git/status?repo=${encodeURIComponent(this.repo)}`)
})

When('请求审查该仓库', async function () {
  await this.invoke('/observability/api/review', {
    method: 'POST',
    body: JSON.stringify({ repoPath: this.repo }),
  })
})

When('请求审查不存在的路径', async function () {
  await this.invoke('/observability/api/review', {
    method: 'POST',
    body: JSON.stringify({ repoPath: '/nonexistent-path-xyz' }),
  })
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('响应状态码为 {int}', async function (status) {
  assert.equal(this.lastResponse.status, status)
})

Then('会话 {string} 的事件数等于 {int}', async function (sessionId, count) {
  await this.invoke(`/observability/api/events?sessionId=${sessionId}`)
  assert.equal(this.lastValue.length, count)
})

Then('会话 {string} 中类型为 {string} 的事件数等于 {int}', async function (sessionId, type, count) {
  await this.invoke(`/observability/api/events?sessionId=${sessionId}&type=${type}`)
  assert.equal(this.lastValue.length, count)
})

Then('第一个事件的类型为 {string}', async function (type) {
  assert.equal(this.lastValue[0].type, type)
})

Then('模型流事件包含块数统计', async function () {
  const end = this.lastValue.find((event) => event.data.phase === 'end')
  assert.ok(end !== undefined, 'end event present')
  assert.equal(end.data.chunks, 2, 'chunk count recorded')
})

Then('工具结果事件标记为成功', async function () {
  const result = this.lastValue.find((event) => event.type === 'tool_result')
  assert.equal(result.data.ok, true)
})

Then('会话列表包含 {int} 个会话', async function (count) {
  await this.invoke('/observability/api/sessions')
  assert.equal(this.lastValue.length, count)
})

Then('提交消息为 {string}', async function (message) {
  assert.equal(this.lastValue.message, message)
})

Then('提交返回 hash', async function () {
  assert.match(this.lastValue.hash, /^[0-9a-f]{7,40}$/)
})

Then('仓库最近提交消息为 {string}', async function (message) {
  const log = this.git(this.repo, 'log', '-1', '--format=%B').trim()
  assert.equal(log, message)
})

Then('状态包含 {int} 个未暂存变更', async function (count) {
  assert.equal(this.lastValue.unstagedCount, count)
})

Then('审查报告包含 {string} 问题', async function (rule) {
  assert.ok(
    this.lastValue.issues.some((issue) => issue.rule === rule),
    `rule ${rule} present`,
  )
})

Then('该问题严重级别为 {string}', async function (severity) {
  const issue = this.lastValue.issues.find((i) => i.rule === 'secret-leak')
  assert.equal(issue.severity, severity)
})

Then('审查报告的错误数为 {int}', async function (count) {
  assert.equal(this.lastValue.summary.errors, count)
})

Then('审查报告的警告数为 {int}', async function (count) {
  assert.equal(this.lastValue.summary.warnings, count)
})

Then('审查报告包含 AI 结论', async function () {
  assert.equal(this.lastValue.ai.enabled, true)
})

Then('AI 结论的 verdict 为 {string}', async function (verdict) {
  assert.equal(this.lastValue.ai.verdict, verdict)
})

/** 等待 store 异步加载/落盘 settle。 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

// ── AI agents mock ─────────────────────────────────────────────────────────
function aiAgentsMock() {
  return {
    create: async () => ({
      agent: {
        followup: () => {},
        whenIdle: async () => {},
        session: {
          events: [
            {
              type: 'assistant/message',
              data: {
                message: {
                  content: [{ type: 'text', text: '{"verdict":"approve","summary":"ok","topIssues":[]}' }],
                },
              },
            },
          ],
        },
      },
      dispose: async () => {},
    }),
  }
}

Then('审计数据文件以增量追加方式增长', function () {
  const file = join(this.sharedHome, 'observability', 'audit.jsonl')
  assert.ok(existsSync(file), '审计数据文件已创建')
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '').length
  assert.ok(lines >= 200, `追加行数与事件数一致（实际 ${lines}）`)
})

Then('落盘字节数不超过事件本体字节的 1.6 倍', async function () {
  const file = join(this.sharedHome, 'observability', 'audit.jsonl')
  const size = statSync(file).size
  await this.invoke('/observability/api/events?sessionId=amp')
  const events = this.lastValue ?? []
  const eventBytes = events.reduce((acc, e) => acc + JSON.stringify(e).length + 1, 0)
  assert.ok(size <= Math.ceil(eventBytes * 1.6) + 512, `写放大：落盘 ${size}B vs 事件本体 ${eventBytes}B`)
})

When('请求资源采样', async function () {
  await this.invoke('/observability/api/resources')
})

Then('资源采样包含 CPU 与内存指标', function () {
  assert.equal(typeof this.lastValue.cpuPercent, 'number')
  assert.equal(typeof this.lastValue.memoryBytes, 'number')
})

Then('资源采样包含告警列表', function () {
  assert.ok(Array.isArray(this.lastValue.alerts), 'alerts 为数组')
})

Then('资源采样包含降级状态', function () {
  assert.equal(typeof this.lastValue.degraded, 'boolean', 'degraded 为布尔（资源看门狗降级标记，issue #127）')
})
