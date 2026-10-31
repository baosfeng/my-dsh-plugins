/**
 * dsh-my-memory — agent 记忆面板的**分组**与**跨项目晋升**（issue #502 后续）。
 *
 * 覆盖三件用户可感知的事：
 *  1. 分组：全局一份 + 每个项目一份，全局恒在最前、项目按最后写入时间倒序
 *     （面板据此默认展开全局 + 最近写入的项目）；
 *  2. 建议：同一事实出现在 ≥2 个**不同项目**才建议晋升（同一项目内部重复不
 *     算跨项目；相似度用 duplicates.ts 的同一个阈值）；
 *  3. 晋升：追加进 user.md + 从涉及项目文件删除；被 globalScopeReject 拒绝
 *     （路径 / IP / 端口 / 仓库名）、建议过期、全局层写满都必须给出可读原因，
 *     且**不得留下半截状态**（项目层没被删、全局层没被写）。
 *
 * 全部测试跑在隔离的临时 DSH_HOME 上，不碰用户真实的 ~/.dsh。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-promote-'))
process.env.DSH_HOME = home
process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

/** 每次动态导入，确保读到的 DSH_HOME 是刚设的（paths.ts 在调用时才对 dshHome 求值）。 */
async function deps() {
  const paths = await import('../lib/agent-memory/paths.js')
  const indexStore = await import('../lib/agent-memory/index-store.js')
  const store = await import('../lib/agent-memory/store.js')
  const promote = await import('../lib/agent-memory/promote.js')
  return { ...paths, ...indexStore, ...store, ...promote }
}

/**
 * 每个碰磁盘的用例换一个独立的 DSH_HOME 子目录。
 *
 * 用例之间零共享：晋升会真的改文件，共用目录时后一个用例会读到前一个用例
 * 留下的 user.md，断言就变成「看执行顺序」而不是看行为。
 */
async function freshHome() {
  process.env.DSH_HOME = await mkdtemp(join(home, 'case-'))
}

/** 一份面板条目的形状（与 route.ts 的视图一致，只取本模块关心的字段）。 */
function entryOf(name, content, updatedAt, extra = {}) {
  return { name, content, updatedAt, archived: false, ...extra }
}

/** 两个项目的同一句「门禁假红」（字面重复，相似度 1）。 */
const DUPLICATED = '门禁九项并行时 vitest 偶发单例超时假红'

/** 读一份文件正文（断言磁盘状态用）。 */
async function bodyOf(name) {
  const { absoluteFileOf } = await deps()
  return readFile(absoluteFileOf(name), 'utf8')
}

/** 造一次 route 调用（GET / POST），返回状态码与解析后的响应。 */
async function routeCall(routeDeps, payload) {
  const { routeAgentMemory } = await import('../lib/agent-memory/route.js')
  const captured = []
  let status = 0
  const req =
    payload === undefined
      ? { headers: {}, method: 'GET' }
      : {
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify(payload)
          },
        }
  await routeAgentMemory(
    new URL('http://dsh.internal/my-memory/api/agent-memory'),
    req,
    {
      writeHead: (code) => {
        status = code
      },
      end: (chunk) => {
        if (chunk) captured.push(chunk)
      },
    },
    routeDeps,
  )
  return { status, json: captured[0] ? JSON.parse(captured[0]) : null }
}

/**
 * 直接落一份正文（绕过 store.write 的去重护栏）。
 *
 * 真实库里的跨项目重复就是**历史数据**：写入护栏是后来才加的，当时两条都
 * 已经躺在磁盘上了——那正是本功能存在的前提。用 store.write 造这种数据会
 * 被护栏挡住（先去重/合并了），所以夹具必须直接写文件。
 */
