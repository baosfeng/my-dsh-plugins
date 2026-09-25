/**
 * 宿主事件契约防回归测试（0.1.5-rc.1 → 0.1.7-rc.2 双版本）。
 *
 * 为什么需要它：cordis 的事件表**只是类型声明**，`ctx.on('<事件名>')` 运行时不校验
 * ——宿主删掉一个事件后，插件侧监听**静默失效**（不报错、不告警、不抛异常），
 * 诊断能力无声消失。宿主 0.1.7-rc.2 把 HMR 换成 @deepseek-ai/dsh-hmr，事件表只剩
 * `hmr/change` / `hmr/reload`，删掉了 `hmr/config-update-failed`，dsh-my-guardian 的
 * "配置热更新失败"诊断就是这样整体丢掉的。既有测试（diagnostics-events.mjs 等）
 * 自己 emit 事件，因此永远抓不到这类回归。
 *
 * 本套件的判据来自**宿主真实事件清单**（test/fixtures/host-events.json，由
 * scripts/host-events.mjs 从参考源 + 已装宿主取证：`interface Events` 声明通道 ∪
 * `ctx.<emit|parallel|...>` 派发通道）：
 *   ① 插件源码里每个 `ctx.on('<事件名>')` 必须命中宿主事件表，否则必须登记
 *      HOST_EVENT_FALLBACKS 降级信号（0.1.7-rc.2 上 hmr/config-update-failed 的
 *      替代可观测量是 dsh-hmr 在同一 catch 里打的结构化 warn）；
 *   ② 降级信号的 marker 字面量必须能在宿主源码里逐字取证（参考源 + 已装宿主）；
 *   ③ fixture 与在场源码的版本/清单必须一致（宿主升级后强制重新取证）；
 *   ④ 降级通道行为：marker → 诊断事件（含紧随的 Error 文本）、双版本去重、不误报、
 *      logger 无 exporter 时静默降级。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as guardian from '../lib/events.js'
import {
  extractFromInstalledHost,
  extractFromSourceTree,
  installedHostDir,
  readFixture,
  referenceDir,
  versionOf,
} from '../scripts/host-events.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..')

/** 被删除/改名事件的替代可观测量登记（缺登记 = 静默失效，本套件红）。 */
const FALLBACKS = guardian.HOST_EVENT_FALLBACKS ?? []
/** 监听表登记（防新增监听忘记登记）。 */
const LISTENED = guardian.LISTENED_HOST_EVENTS ?? []

/**
 * 非宿主事件白名单：本仓库跨插件约定，由 dsh-my-observability 用 ctx.serial 派发
 * （plugins/dsh-my-observability/src/routes.ts），不在宿主事件表内。白名单不是
 * 免检通道——下面的测试要求仓库里存在真实的派发点，否则报错。
 */
const CROSS_PLUGIN_EVENTS = ['plugin:status-query']

/** 静态扫描插件 server 端源码里的 `ctx.on('<事件名>')`。 */
function listenedInSource() {
  const names = new Set()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'client' || name === 'node_modules') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.ts')) {
        for (const match of readFileSync(path, 'utf8').matchAll(/ctx\.on\(\s*'([^']+)'/g)) names.add(match[1])
      }
    }
  }
  walk(join(PLUGIN_ROOT, 'src'))
  return [...names].sort()
}

/** 在目录树里找匹配正则的 .ts 源码（跳过 node_modules/client/lib）。 */
function hasFileMatching(dir, pattern) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'client' || name === 'lib') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (hasFileMatching(path, pattern)) return true
    } else if (name.endsWith('.ts') && pattern.test(readFileSync(path, 'utf8'))) return true
  }
  return false
}

/** 仓库内是否存在该事件的真实派发点（跨插件白名单的取证）。 */
function hasDispatcherInRepo(event) {
  const pattern = new RegExp(`ctx\\.(?:emit|serial|parallel)\\(\\s*'${event}'`)
  const pluginsDir = join(REPO_ROOT, 'plugins')
  return readdirSync(pluginsDir).some((plugin) => {
    const src = join(pluginsDir, plugin, 'src')
    return existsSync(src) && hasFileMatching(src, pattern)
  })
}

test('监听的宿主事件必须在目标宿主事件表内，否则必须有登记过的降级信号', () => {
  const reference = new Set(readFixture().reference.events)
  const covered = new Set(FALLBACKS.map((fallback) => fallback.event))
  const uncovered = listenedInSource().filter(
    (event) => !reference.has(event) && !covered.has(event) && !CROSS_PLUGIN_EVENTS.includes(event),
  )

  assert.deepEqual(
    uncovered,
    [],
    `宿主 ${readFixture().reference.version} 既不声明也不派发这些事件——ctx.on 会静默失效（不报错不告警）。` +
      '要么删掉监听，要么在 src/events.ts 的 HOST_EVENT_FALLBACKS 登记降级信号（并给出宿主源码取证）。',
  )
})

test('跨插件事件白名单必须有仓库内真实派发点（白名单不得变成免检通道）', () => {
  for (const event of CROSS_PLUGIN_EVENTS) {
    assert.ok(hasDispatcherInRepo(event), `${event} 在仓库内找不到 ctx.emit/serial/parallel 派发点，白名单依据失效`)
  }
})

