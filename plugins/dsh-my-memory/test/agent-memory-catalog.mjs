/**
 * dsh-my-memory — agent 记忆的「常驻目录」与「全局写入护栏」（issue #502 后续）。
 *
 * 锁两件事：
 *  1. 目录必须**一行一条**且**有硬上限**（40 行 / 3 KB）——它常驻系统提示词，
 *     无上限就会把上下文吃光；超限时给「还有 N 条，read 对应文件」，绝不静默丢。
 *  2. 全局层写入护栏：含项目专属标识（仓库内路径 / IP / 端口 / 当前仓库名）
 *     的条目不许进全局——真实事故就是这么发生的（安卓仓库的调试脚本规则
 *     被写进 user.md，每个项目都受影响）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-catalog-'))
process.env.DSH_HOME = home
process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

test('目录一行一条，带文件前缀', async () => {
  const { renderCatalog } = await import('../lib/agent-memory/catalog.js')
  const text = renderCatalog([
    { name: 'user.md', lines: ['交付改动要给改前改后数字', '多 agent 别抢模拟器'] },
    { name: 'projects/a/decisions.md', lines: ['选 A 因为 B'] },
  ])
  assert.equal(
    text,
    [
      'user.md · 交付改动要给改前改后数字',
      'user.md · 多 agent 别抢模拟器',
      'projects/a/decisions.md · 选 A 因为 B',
    ].join('\n'),
  )
})

test('单行超过 32 字截断（一条长记忆不能吃掉整份目录）', async () => {
  const { renderCatalog, truncateEntry } = await import('../lib/agent-memory/catalog.js')
  assert.equal(truncateEntry('短', 32), '短')
  const long = '字'.repeat(50)
  const cut = truncateEntry(long, 32)
  assert.equal([...cut].length, 33, '32 字 + 省略号')
  assert.ok(cut.endsWith('…'))
  assert.ok(renderCatalog([{ name: 'user.md', lines: [long] }]).includes('…'))
})

test('超过 40 行截断，末尾给「还有 N 条」而不是静默丢', async () => {
  const { renderCatalog, MAX_CATALOG_LINES } = await import('../lib/agent-memory/catalog.js')
  const lines = Array.from({ length: 60 }, (_, i) => '条目 ' + (i + 1))
  const text = renderCatalog([{ name: 'user.md', lines }])
  const rows = text.split('\n')
  assert.equal(rows.length, MAX_CATALOG_LINES + 1, '40 行正文 + 1 行尾注')
  assert.match(rows[rows.length - 1], /另有 20 条未展开/)
})

test('字节上限先于行数生效时也照样截断', async () => {
  const { renderCatalog } = await import('../lib/agent-memory/catalog.js')
  const heavy = '字'.repeat(32)
  const lines = Array.from({ length: 40 }, () => heavy)
  const text = renderCatalog([{ name: 'user.md', lines }])
  assert.ok(Buffer.byteLength(text, 'utf8') < 4200, '目录正文不可能无限膨胀')
  assert.match(text, /未展开/)
})

test('目录缓存：prime 从磁盘同步装载，refresh 在写入后重建', async () => {
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')
  const { createAgentMemoryCatalog } = await import('../lib/agent-memory/catalog.js')

  const index = createIndexStore({})
  let catalog = null
  const store = createAgentMemoryStore({ index, onChange: () => void catalog?.refresh() })
  catalog = createAgentMemoryCatalog(() => store.entries())

  await store.write('user.md', '- 第一条偏好')
  await store.write('projects/pid/decisions.md', '- 第二条决策')
  await catalog.refresh()
  assert.match(catalog.text(), /user\.md · 第一条偏好/)
  assert.match(catalog.text(), /projects\/pid\/decisions\.md · 第二条决策/)

  // 新建一个 catalog 模拟「进程重启」：prime 必须能同步读出已有内容
  const rebooted = createAgentMemoryCatalog(() => store.entries())
  rebooted.prime()
  assert.match(rebooted.text(), /第一条偏好/)
})

test('index.json 丢了条目键，正文还在磁盘上时依旧可见（多进程覆盖落盘的兜底）', async () => {
  const { writeFile } = await import('node:fs/promises')
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')

  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('projects/pid/pitfalls.md', '- 坑一：并发跑门禁会假红')
  // 模拟另一个进程持旧缓存整份覆盖 index.json（宿主 + 命令行脚本并存时的真实故障）
  await writeFile(join(home, 'agent-memory', 'index.json'), '{"files":{}}', 'utf8')

  const reopenedIndex = createIndexStore({})
  const reopened = createAgentMemoryStore({ index: reopenedIndex })
  const entries = await reopened.entries()
  assert.ok(
    entries.some((entry) => entry.name === 'projects/pid/pitfalls.md'),
    '索引丢键不该让正文跟着消失（以文件系统为准）',
  )
})

test('全局护栏：含项目路径 / IP / 端口 / 当前仓库名一律拒写全局', async () => {
  const { globalScopeReject } = await import('../lib/agent-memory/tools.js')
  const cwd = '/Users/me/IdeaProjects/android-monitor'

  assert.ok(globalScopeReject('user.md', '- 手机测试走 scripts/debug-cli.sh ui', cwd) !== null)
  assert.ok(globalScopeReject('user.md', '- 部署在 124.222.1.1', cwd) !== null)
  assert.ok(globalScopeReject('user.md', '- 服务跑在 localhost:3080', cwd) !== null)
  assert.ok(globalScopeReject('user.md', '- android-monitor 构建先跑 build', cwd) !== null)
  // 通用能力放行
  assert.equal(globalScopeReject('user.md', '- 交付 UI 改动时给改前改后的实测数字表', cwd), null)
  assert.equal(globalScopeReject('feedback.md', '- 别自作主张改原型既有决策，先问', cwd), null)
  // 项目层不受此限制（路径正是它的价值）
  assert.equal(globalScopeReject('projects/pid/decisions.md', '- 走 scripts/debug-cli.sh', cwd), null)
})

test('护栏接在 write 工具上：拒写时返回可操作提示，且不落盘', async () => {
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')
  const { createAgentMemoryTools } = await import('../lib/agent-memory/tools.js')
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const tools = createAgentMemoryTools({ store, resolveProjectPrefix: async () => 'projects/pid/' })
  const write = tools.find((tool) => tool.name === 'agent_memory_write')
  const exec = { agent: { session: { header: { cwd: '/Users/me/IdeaProjects/android-monitor' } } } }

  const rejected = await write.execute({ name: 'feedback.md', content: '- 走 scripts/debug-cli.sh ui' }, exec)
  assert.match(rejected, /项目专属标识/)
  assert.match(rejected, /projects\/current/)
  const read = await store.read('feedback.md')
  assert.equal(read.ok, false, '被拒绝的写入没有落盘')

  const accepted = await write.execute(
    { name: 'projects/current/decisions.md', content: '- 走 scripts/debug-cli.sh ui' },
    exec,
  )
  assert.equal(accepted, 'ok', '写项目层放行')
})
