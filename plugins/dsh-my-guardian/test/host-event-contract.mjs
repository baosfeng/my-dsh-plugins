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
 *   ② 降级信号的 marker 字面量必须能在宿主源码里逐字取证（参考源 + 已装宿主；
 *      已装宿主侧扫 @deepseek-ai/<pkg>/lib，**不绑定包名**——宿主重构 HMR 包也不失效）；
 *   ③ fixture 与在场源码的版本/清单必须一致（宿主升级后强制重新取证）；
 *   ④ 降级通道行为：marker → 诊断事件（含紧随的 Error 文本）、双版本去重、不误报、
 *      logger 无 exporter 时静默降级。
 *
 * 宿主升级到 0.1.7-rc.2 之后：已装宿主与参考源同版本，`hmr/config-update-failed` 在
 * 两个通道里都不存在——旧宿主取证源 cordis-plugin-hmr 随升级被删，改由
 * HOST_EVENT_FALLBACKS[*].legacyRetired 显式登记退役（不许"文件不在场就跳过"，
 * 否则取证强度静默降级）；该包一旦重新在场，退役登记即视为过期，必须恢复逐字取证。
 * `loader/entry-init` / `loader/partial-dispose` 在新宿主仍由 cordis-plugin-loader 派发。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { closeSync, existsSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as guardian from '../lib/events.js'
import {
  extractFromInstalledHost,
  extractFromSourceTree,
  findMarkerInInstalledHost,
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

/**
 * 用**同一个 fd**读文本：openSync 拿 fd → readFileSync(fd)。
 *
 * 为什么不能 `statSync(path)` / `existsSync(path)` 之后 `readFileSync(path)`：检查与使用
 * 按**路径名**分成两次系统调用，两步之间文件可能被替换/删除（TOCTOU）。CodeQL
 * js/file-system-race（CWE-367，security_severity=high）：The file may have changed since
 * it was checked —— 规则建议 "use file descriptors instead of file names"。issue #116/#117。
 * 与 scripts/fork-pool.mjs、scripts/test/client-artifacts.test.mjs、
 * plugins/dsh-my-remote/test/helpers/isolated-home.mjs 同一手法（仓库既有惯例）。
 */
function readFileViaFd(path) {
  const fd = openSync(path, 'r')
  try {
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * 静态扫描插件 server 端源码里的 `ctx.on('<事件名>')`。
 *
 * 目录项类型直接取自 readdir 自身（`withFileTypes` 的 Dirent），不再
 * `statSync(path).isDirectory()` 预检后再按路径递归/读取——那是 check-then-use，
 * 两步之间路径可被替换（CodeQL js/file-system-race，issue #116）。
 * 本仓库源码树约定不含指向目录的软链（client/node_modules 已跳过），Dirent 判定与
 * 原 statSync 判定在本树等价；`.ts` 内容读取仍走 fd，软链文件语义不变。
 */
function listenedInSource() {
  const names = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'client' || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) {
        for (const match of readFileViaFd(path).matchAll(/ctx\.on\(\s*'([^']+)'/g)) names.add(match[1])
      }
    }
  }
  walk(join(PLUGIN_ROOT, 'src'))
  return [...names].sort()
}

/** 在目录树里找匹配正则的 .ts 源码（跳过 node_modules/client/lib）。 */
function hasFileMatching(dir, pattern) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'client' || entry.name === 'lib') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (hasFileMatching(path, pattern)) return true
    } else if (entry.name.endsWith('.ts') && pattern.test(readFileViaFd(path))) return true
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
    if (installed === null) continue
    // 旧宿主取证：包仍在场 ⇒ 逐字比对（原强校验）；已随升级移除 ⇒ 必须有显式退役登记。
    const legacyPath = fallback.legacySource ?? fallback.legacyRetired?.source
    const legacyInPlace = legacyPath !== undefined && existsSync(join(installed, legacyPath))
    if (legacyInPlace) {
      assert.equal(
        evidence.legacyRetired,
        undefined,
        `旧宿主包 ${legacyPath} 又在场：退役登记已过期，必须恢复 legacySource 与逐字取证`,
      )
      const source = readFileSync(join(installed, legacyPath), 'utf8')
      assert.ok(
        source.includes(evidence.marker),
        `${legacyPath} 里找不到 marker：0.1.5-rc.1 上"日志 + 事件"双通道并存（去重前提）不再成立`,
      )
    } else {
      const retired = evidence.legacyRetired
      assert.ok(
        retired !== undefined,
        `${fallback.event} 的旧宿主取证源 ${legacyPath ?? '(未登记)'} 不在场且无 legacyRetired 退役登记——` +
          '取证静默降级：必须在 src/events.ts 与 fixture 里显式登记退役事实',
      )
      assert.equal(fallback.legacyRetired?.version, retired.version, '退役宿主版本必须与取证记录一致')
      assert.equal(fallback.legacyRetired?.source, retired.source, '退役宿主取证坐标必须与取证记录一致')
      assert.equal(fallback.legacyRetired?.reason, retired.reason, '退役原因必须与取证记录一致')
    }
    // 当前宿主（升级后与参考源同版本）里的 marker 也必须逐字可取，且不绑定包名：
    // 宿主把 cordis-plugin-hmr 换成 dsh-hmr 这类重构不该让这条取证失效。
    const hits = findMarkerInInstalledHost(installed, evidence.marker)
    assert.ok(
      hits.length > 0,
      `已装宿主 ${versionOf(installed)} 的 @deepseek-ai/*/lib 里找不到 marker "${evidence.marker}"：降级通道失效`,
    )
  }
})