async function seedBody(name, content) {
  const { absoluteFileOf } = await deps()
  const file = absoluteFileOf(name)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/** 两个项目各有一条同一事实（跨项目重复的基本盘）。 */
async function seedCrossProject() {
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await index.load()
  await seedBody('projects/aaa111/pitfalls.md', '- ' + DUPLICATED + '\n- 本项目独有的坑')
  await seedBody('projects/bbb222/decisions.md', '- ' + DUPLICATED)
  await index.rememberProject('aaa111', 'android-monitor')
  await index.rememberProject('bbb222', 'my-dsh-plugins')
  return { index, store }
}

test('分组：全局一份 + 每个项目一份，全局恒在最前、项目按最后写入倒序', async () => {
  const { buildGroups } = await deps()
  const entries = [
    entryOf('projects/old/decisions.md', '- 旧项目', 100, { projectName: 'old' }),
    entryOf('user.md', '- 全局偏好', 50),
    entryOf('projects/new/pitfalls.md', '- 新项目', 900, { projectName: 'new' }),
    entryOf('projects/new/decisions.md', '- 新项目二', 800, { projectName: 'new' }),
  ]
  const groups = buildGroups(entries, { old: 'old-repo', new: 'new-repo' })
  assert.deepEqual(
    groups.map((group) => group.id),
    ['global', 'project:new', 'project:old'],
    '全局最前，项目按 latestUpdatedAt 倒序',
  )
  assert.equal(groups[0].count, 1)
  assert.equal(groups[1].count, 2, '同一项目的多个文件并进一个分组')
  assert.equal(groups[1].projectName, 'new-repo', '分组用索引里记的可读名')
  assert.equal(groups[1].latestUpdatedAt, 900)
})

test('分组不装归档条目，未记录名字的项目退回 id', async () => {
  const { buildGroups } = await deps()
  const groups = buildGroups(
    [
      entryOf('projects/zzz999/pitfalls.md', '- 活着', 10),
      { ...entryOf('projects/zzz999/decisions.md', '- 归档了', 20), archived: true },
    ],
    {},
  )
  assert.equal(groups.length, 1)
  assert.equal(groups[0].count, 1, '归档条目不进分组（归档区单独展示）')
  assert.equal(groups[0].projectName, 'zzz999', '没记过名字就显示 id，而不是空标题')
})

test('建议：同一事实出现在 ≥2 个不同项目才建议晋升', async () => {
  const { buildSuggestions } = await deps()
  const suggestions = buildSuggestions(
    [
      entryOf('projects/aaa/pitfalls.md', '- ' + DUPLICATED, 1, { projectName: 'android-monitor' }),
      entryOf('projects/bbb/decisions.md', '- ' + DUPLICATED, 2, { projectName: 'my-dsh-plugins' }),
    ],
    {},
  )
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].text, DUPLICATED)
  assert.deepEqual(
    suggestions[0].sources.map((source) => source.projectName),
    ['android-monitor', 'my-dsh-plugins'],
    '来源覆盖两个项目',
  )
  assert.equal(suggestions[0].similarity, 1, '字面重复的相似度是 1')
  assert.equal(suggestions[0].blocked, null, '通用能力可以进全局')
})

test('建议：同一项目内部的重复不算跨项目，不同事实也不建议', async () => {
  const { buildSuggestions } = await deps()
  const sameProject = buildSuggestions(
    [
      entryOf('projects/aaa/pitfalls.md', '- ' + DUPLICATED, 1, { projectName: 'p' }),
      entryOf('projects/aaa/decisions.md', '- ' + DUPLICATED, 2, { projectName: 'p' }),
    ],
    {},
  )
  assert.deepEqual(sameProject, [], '同一个项目的两份文件重复 = 项目内问题，不跨项目')
  const unrelated = buildSuggestions(
    [
      entryOf('projects/aaa/pitfalls.md', '- 交付 UI 改动时给实测数字表', 1, { projectName: 'p' }),
      entryOf('projects/bbb/pitfalls.md', '- 探针文件不要落在 src/main 下', 2, { projectName: 'q' }),
    ],
    {},
  )
  assert.deepEqual(unrelated, [], '不相似的两条不产生建议')
})

test('建议：传递闭包聚簇（A≈B、B≈C 时只给一条建议）', async () => {
  const { buildSuggestions } = await deps()
  const base = '跨项目记忆的晋升判据必须与去重护栏共用同一个相似度阈值和归一化规则'
  const suggestions = buildSuggestions(
    [
      entryOf('projects/aaa/pitfalls.md', '- ' + base, 1, { projectName: 'p' }),
      entryOf('projects/bbb/pitfalls.md', '- ' + base + '（含归一化）', 2, { projectName: 'q' }),
      entryOf('projects/ccc/pitfalls.md', '- ' + base + '（含归一化与大小写）', 3, { projectName: 'r' }),
    ],
    {},
  )
  assert.equal(suggestions.length, 1, '传递闭包聚成一簇，不产生互相重叠的多条建议')
  assert.equal(suggestions[0].sources.length, 3, '三个项目各一行来源')
  assert.equal(suggestions[0].text, base + '（含归一化与大小写）', '取最具体（最长）的那条作为晋升文本')
})

test('建议：含项目内路径 / 地址 / 仓库名的条目被护栏拒绝并给原因', async () => {
  const { buildSuggestions } = await deps()
  const line = '手机测试一律走 scripts/debug-cli.sh ui'
  const [suggestion] = buildSuggestions(
    [
      entryOf('projects/aaa/pitfalls.md', '- ' + line, 1, { projectName: 'android-monitor' }),
      entryOf('projects/bbb/pitfalls.md', '- ' + line, 2, { projectName: 'my-dsh-plugins' }),
    ],
    {},
  )
  assert.ok(suggestion, '仍然列出建议（不能静默隐藏）')
  assert.match(String(suggestion.blocked), /项目专属标识/, '复用 globalScopeReject 的原因')
})

