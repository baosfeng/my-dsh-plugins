/**
 * dsh-my-guardian — diagnostic event log (ring buffer in state) and the loader
 * event listeners that feed it.
 */
import { ERROR_SNIP, EVENT_LIMIT } from './state.js'
import type { DiagnosticEvent, SharedContext } from './state.js'
import type { DshContext, LoaderEntry, LogMessage } from './types.js'

/** Append a diagnostic event to the shared state's ring buffer. */
export function logEvent(shared: SharedContext, type: string, message: string): DiagnosticEvent {
  const record: DiagnosticEvent = {
    time: Date.now(),
    type,
    message: String(message).slice(0, ERROR_SNIP),
  }
  shared.state.events.push(record)
  if (shared.state.events.length > EVENT_LIMIT) shared.state.events.splice(0, shared.state.events.length - EVENT_LIMIT)
  return record
}

/**
 * 本插件监听的宿主事件名（登记表）。
 *
 * 判据在 test/host-event-contract.mjs：这些名字必须命中**目标宿主真实事件表**
 * （test/fixtures/host-events.json，由 scripts/host-events.mjs 从宿主源码取证：
 * `interface Events` 声明 ∪ `ctx.<emit|parallel|...>` 派发）。新增/删除 ctx.on 时必须
 * 同步本表——注册一个宿主从不派发的事件既不触发也不报错，是最难发现的失效面（#429）。
 *
 * 两条 loader 事件都是官方**公开**契约：`@deepseek-ai/cordis-plugin-loader` 的
 * `interface Events` 声明（lib/types/index.d.ts:22/23）+ `Entry` 构造函数与
 * `EntryGroup.remove()` 里的 `this.context.emit(...)` 派发，官方文档
 * docs/cordis-api/inherited.md 亦逐条列出；它们**不是** cordis 的 internal/* 内部事件。
 * "真会触发"由 test/host-event-live.mjs 用**真实 loader** 证明（mock ctx 自己调
 * handler 的测试证明不了）。
 *
 * `hmr/config-update-failed` 只在 0.1.5-rc.1 存在过，0.1.7-rc.2 起被彻底删除
 * （参考源 + 已装宿主双向 0 命中）：其 ctx.on 已移除，诊断职责全部由
 * HOST_EVENT_FALLBACKS 登记的结构化 warn 通道承担。
 */
export const LISTENED_HOST_EVENTS: readonly string[] = ['loader/entry-init', 'loader/partial-dispose']

/** 宿主在配置热更新失败点打的结构化 warn 首参（逐字取自宿主源码，测试会校验）。 */
const CONFIG_FAILURE_MARKER = 'config reload at %C failed'

/** cordis exporter 的 verbosity 阈值：2 = 收 warn 及更严重的消息（error/warn）。 */
const WARN_LEVEL = 2

/** marker 之后紧跟的 `ctx.logger.warn(error)` 配对窗口（ms）。 */
const PAIR_WINDOW_MS = 50

/** 双版本去重窗口（ms）：0.1.5-rc.1 上同一失败既打日志又发事件。 */
const DEDUP_WINDOW_MS = 1000

/** 去重表上限（长跑内存护栏）。 */
const DEDUP_LIMIT = 50

/** marker 先到时错误文本未知的占位（紧随的 Error warn 会补齐）。 */
const PENDING_DETAIL = '(error detail logged by host)'

/** 一条宿主事件监听的降级信号登记。 */
export interface HostEventFallback {
  /** 在目标宿主上不存在（被删除/改名）的宿主事件名。 */
  event: string
  /** 替代可观测量类型：`logger-warn` = 宿主结构化日志 + ctx.logger.exporter。 */
  kind: string
  /** 降级信号的逐字标记（宿主源码里的 warn 首参）。 */
  marker: string
  /** 目标宿主（参考源）里该标记的取证文件（仓库相对路径）。 */
  targetSource: string
  /** 旧宿主里同一标记的取证文件——仅当该旧宿主包仍在场时登记（在场即逐字校验）。 */
  legacySource?: string
  /** 旧宿主退役登记：该宿主包已随升级从已装宿主移除，legacySource 无法再在场取证。 */
  legacyRetired?: LegacyRetiredHost
}

/**
 * 已退役宿主登记（旧宿主包不在场时替代 legacySource 的显式记录）。
 *
 * 为什么需要它：legacySource 的校验是"文件在场即逐字比对"。旧宿主包随宿主升级被删掉
 * 后该文件永久不在场——若简单地"不在场就跳过"，取证强度会**静默降级**（正是本套件要
 * 拦住的失效模式）。所以要求显式登记退役事实（版本 + 原坐标 + 原因），并由测试守卫：
 * 该包一旦重新在场（宿主回退），退役登记即视为过期，必须恢复逐字取证。
 */
export interface LegacyRetiredHost {
  /** 退役的宿主版本。 */
  version: string
  /** 该宿主里降级 marker 的原始取证坐标（已装宿主相对路径，现已不存在）。 */
  source: string
  /** 退役原因。 */
  reason: string
}