test('目标宿主没有 hmr/config-update-failed：必须有降级通道 + 退役登记（不许留无主死代码）', () => {
  const fixture = readFixture()
  assert.ok(
    !fixture.reference.events.includes('hmr/config-update-failed'),
    `${fixture.reference.version} 仍在声明/派发 hmr/config-update-failed：宿主并未删除该事件，降级登记需复核`,
  )
  assert.ok(
    !fixture.installed.events.includes('hmr/config-update-failed'),
    `${fixture.installed.version} 仍在声明/派发 hmr/config-update-failed：fixture 与在场宿主不一致（重跑 --update），` +
      '或确实存在双版本宿主——此时旧宿主包仍应在场，必须恢复 legacySource 逐字取证（退役登记视为过期）',
  )
  const fallback = FALLBACKS.find((item) => item.event === 'hmr/config-update-failed')
  assert.equal(fallback?.kind, 'logger-warn', '被删事件的诊断职责必须由结构化 warn 通道接手')
  assert.ok(
    fallback?.legacyRetired !== undefined,
    '两个通道都不声明/派发该事件：保留的 ctx.on 只剩"已退役宿主兼容"，必须显式登记 legacyRetired；' +
      '若不再需要兼容，则删掉 ctx.on 与 HOST_EVENT_FALLBACKS 条目并同步 LISTENED_HOST_EVENTS',
  )
  assert.ok(LISTENED.includes('hmr/config-update-failed'), 'LISTENED_HOST_EVENTS 必须登记该监听（否则监听表漏项）')
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

/**
 * 防复发（CodeQL js/file-system-race 同语义自查，issue #116/#117）。
 * 判据：本套件里不得存在「同一个路径变量先检查（stat/exists/access）再 readFileSync 读取」——
 * 检查与使用按路径名分成两次系统调用，中间是 TOCTOU 窗口。目录项类型取自
 * readdirSync(dir, { withFileTypes: true })，内容读取走 readFileViaFd（openSync → readFileSync(fd)）。
 * 匹配前先剥掉注释：注释里的示例代码（本文档字符串）不是可执行路径，不该被当违规。
 */
test('本套件自身不含 check-then-use：不存在「按路径检查 → 按路径读」的窗口', () => {
  const source = readFileViaFd(fileURLToPath(import.meta.url))
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const checkPattern = /\b(?:statSync|existsSync|lstatSync|accessSync)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g
  const readPattern = /\breadFileSync\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g
  const checked = new Set([...code.matchAll(checkPattern)].map((match) => match[1]))
  const raced = [...code.matchAll(readPattern)].map((match) => match[1]).filter((name) => checked.has(name))

  assert.deepEqual(
    raced,
    [],
    '同一路径变量先 statSync/existsSync 再 readFileSync 就是 TOCTOU 窗口（两步之间文件可被替换/删除）：' +
      '目录项类型改用 readdirSync(dir, { withFileTypes: true })，内容读取改用 openSync 拿 fd 后 readFileSync(fd)。',
  )
})
