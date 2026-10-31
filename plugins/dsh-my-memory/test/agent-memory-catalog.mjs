/**
 * dsh-my-memory — agent 记忆的「常驻目录」与「全局写入护栏」（issue #502 后续）。
 *
 * 锁三件事：
 *  1. 目录**一行一条**且有硬上限（70 行 / 6 KB）——它常驻系统提示词，无上限
 *     就会把上下文吃光；超限时给「另有 N 条」，绝不静默丢。
 *  2. 排序规则：全局偏好整体优先，项目层**轮转**——实测整体按文件名排序时，
 *     排在后面的项目 21 条一条都进不了目录。
 *  3. 全局层写入护栏：含项目专属标识（仓库内路径 / IP / 端口 / 当前仓库名）
 *     的条目不许进全局——真实事故就是这么发生的。
 *  4. 目录**跨进程自愈**：onChange→refresh() 只覆盖本进程的写入，命令行脚本、
 *     第二个窗口、用户手改文件都看不见。text() 的节流 mtime 校验补上这一块，
 *     且没变化时必须返回同一字符串（系统提示词前缀缓存不能每轮失效）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-catalog-'))
process.env.DSH_HOME = home
process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

test('目录一行一条，前缀压缩为 u / f / 项目名', async () => {
  const { renderCatalog } = await import('../lib/agent-memory/catalog.js')
  const text = renderCatalog([
    { name: 'user.md', lines: ['交付改动要给改前改后数字'] },
    { name: 'projects/pid/decisions.md', lines: ['选 A 因为 B'] },
  ])
  assert.equal(text, ['u · 交付改动要给改前改后数字', 'pid/决 · 选 A 因为 B'].join('\n'))
})

test('项目名映射：已记录项目名时显示名字，未记录时退回 id 前 6 位', async () => {
  const { renderCatalog, catalogPrefix } = await import('../lib/agent-memory/catalog.js')
  assert.equal(catalogPrefix('projects/ba7b32df3d04/pitfalls.md'), 'ba7b32/坑')
  assert.equal(
    catalogPrefix('projects/ba7b32df3d04/pitfalls.md', { ba7b32df3d04: 'my-dsh-plugins' }),
    'my-dsh-plugins/坑',
  )
  assert.equal(catalogPrefix('feedback.md'), 'f')
  // 长仓库名截断，不吃预算
  assert.equal(catalogPrefix('projects/x/decisions.md', { x: 'a-very-long-repository-name' }), 'a-very-long-repo/决')
  const text = renderCatalog([{ name: 'projects/pid/pitfalls.md', lines: ['坑一'] }], { pid: 'demo' })
  assert.equal(text, 'demo/坑 · 坑一')
})

test('单行超过 30 字截断（一条长记忆不能吃掉整份目录）', async () => {
  const { renderCatalog, truncateEntry } = await import('../lib/agent-memory/catalog.js')
  assert.equal(truncateEntry('短', 30), '短')
  const long = '字'.repeat(50)
  const cut = truncateEntry(long, 30)
  assert.equal([...cut].length, 31, '30 字 + 省略号')
  assert.ok(cut.endsWith('…'))
  assert.ok(renderCatalog([{ name: 'user.md', lines: [long] }]).includes('…'))
})

test('超过行数上限就截断，末尾给「另有 N 条」而不是静默丢', async () => {
  const { renderCatalog, MAX_CATALOG_LINES } = await import('../lib/agent-memory/catalog.js')
  const overflow = 20
  const lines = Array.from({ length: MAX_CATALOG_LINES + overflow }, (_, i) => '条目内容 ' + (i + 1))
  const text = renderCatalog([{ name: 'user.md', lines }])
  const rows = text.split('\n')
  assert.equal(rows.length, MAX_CATALOG_LINES + 1, '正文占满上限 + 1 行尾注')
  assert.match(rows[rows.length - 1], new RegExp('另有 ' + overflow + ' 条未展开'))
})

test('目录按「全局偏好 → 反馈 → 项目层」排序，全局条目整体优先', async () => {
  const { renderCatalog } = await import('../lib/agent-memory/catalog.js')
  const text = renderCatalog([
    { name: 'projects/zzz/pitfalls.md', lines: ['项目坑'] },
    { name: 'user.md', lines: ['全局偏好一', '全局偏好二'] },
    { name: 'feedback.md', lines: ['被纠正的做法'] },
  ])
  const rows = text.split('\n')
  assert.match(rows[0], /^u · 全局偏好一/)
  assert.match(rows[1], /^u · 全局偏好二/)
  assert.match(rows[2], /^f · 被纠正的做法/)
  assert.match(rows[3], /^zzz\/坑 · 项目坑/)
})

test('项目层轮转：一个项目条目再多，也不会让另一个项目整体消失', async () => {
  const { renderCatalog, MAX_CATALOG_LINES } = await import('../lib/agent-memory/catalog.js')
  const big = Array.from({ length: MAX_CATALOG_LINES + 10 }, (_, i) => '大项目条目 ' + (i + 1))
  const text = renderCatalog([
    { name: 'projects/bbb/pitfalls.md', lines: ['小项目唯一一条'] },
    { name: 'projects/aaa/pitfalls.md', lines: big },
  ])
  assert.match(text, /bbb\/坑 · 小项目唯一一条/, '排在后面的项目必须有代表')
})

test('字节上限先于行数生效时也照样截断', async () => {
  const { renderCatalog } = await import('../lib/agent-memory/catalog.js')
  const heavy = '字'.repeat(30)
  const lines = Array.from({ length: 120 }, () => heavy)
  const text = renderCatalog([{ name: 'user.md', lines }])
  assert.ok(Buffer.byteLength(text, 'utf8') < 6300, '目录正文不可能无限膨胀')
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
  assert.match(catalog.text(), /u · 第一条偏好/)
  assert.match(catalog.text(), /pid\/决 · 第二条决策/)

  // 新建一个 catalog 模拟「进程重启」：prime 必须能同步读出已有内容
  const rebooted = createAgentMemoryCatalog(() => store.entries())
  rebooted.prime()
  assert.match(rebooted.text(), /第一条偏好/)
})

test('目录展示项目名：写入项目层时把 cwd 的 basename 记进 index', async () => {
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')
  const { createAgentMemoryCatalog } = await import('../lib/agent-memory/catalog.js')
  const { createAgentMemoryTools } = await import('../lib/agent-memory/tools.js')

  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const tools = createAgentMemoryTools({
    store,
    resolveProjectPrefix: async () => 'projects/pid/',
    rememberProject: (id, label) => void index.rememberProject(id, label),
  })
  const write = tools.find((tool) => tool.name === 'agent_memory_write')
  const exec = { agent: { session: { header: { cwd: '/Users/me/IdeaProjects/demo-repo' } } } }
  assert.equal(
    await write.execute({ name: 'projects/current/pitfalls.md', content: '- 坑一：并发跑门禁会假红' }, exec),
    'ok',
  )

  const catalog = createAgentMemoryCatalog(() => store.entries())
  await catalog.refresh()
  assert.match(catalog.text(), /demo-repo\/坑 · 坑一/)
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

test('目录跨进程自愈：绕开 store 直接落盘的新条目，节流窗口一到就进目录', async () => {
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')
  const { createAgentMemoryCatalog } = await import('../lib/agent-memory/catalog.js')

  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  // 时钟注入：不 sleep 真实的 1 秒，直接推窗口
  let clock = 0
  const catalog = createAgentMemoryCatalog(() => store.entries(), { revalidateMs: 1000, now: () => clock })
  catalog.prime()
  const before = catalog.text()

  // 模拟命令行脚本 / 第二个 DSH 窗口：不经过 store，也不触发 onChange，直接落盘
  const dir = join(home, 'agent-memory', 'projects', 'cliw')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'pitfalls.md'), '- 另一个进程写的坑\n', 'utf8')

  clock += 999
  assert.equal(catalog.text(), before, '节流窗口内不校验（否则等于每轮 stat）')
  clock += 1
  assert.match(catalog.text(), /cliw\/坑 · 另一个进程写的坑/, '窗口一到，目录按磁盘自愈')
})

test('目录缓存：指纹没变就返回同一字符串，也不重复 stat / 重读正文', async () => {
  const { createAgentMemoryCatalog } = await import('../lib/agent-memory/catalog.js')
  let stats = 0
  let clock = 0
  // 指纹注入成常量：谁改盘都不该触发重读，用来锁「没变化 → 同一字符串」
  const catalog = createAgentMemoryCatalog(async () => [], {
    revalidateMs: 1000,
    now: () => clock,
    stamp: () => {
      stats += 1
      return { 'user.md': 1 }
    },
  })
  catalog.prime()
  const first = catalog.text()
  assert.equal(stats, 1, 'prime 取过一次指纹')

  await mkdir(join(home, 'agent-memory'), { recursive: true })
  await writeFile(join(home, 'agent-memory', 'feedback.md'), '- 本窗口不该出现的条目\n', 'utf8')

  assert.equal(catalog.text(), first, '窗口内直接读缓存')
  assert.equal(stats, 1, '窗口内一次 stat 都不做')
  clock += 1000
  assert.equal(catalog.text(), first, '窗口外指纹未变 → 同一字符串（前缀缓存不失效）')
  assert.equal(stats, 2, '窗口外只 stat 一次，没有每轮读整个目录')
  assert.doesNotMatch(catalog.text(), /本窗口不该出现的条目/)
})

test('目录跨进程自愈：用户手改已有文件（只有 mtime 变）同样被发现', async () => {
  const { createAgentMemoryCatalog } = await import('../lib/agent-memory/catalog.js')
  const target = join(home, 'agent-memory', 'user.md')
  await mkdir(join(home, 'agent-memory'), { recursive: true })
  const past = new Date(Date.now() - 60_000)
  await writeFile(target, '- 手改之前\n', 'utf8')
  await utimes(target, past, past)

  let clock = 0
  const catalog = createAgentMemoryCatalog(async () => [], { revalidateMs: 1000, now: () => clock })
  catalog.prime()
  assert.match(catalog.text(), /手改之前/)

  await writeFile(target, '- 手改之后\n', 'utf8')
  const later = new Date(Date.now() + 60_000)
  await utimes(target, later, later) // 显式推后 mtime：同一毫秒内写入也不会漏判

  clock += 1000
  assert.match(catalog.text(), /手改之后/, '内容按磁盘重建')
  assert.doesNotMatch(catalog.text(), /手改之前/)
})