test('route GET 返回分组 + 归档区 + 晋升建议', async () => {
  await freshHome()
  const { index, store } = await seedCrossProject()
  const listed = await routeCall({ index, store })
  assert.equal(listed.status, 200)
  const value = listed.json.value
  assert.deepEqual(
    value.groups.map((group) => group.kind),
    ['project', 'project'],
    '没有全局文件时只有项目分组',
  )
  assert.equal(
    value.groups.flatMap((group) => group.entries).length,
    2,
    '分组里的条目数等于活跃**文件**数（一个文件一张卡片）',
  )
  assert.deepEqual(value.archived, [], '没有归档条目')
  assert.equal(value.suggestions.length, 1, '跨项目重复被算成一条建议')
  assert.equal(value.suggestions[0].text, DUPLICATED)
})

test('route POST promote：写入 user.md 并从涉及的项目文件删除该条', async () => {
  await freshHome()
  const { index, store } = await seedCrossProject()
  const promoted = await routeCall({ index, store }, { action: 'promote', text: DUPLICATED })
  assert.equal(promoted.status, 200, JSON.stringify(promoted.json))
  assert.match(await bodyOf('user.md'), new RegExp('- ' + DUPLICATED), '全局层拿到这条')
  assert.ok(!(await bodyOf('projects/aaa111/pitfalls.md')).includes(DUPLICATED), '项目 A 删掉该条')
  assert.ok(!(await bodyOf('projects/bbb222/decisions.md')).includes(DUPLICATED), '项目 B 删掉该条')
  assert.match(await bodyOf('projects/aaa111/pitfalls.md'), /本项目独有的坑/, '同文件里无关的条目必须留着')
  assert.equal(promoted.json.value.suggestions.length, 0, '晋升后建议消失')
})

test('route POST promote：含项目专属标识的条目 400 并给原因，磁盘不动', async () => {
  await freshHome()
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const line = '手机测试一律走 scripts/debug-cli.sh ui'
  await index.load()
  await seedBody('projects/h1/pitfalls.md', '- ' + line)
  await seedBody('projects/h2/pitfalls.md', '- ' + line)
  const rejected = await routeCall({ index, store }, { action: 'promote', text: line })
  assert.equal(rejected.status, 400)
  assert.match(rejected.json.error.message, /项目专属标识/, '原因原样回给面板')
  assert.equal(await store.readForPanel('user.md'), null, '全局层没有被写')
  assert.match(await bodyOf('projects/h1/pitfalls.md'), new RegExp(line), '项目层没有被删')
})

test('route POST promote：建议过期（文本对不上）时 400', async () => {
  await freshHome()
  const { index, store } = await seedCrossProject()
  const stale = await routeCall({ index, store }, { action: 'promote', text: '一条不存在的建议' })
  assert.equal(stale.status, 400)
  assert.match(stale.json.error.message, /已变化|刷新/)
  const empty = await routeCall({ index, store }, { action: 'promote', text: '' })
  assert.equal(empty.status, 400)
  assert.match(empty.json.error.message, /text/)
})

test('route POST promote：全局层写满时 400，项目层回滚不丢数据', async () => {
  await freshHome()
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const full = Array.from({ length: 60 }, (_, i) => '- 全局条目 ' + i).join('\n')
  assert.deepEqual(await store.write('user.md', full), { ok: true })
  await index.load()
  await seedBody('projects/r1/pitfalls.md', '- ' + DUPLICATED)
  await seedBody('projects/r2/pitfalls.md', '- ' + DUPLICATED)
  const rejected = await routeCall({ index, store }, { action: 'promote', text: DUPLICATED })
  assert.equal(rejected.status, 400)
  assert.match(rejected.json.error.message, /已满/, '把 store 的尺寸红线原样告诉用户')
  assert.equal((await store.readForPanel('user.md')).split('\n').length, 60, '全局层没有被追加')
  assert.match(
    await bodyOf('projects/r1/pitfalls.md'),
    new RegExp(DUPLICATED),
    '项目层没有被删（做任何删除之前就失败）',
  )
})

test('route POST promote 不影响原有写动作的响应形状', async () => {
  await freshHome()
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const wrote = await routeCall({ index, store }, { action: 'write', name: 'feedback.md', content: '- 面板写入' })
  assert.equal(wrote.status, 200)
  const value = wrote.json.value
  assert.ok(Array.isArray(value.groups), '写动作也返回分组')
  assert.ok(Array.isArray(value.archived))
  assert.ok(Array.isArray(value.suggestions))
  assert.ok(
    value.groups.flatMap((group) => group.entries).some((entry) => entry.name === 'feedback.md'),
    '新写入的条目落在全局分组里',
  )
})