/**
 * 降级信号登记：宿主 0.1.7-rc.2 把 HMR 换成 @deepseek-ai/dsh-hmr，事件表只剩
 * `hmr/change` / `hmr/reload` —— `hmr/config-update-failed` 被删除。
 *
 * issue #429：该事件的 `ctx.on` **已删除**。注册一个宿主从不派发的事件既不触发也不
 * 报错（cordis 运行时不校验事件名），留着它只能制造"有监听=有诊断"的错觉；而它对旧
 * 宿主也是**冗余**的——两个版本在同一 catch 里先打同一对 warn、旧版才补发事件（见下），
 * 日志通道在两个宿主上都先到。所以移除监听**不损失任何诊断能力**，本登记表继续存在
 * 只为：① 守住 marker 文案（宿主改文案 ⇒ 通道失效 ⇒ 测试红）；② 记录取证坐标与退役事实。
 *
 * 替代可观测量（逐字取证，非猜测）：0.1.5-rc.1 的 cordis-plugin-hmr 与 0.1.7-rc.2 的
 * dsh-hmr **在同一个 catch 里先打同一对 warn、然后旧版才发事件**：
 *   ctx.logger.warn('config reload at %C failed', filename); ctx.logger.warn(error)
 * （旧：cordis-plugin-hmr/lib/index.js；新：packages/boot/hmr/src/watch-config.ts，
 *   已装宿主 0.1.7-rc.2 对应 node_modules/@deepseek-ai/dsh-hmr/lib/index.js）
 * 所以结构化日志是两个宿主共有的可观测面，用它接手被删事件的诊断职责。
 *
 * 宿主升级到 0.1.7-rc.2 之后：已装宿主也变成 0.1.7-rc.2，`hmr/config-update-failed`
 * 在两个通道里都不存在——该 `ctx.on` 只剩"已退役 0.1.5-rc.1 兼容"意义（注册未知
 * 事件不报错，回退宿主仍可诊断），因此 legacySource 转为 legacyRetired 退役登记。
 * 新宿主的诊断职责全部由结构化 warn 通道承担（marker 在参考源与已装宿主双向取证）。
 */
export const HOST_EVENT_FALLBACKS: readonly HostEventFallback[] = [
  {
    event: 'hmr/config-update-failed',
    kind: 'logger-warn',
    marker: CONFIG_FAILURE_MARKER,
    targetSource: 'packages/boot/hmr/src/watch-config.ts',
    legacyRetired: {
      version: '0.1.5-rc.1',
      source: 'node_modules/@deepseek-ai/cordis-plugin-hmr/lib/index.js',
      reason:
        '0.1.7-rc.2 以 @deepseek-ai/dsh-hmr 取代 cordis-plugin-hmr，旧包已从已装宿主移除，双通道并存的在场取证不可复现',
    },
  },
]

/** 配置热更新失败的到达通道（结构化日志；事件通道已随 #429 移除）。 */
export interface ConfigFailureTracker {
  /** 日志通道 marker：0.1.7-rc.2 起唯一的失败信号。 */
  fromLogMarker(filename: unknown, loggerName: unknown): void
  /** 日志通道紧随其后的 Error warn：补齐 marker 记录的错误文本。 */
  fromLogDetail(error: unknown, loggerName: unknown): void
}

/** 失败原因文本：Error 取 message、其他字符串化、未配对到时给占位。 */
function failureText(error: unknown): string {
  if (error === undefined) return PENDING_DETAIL
  return error instanceof Error ? error.message : String(error)
}

/**
 * 创建"配置热更新失败"记录器（两条通道共用一张最近失败表）。
 *
 * 去重依据同上：旧宿主在同一个 catch 里先 warn 再发事件，同一失败会经两条通道
 * 到达（日志通道在前），只记一条；不同文件名照常各记一条。
 * @param ctx DSH server 端 Context。
 * @param shared 插件共享状态（环形缓冲 + 落盘）。
 * @param now 注入时钟（默认 Date.now；测试用于验证窗口过期分支）。
 */
export function createConfigFailureTracker(
  ctx: DshContext,
  shared: SharedContext,
  now: () => number = Date.now,
): ConfigFailureTracker {
  const recent = new Map<string, number>()
  let pending: { record: DiagnosticEvent; key: string; name: unknown; at: number } | undefined

  /** 该文件名在去重窗口内是否首次失败。 */
  const firstTime = (key: string): boolean => {
    const time = now()
    const last = recent.get(key)
    if (last !== undefined && time - last < DEDUP_WINDOW_MS) return false
    recent.set(key, time)
    if (recent.size > DEDUP_LIMIT) recent.delete(String(recent.keys().next().value))
    return true
  }

  const write = (filename: unknown, error: unknown): DiagnosticEvent | undefined => {
    const key = String(filename)
    if (!firstTime(key)) return undefined
    const record = logEvent(shared, 'update-failed', `${key}: ${failureText(error)}`)
    ctx.logger?.warn(`[dsh-my-guardian] config update failed (rolled back): ${key}`)
    shared.persistSoon()
    return record
  }

  return {
    fromLogMarker(filename, loggerName) {
      const record = write(filename, undefined)
      if (record !== undefined) pending = { record, key: String(filename), name: loggerName, at: now() }
    },
    fromLogDetail(error, loggerName) {
      const state = pending
      pending = undefined
      if (state === undefined) return
      if (now() - state.at > PAIR_WINDOW_MS || loggerName !== state.name) return
      state.record.message = `${state.key}: ${failureText(error)}`.slice(0, ERROR_SNIP)
    },
  }
}

