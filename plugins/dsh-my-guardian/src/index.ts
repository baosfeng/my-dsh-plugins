/**
 * dsh-my-guardian — server half (entry point).
 *
 * Plugin guardian: staged loading, failure isolation and a safe mode for the
 * DSH profile plugin roster.
 *
 * DSH boots Cordis plugin trees all-or-nothing: any row that fails to import,
 * throws during apply, or stays pending takes the whole `dsh web` process
 * down (fail-loud). This plugin gives new/updated plugins a staging area
 * instead of the boot path:
 *
 *   cordis.staged.json (the candidate file, next to cordis.patch.yml)
 *       │  (guardian mounts each entry AFTER boot, through the live loader
 *       │   tree's root group — runtime mounts are catchable & rollback-safe)
 *       ├─ success → PROMOTED: entry moves into the guardian's own persisted
 *       │            list (state.json) and is mounted again on every start
 *       └─ failure → quarantined: attempts counter + error recorded; after
 *                    FREEZE_LIMIT consecutive failures the entry is frozen
 *                    and only a manual retry (panel / API) unfreezes it
 *
 * Safe mode (state.safeMode) skips every staged/promoted mount — a one-click
 * way to recover an environment a new plugin broke.
 *
 * Self-protection (watchdog): every async path is caught; only the loader
 * service is a hard dependency; webServer/webRuntime are optional (a CLI
 * profile without a web surface still gets staged loading, just no HTTP
 * panel). The guardian never rewrites cordis.patch.yml; its own state lives
 * at $DSH_HOME/guardian/state.json (atomic tmp+rename).
 *
 * Modules: state.ts (persistence) · events.ts (diagnostic log) · mount.ts
 * (staged/promoted mount pipeline) · api.ts (/guardian/api routes) ·
 * startup-check.ts (roster pre-check). This file only wires them together.
 */
import { watch } from 'node:fs'
import { join } from 'node:path'
import { createPersister, createState } from './state.js'
import type { SharedContext } from './state.js'
import { findRootTree, createMountOps, initialScan } from './mount.js'
import { createApi } from './api.js'
import { attachEventListeners, logEvent } from './events.js'
import { runStartupCheck } from './startup-check.js'
import type { DshContext, LoaderTree } from './types.js'

export const name = 'dsh-my-guardian'

export const inject = ['loader', 'timer']

/** Fallback poll interval for the staged file when fs.watch is unavailable. */
const POLL_MS = 4000

export function apply(ctx: DshContext): void {
  // Watchdog self-protection: the guardian itself must never take the process
  // down. Any synchronous failure inside apply degrades the guardian (no
  // staged loading) instead of failing the whole boot (fail-loud).
  try {
    applyInner(ctx)
  } catch (error) {
    ctx.logger?.warn(
      `[dsh-my-guardian] apply failed — guardian degraded: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function applyInner(ctx: DshContext): void {
  const root = findRootTree(ctx.loader)
  if (root === null) {
    ctx.logger?.warn('[dsh-my-guardian] no include tree found — guardian inactive')
    return
  }
  const shared = createShared(root)
  wireServices(ctx, shared)
  scheduleInitialScan(ctx, shared)
  startWatchers(ctx, shared)
  registerTeardown(ctx, shared)
  registerStatusQuery(ctx, shared)
}

/** Mutable per-instance runtime context shared by every sub-module. */
function createShared({ tree, profileDir }: { tree: LoaderTree; profileDir: string }): SharedContext {
  const shared: SharedContext = {
    state: createState(),
    ready: false,
    attempted: new Set(),
    mounted: new Set(),
    writeChain: Promise.resolve(),
    watcher: null,
    apiRegistered: false,
    tree,
    profileDir,
    stagedFile: join(profileDir, 'cordis.staged.json'),
    // startup-roster pre-check (issue #144): filled by runStartupCheck
    startupIssues: [],
    startupCheckedAt: null,
    persistSoon: () => {},
    logEvent: (_type: string, _message: string) => {},
    // Mount ops — filled by wireServices via Object.assign
    conflictOf: () => null,
    mount: async () => {},
    unmount: async () => {},
    mountWithState: async () => 'skipped',
    processStagedEntry: async () => {},
    mountPromoted: async () => {},
    scanStaged: async () => {},
    retryEntry: async () => null,
    removeEntry: async () => {},
    // API ops — filled by wireServices via Object.assign
    ensureApi: () => {},
    snapshot: () => ({}),
  }
  return shared
}

/** Bind persister, event log, mount ops, API and listeners onto shared. */
function wireServices(ctx: DshContext, shared: SharedContext): void {
  shared.persistSoon = createPersister(shared).persistSoon
  shared.logEvent = (type: string, message: string) => logEvent(shared, type, message)
  Object.assign(shared, createMountOps(shared))
  Object.assign(shared, createApi(ctx, shared))
  attachEventListeners(ctx, shared)
}

// ── run after boot settles ──────────────────────────────────────────────
function scheduleInitialScan(ctx: DshContext, shared: SharedContext): void {
  void Promise.resolve().then(() => {
    // Startup-roster static pre-check (issue #144): best-effort, MUST never
    // block or break the boot — a pre-check failure only records a report.
    void runStartupCheck(ctx, shared).catch((error) => {
      ctx.logger?.warn(
        `[dsh-my-guardian] startup pre-check failed (recorded only): ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    void initialScan(shared).catch((error) => {
      // the scan must never take the process down
      ctx.logger?.warn(
        `[dsh-my-guardian] initial scan failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  })
}

// ── staged file watching (new candidates at runtime) + poll fallback ────
function startWatchers(ctx: DshContext, shared: SharedContext): void {
  try {
    shared.watcher = watch(shared.stagedFile, () => {
      if (!shared.ready) return
      void shared.scanStaged().catch(() => {})
    })
  } catch {
    shared.watcher = null
  }

  ctx.timer.interval(() => {
    if (!shared.ready) return
    shared.ensureApi()
    void shared.scanStaged().catch(() => {})
  }, POLL_MS)
}

/** 插件状态查询（#155 聚合层）：返回 guardian 加载状态 + 最近事件。 */
function registerStatusQuery(ctx: DshContext, shared: SharedContext): void {
  ctx.on('plugin:status-query', (arg: unknown) => {
    const { plugin } = arg as { plugin?: string }
    if (plugin !== 'dsh-my-guardian') return undefined
    const lastActions = (shared.state.events ?? []).slice(-5).map((e) => ({
      time: e.time ?? Date.now(),
      type: e.type ?? 'event',
      detail: e.message ?? '',
    }))
    return {
      ok: true,
      value: {
        plugin: 'dsh-my-guardian',
        config: { keys: ['safeMode', 'stagedFile'] },
        running: shared.ready,
        stats: { mounted: shared.mounted.size, safeMode: shared.state.safeMode === true },
        lastActions,
      },
    }
  })
}

/** teardown: unmount everything the guardian mounted, then persist. */
function registerTeardown(ctx: DshContext, shared: SharedContext): void {
  ctx.effect(
    () => () => {
      if (shared.watcher !== null) {
        try {
          shared.watcher.close()
        } catch {
          // ignore
        }
        shared.watcher = null
      }
      for (const id of [...shared.mounted]) {
        void shared.unmount(id)
      }
      void shared.persistSoon()
    },
    'dsh-my-guardian: teardown',
  )
}