test('降级信号登记与 fixture 取证记录一一对应，且 marker 能在宿主源码里逐字取证', () => {
  const { fallbackEvidence } = readFixture()
  assert.deepEqual(
    FALLBACKS.map((fallback) => fallback.event),
    Object.keys(fallbackEvidence),
    '降级信号登记与 test/fixtures/host-events.json 的 fallbackEvidence 必须同步（跑 node scripts/host-events.mjs --update 重新取证）',
  )
  assert.deepEqual(
    listenedInSource(),
    [...LISTENED, ...CROSS_PLUGIN_EVENTS].sort(),
    '源码里每个 ctx.on 监听都必须归类：宿主事件进 LISTENED_HOST_EVENTS，跨插件约定进 CROSS_PLUGIN_EVENTS',
  )

  for (const fallback of FALLBACKS) {
    const evidence = fallbackEvidence[fallback.event]
    assert.equal(fallback.kind, evidence.signal, '信号类型必须与取证记录一致')
    assert.equal(fallback.marker, evidence.marker, 'marker 必须与取证记录逐字一致')
    assert.equal(fallback.targetSource, evidence.target, '目标宿主取证文件必须与取证记录一致')

    const reference = referenceDir()
    if (reference !== null) {
      const source = readFileSync(join(reference, evidence.target), 'utf8')
      assert.ok(
        source.includes(evidence.marker),
        `${evidence.target} 里找不到 marker "${evidence.marker}"：宿主已改文案，降级通道随之失效，需重新取证`,
      )
    }
    const installed = installedHostDir()
    if (installed !== null) {
      const source = readFileSync(join(installed, evidence.legacy), 'utf8')
      assert.ok(
        source.includes(evidence.marker),
        `${evidence.legacy} 里找不到 marker：0.1.5-rc.1 上"日志 + 事件"双通道并存（去重前提）不再成立`,
      )
    }
  }
})

test('升级目标宿主确实删了事件、当前宿主确实有该事件（双版本依据）', () => {
  const fixture = readFixture()
  assert.ok(
    fixture.installed.events.includes('hmr/config-update-failed'),
    `${fixture.installed.version} 已不再声明/派发 hmr/config-update-failed：宿主升级已完成，该监听 + 降级登记成了死代码——` +
      '要么删掉 ctx.on 与 HOST_EVENT_FALLBACKS 条目（并重跑 node scripts/host-events.mjs --update），要么明确保留对旧宿主的兼容意图',
  )
  assert.ok(
    !fixture.reference.events.includes('hmr/config-update-failed'),
    `${fixture.reference.version} 已删除 hmr/config-update-failed：该监听在新宿主上静默失效`,
  )
  assert.equal(FALLBACKS.find((fallback) => fallback.event === 'hmr/config-update-failed')?.kind, 'logger-warn')
})

test('fixture 与在场源码版本/清单一致（宿主升级后强制重新取证）', () => {
  const fixture = readFixture()
  const reference = referenceDir()
  const installed = installedHostDir()
  if (reference === null && installed === null) {
    console.log('skip: 参考源与已装宿主都不在场（CI 用冻结 fixture 判定）')
    return
  }
  if (reference !== null) {
    assert.equal(
      versionOf(reference),
      fixture.reference.version,
      '参考源版本已变：跑 node scripts/host-events.mjs --update 重新取证并复核插件监听',
    )
    assert.deepEqual(
      extractFromSourceTree([join(reference, 'packages'), join(reference, 'vendor')]),
      fixture.reference.events,
      '参考源事件清单已变：跑 node scripts/host-events.mjs --update',
    )
  }
  if (installed !== null) {
    assert.equal(
      versionOf(installed),
      fixture.installed.version,
      '已装宿主版本已变：跑 node scripts/host-events.mjs --update 重新取证并复核插件监听',
    )
    assert.deepEqual(
      extractFromInstalledHost(installed),
      fixture.installed.events,
      '已装宿主事件清单已变：跑 node scripts/host-events.mjs --update',
    )
  }
})

/** 最小 cordis ctx：记录监听、警告与注册的日志导出器（降级通道）。 */
function makeCtx() {
  const sinks = []
  const warnings = []
  return {
    sinks,
    warnings,
    handlers: new Map(),
    on(event, listener) {
      this.handlers.set(event, listener)
    },
    logger: {
      warn: (message) => warnings.push(message),
      exporter: (sink) => {
        sinks.push(sink)
        return () => {}
      },
    },
  }
}

/** 最小 SharedContext：只用事件环形缓冲与 persistSoon。 */
function makeShared() {
  return {
    state: { events: [] },
    persistCount: 0,
    persistSoon() {
      this.persistCount += 1
    },
  }
}

/** 一条宿主 warn 消息（字段形状取自 cordis LoggerService Message）。 */
function warnMessage(args, name = 'hmr') {
  return { sn: 1, ts: Date.now(), name, type: 'warn', level: 2, args }
}

const MARKER = FALLBACKS.find((fallback) => fallback.kind === 'logger-warn')?.marker ?? ''