/**
 * 注册结构化日志降级通道（0.1.7-rc.2 起被删事件的替代可观测量）。
 *
 * `ctx.logger.exporter()` 是 cordis 日志服务的公开扩展点：注册的 exporter 随当前
 * fiber 释放（实测插件卸载后 exporter 一并移除，不泄漏），收到的是**未格式化的**
 * 结构化消息（`args` 里的 marker 字面量可直接比对，无需解析格式串）。
 * logger 缺失或没有 exporter（老/最小 ctx）时静默降级，不抛异常。
 */
function attachConfigFailureLogFallback(ctx: DshContext, failures: ConfigFailureTracker): void {
  const logger = ctx.logger
  if (logger === undefined || typeof logger.exporter !== 'function') return
  logger.exporter({
    levels: { default: WARN_LEVEL },
    export(message: LogMessage) {
      if (message?.type !== 'warn') return
      const args = Array.isArray(message.args) ? message.args : []
      if (args[0] === CONFIG_FAILURE_MARKER) {
        failures.fromLogMarker(args[1], message.name)
      } else if (args.length === 1 && args[0] instanceof Error) {
        failures.fromLogDetail(args[0], message.name)
      }
    },
  })
}

/**
 * Register the loader/HMR diagnostic listeners (R9/R10)。
 *
 * 只注册目标宿主**真实派发**的 loader 事件（见 LISTENED_HOST_EVENTS）：热挂载/卸载与
 * 进程收尾都会派发它们，"真会触发"由 test/host-event-live.mjs 用真实 loader 证明。
 * 配置热更新失败**没有事件监听**（`hmr/config-update-failed` 在 0.1.7-rc.2 已删除，见
 * HOST_EVENT_FALLBACKS）：唯一通道是结构化 warn，由 attachConfigFailureLogFallback 注册。
 */
export function attachEventListeners(ctx: DshContext, shared: SharedContext): void {
  const failures = createConfigFailureTracker(ctx, shared)
  /**
   * loader 生命周期诊断：**记录后立刻排队落盘**，与同一子系统的其它写点同一约定
   * （promote/quarantine 在 mount.ts、update-failed 在本文件下方）。
   *
   * 为什么不能只写内存（#438）：诊断写入与进程退出是竞态。宿主卸载整树时同批 disposer
   * 由 `Promise.all` 并发执行、顺序无保证，`loader/partial-dispose` 可能晚于 teardown 的
   * 收尾快照到达；此时若没有排队落盘，事件就只剩内存副本，进程一退就永久丢失 ——
   * 事后无法回答「收尾时哪些 entry 被释放」。
   */
  const record = (type: string, message: string): void => {
    logEvent(shared, type, message)
    shared.persistSoon()
  }
  ctx.on('loader/entry-init', (entry: unknown) => {
    // loader 在 Entry **构造函数**里 emit（vendor/loader/src/config/entry.ts:58），此刻
    // `entry.options` 还是空对象（同文件 :50），同步读取只能记成 "entry ? initialized" ——
    // 标识丢失的诊断等于没有诊断（隔离实例实测）。构造完成后同一次 `create()` 内 options
    // 才被赋值（entry.ts:120），所以推迟一个 microtask 再落笔：那时 options.id 已可用，
    // 且依然只读 options —— 绝不碰 entry.id getter（见 entryLabelOf 的警告）。
    queueMicrotask(() => {
      record('entry-init', `entry ${entryLabelOf(entry)} initialized`)
    })
  })
  ctx.on('loader/partial-dispose', (entry: unknown) => {
    record('entry-dispose', `entry ${entryLabelOf(entry)} disposed`)
  })
  attachConfigFailureLogFallback(ctx, failures)
}

/**
 * entry 可读标识——⚠️ 只读 options 字段，绝不访问 `entry.id` getter：
 * loader 在 Entry **构造函数中** emit `loader/entry-init`，此时
 * `parent.tree` 尚未就绪，访问 getter 会抛 "Cannot read properties of
 * undefined (reading 'tree')" —— 这个异常发生在启动阶段，会让整个
 * DSH 服务起不来（守护插件自己炸启动，实锤隔离实例复现）。
 */
function entryLabelOf(entry: unknown): string {
  if (entry === null || typeof entry !== 'object') return '?'
  const options = (entry as LoaderEntry).options
  if (options !== null && typeof options === 'object') {
    if (options.id !== undefined && options.id !== null) return String(options.id)
    if (typeof options.name === 'string' && options.name !== '') return options.name
  }
  return '?'
}
