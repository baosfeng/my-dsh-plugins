/**
 * dsh-file-activity — host half.
 *
 * Tracks file activity for dsh-better-sidebar:
 *  - agent tool file operations arrive as `fs/observed` events (read / write /
 *    edit / str_replace_editor / read_image ...), with the tool execution as
 *    the actor (name + parsed arguments + owning agent).
 *  - bash tool calls carry file-touching commands (rm/touch/mv/…): the
 *    `tools/pre-execute` observer parses them and records the intents.
 *  - sidebar operations (files opened / saved through the better-sidebar
 *    explorer & editor) are reported by our client half through the
 *    `/file-activity/api/record` route.
 *
 * State (recent history + per-file counts) is kept per session and persisted
 * to $DSH_HOME/file-activity.json as **JSON Lines**: 每条记录追加一行
 * （落盘字节 ≈ 事件本体字节），累计行数达自适应阈值时原子 compact（issue #197：
 * 旧实现每次防抖全量重写，写放大 3,665×）。入口三维上限（会话 / 每会话路径 /
 * 全局路径）超限按 LRU 淘汰并告警 —— 内存与状态文件均有界。
 */
import { isTrustedApiRequest } from 'dsh-shared'
import { createApiHandler } from './api-route.js'
import { createMediaHandler } from './media-route.js'
import { createFsObserver } from './observer.js'
import { createStore } from './store.js'
import { parseBashFileOps } from './bash-parse.js'
import { sessionCwdOf } from './cwd.js'
import type { ActivityStore, DshContext, ServerRequest } from './types.js'

export const name = 'dsh-file-activity'

export const inject = ['webServer', 'sessions', 'webRuntime']

/** bash 工具调用 exec 的最小契约（agent.id / arguments.command / workdir）。 */
interface BashExec {
  name?: unknown
  agent?: { id?: unknown }
  arguments?: { command?: unknown; workdir?: unknown } | null
}

/** 观察型监听：只读取 bash 命令隐含的文件操作并上报，不拦截（返回 next()）。 */
function observeBashIntents(exec: unknown, ctx: DshContext, store: ActivityStore): void {
  const sessionId = bashSessionOf(exec)
  const command = bashCommandOf(exec)
  if (sessionId === '' || command === '') return
  const baseDir = bashBaseDirOf(exec, ctx, sessionId)
  for (const touched of parseBashFileOps(command, baseDir)) {
    store.record(sessionId, touched.path, touched.op, Date.now())
  }
}

/** 会话 id：仅 bash 工具、agent id 非空时返回。 */
function bashSessionOf(exec: unknown): string {
  if ((exec as BashExec | null | undefined)?.name !== 'bash') return ''
  const id = (exec as BashExec).agent?.id
  return typeof id === 'string' && id !== '' ? id : ''
}

/** 命令文本：仅非空字符串时返回。 */
function bashCommandOf(exec: unknown): string {
  const command = (exec as BashExec).arguments?.command
  return typeof command === 'string' && command !== '' ? command : ''
}

/** 相对路径基准：workdir 参数优先，否则会话 cwd。 */
function bashBaseDirOf(exec: unknown, ctx: DshContext, sessionId: string): string {
  const workdir = (exec as BashExec).arguments?.workdir
  return typeof workdir === 'string' && workdir !== '' ? workdir : sessionCwdOf(ctx, sessionId)
}

export function apply(ctx: DshContext): void {
  const store = createStore(ctx)

  // ── agent-side file operations ──────────────────────────────────────────
  ctx.on('fs/observed', createFsObserver(store.record))
  ctx.on('tools/pre-execute', (exec, next) => {
    observeBashIntents(exec, ctx, store)
    return next()
  })

  // ── routes ──────────────────────────────────────────────────────────────
  const fence = (request: ServerRequest): boolean => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/file-activity/api',
        handler: createApiHandler({ ctx, store, fence }),
      }),
    'dsh-file-activity: /file-activity/api routes',
  )

  // Media route for the floating preview (see media-route.js for the
  // authorization model: recorded paths only, same trust fence).
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/file-activity/file',
        handler: createMediaHandler({ ctx, store, fence }),
      }),
    'dsh-file-activity: /file-activity/file media route',
  )

  // 插件状态查询（#155 聚合层）
  ctx.on('plugin:status-query', ({ plugin }) => {
    if (plugin !== 'dsh-file-activity') return undefined
    const sessions = store.state?.sessions ?? {}
    const totalFiles = Object.values(sessions).reduce((n, s) => n + Object.keys(s.known ?? {}).length, 0)
    const allRecent = Object.values(sessions).flatMap((s) => s.recent ?? [])
    allRecent.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
    const lastActions = allRecent.slice(0, 5).map((e) => ({ time: e.time, type: e.op ?? 'activity', detail: e.path }))
    return {
      ok: true,
      value: {
        plugin: 'dsh-file-activity',
        config: { keys: [] },
        running: true,
        stats: { sessions: Object.keys(sessions).length, totalFiles },
        lastActions,
      },
    }
  })

  // Tear down on unload: flush pending persistence.
  ctx.effect(() => store.dispose, 'dsh-file-activity: persistence teardown')
}