test('0.1.7-rc.2 降级通道：宿主 warn 序列记成 update-failed 诊断（含紧随的 Error 文本）', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  guardian.attachEventListeners(ctx, shared)
  assert.equal(ctx.sinks.length, 1, '必须注册日志导出器作为降级通道')

  const sink = ctx.sinks[0]
  sink.export(warnMessage([MARKER, 'cordis.yml']))
  assert.equal(shared.state.events.length, 1, 'marker warn 立刻记一条诊断')
  assert.equal(shared.state.events[0].type, 'update-failed')
  assert.ok(shared.state.events[0].message.startsWith('cordis.yml: '), '带文件名的占位记录')
  assert.deepEqual(ctx.warnings, ['[dsh-my-guardian] config update failed (rolled back): cordis.yml'])
  assert.equal(shared.persistCount, 1, '失败后立刻落盘')

  sink.export(warnMessage([new Error('Unexpected token in patch file')]))
  assert.equal(
    shared.state.events[0].message,
    'cordis.yml: Unexpected token in patch file',
    '紧随的 Error warn 补齐真实原因',
  )
  assert.equal(shared.state.events.length, 1, '补齐是就地更新，不新增记录')
})

test('降级通道不误报：非 warn、无 marker、异名 logger、Error 之外的单参 warn 都不产生诊断', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  guardian.attachEventListeners(ctx, shared)
  const sink = ctx.sinks[0]
  sink.export(warnMessage([MARKER, 'cordis.yml']))
  assert.equal(shared.state.events.length, 1)

  sink.export({ ...warnMessage(['other warning']), type: 'info' })
  sink.export(warnMessage(['config reload at %C ok', 'cordis.yml']))
  sink.export(warnMessage([new Error('unrelated')], 'other-logger'))
  sink.export(warnMessage(['plain string warn']))
  sink.export({ ...warnMessage([MARKER, 'broken.yml']), args: undefined })
  assert.equal(shared.state.events.length, 1, '只有 marker 才记诊断')
  assert.equal(shared.state.events[0].message, 'cordis.yml: (error detail logged by host)', '异名/异形 warn 不补齐')
})

test('双版本去重：0.1.5-rc.1 上同一失败经"日志 + 事件"两条通道到达只记一条', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  guardian.attachEventListeners(ctx, shared)

  ctx.sinks[0].export(warnMessage([MARKER, 'cordis.yml']))
  ctx.sinks[0].export(warnMessage([new Error('boom')]))
  ctx.handlers.get('hmr/config-update-failed')('cordis.yml', new Error('boom'))
  assert.deepEqual(
    shared.state.events.map((event) => event.message),
    ['cordis.yml: boom'],
    '同一失败只记一条',
  )
  assert.equal(shared.persistCount, 1)

  ctx.handlers.get('hmr/config-update-failed')('other.yml', 'plain failure')
  assert.equal(shared.state.events.length, 2, '不同文件名的失败照常记录')
})

test('降级通道静默降级：logger 缺失或无 exporter 时不得抛异常', () => {
  const bare = makeCtx()
  delete bare.logger
  assert.doesNotThrow(() => guardian.attachEventListeners(bare, makeShared()))

  const minimal = makeCtx()
  minimal.logger = { warn: () => {} }
  assert.doesNotThrow(() => guardian.attachEventListeners(minimal, makeShared()), '老/最小 ctx 无 exporter：静默降级')
})

test('窗口过期分支：去重窗口过期后照常记录，配对窗口过期则不补齐（注入时钟驱动）', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  let clock = 1000
  const failures = guardian.createConfigFailureTracker(ctx, shared, () => clock)

  failures.fromEvent('cordis.yml', new Error('boom'))
  failures.fromEvent('cordis.yml', new Error('boom again'))
  assert.deepEqual(
    shared.state.events.map((event) => event.message),
    ['cordis.yml: boom'],
    '窗口内同一文件名的重复失败去重',
  )

  clock += 1001
  failures.fromEvent('cordis.yml', new Error('boom later'))
  assert.equal(shared.state.events[1].message, 'cordis.yml: boom later', '窗口过期后照常记录')

  failures.fromLogMarker('late.yml', 'hmr')
  assert.equal(shared.state.events[2].message, 'late.yml: (error detail logged by host)')
  clock += 100
  failures.fromLogDetail(new Error('too late'), 'hmr')
  assert.equal(shared.state.events[2].message, 'late.yml: (error detail logged by host)', '配对窗口过期不补齐')

  failures.fromLogDetail(new Error('no pending marker'), 'hmr')
  assert.equal(shared.state.events.length, 3, '无 pending 时的 Error warn 直接忽略')
})

test('去重表有上限：大量不同文件名的失败不抛异常且状态缓冲仍受环形上限约束', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  const failures = guardian.createConfigFailureTracker(ctx, shared)
  assert.doesNotThrow(() => {
    for (let index = 0; index < 60; index += 1) failures.fromEvent(`patch-${index}.yml`, new Error('boom'))
  })
  assert.equal(shared.state.events.length, 20, '环形缓冲上限 20 条不变')
})
