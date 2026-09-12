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
import { watch } from 'node:fs';
import { join } from 'node:path';
import { createPersister, createState } from './state.js';
import { findRootTree, createMountOps, initialScan } from './mount.js';
import { createApi } from './api.js';
import { attachEventListeners, logEvent } from './events.js';
import { runStartupCheck } from './startup-check.js';
export const name = 'dsh-my-guardian';
export const inject = ['loader', 'timer'];
/** Fallback poll interval for the staged file when fs.watch is unavailable. */
const POLL_MS = 4000;
export function apply(ctx) {
    // Watchdog self-protection: the guardian itself must never take the process
    // down. Any synchronous failure inside apply degrades the guardian (no
    // staged loading) instead of failing the whole boot (fail-loud).
    try {
        applyInner(ctx);
    }
    catch (error) {
        ctx.logger?.warn(`[dsh-my-guardian] apply failed — guardian degraded: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function applyInner(ctx) {
    const root = findRootTree(ctx.loader);
    if (root === null) {
        ctx.logger?.warn('[dsh-my-guardian] no include tree found — guardian inactive');
        return;
    }
    const shared = createShared(root);
    wireServices(ctx, shared);
    scheduleInitialScan(ctx, shared);
    startWatchers(ctx, shared);
    registerTeardown(ctx, shared);
    registerStatusQuery(ctx, shared);
}
/** Mutable per-instance runtime context shared by every sub-module. */
function createShared({ tree, profileDir }) {
    let markBooted = () => { };
    const bootPromise = new Promise((resolve) => {
        markBooted = resolve;
    });
    const shared = {
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
        persistSoon: () => { },
        persistFinal: () => { },
        flushPersist: () => Promise.resolve(),
        bootPromise,
        markBooted,
        disposed: false,
        logEvent: (_type, _message) => { },
        // Mount ops — filled by wireServices via Object.assign
        conflictOf: () => null,
        mount: async () => { },
        unmount: async () => { },
        mountWithState: async () => 'skipped',
        processStagedEntry: async () => { },
        mountPromoted: async () => { },
        scanStaged: async () => { },
        retryEntry: async () => null,
        removeEntry: async () => { },
        // API ops — filled by wireServices via Object.assign
        ensureApi: () => { },
        snapshot: () => ({}),
    };
    return shared;
}
/** Bind persister, event log, mount ops, API and listeners onto shared. */
function wireServices(ctx, shared) {
    const persister = createPersister(shared);
    shared.persistSoon = persister.persistSoon;
    shared.persistFinal = persister.persistFinal;
    shared.flushPersist = persister.flush;
    shared.logEvent = (type, message) => logEvent(shared, type, message);
    Object.assign(shared, createMountOps(shared));
    Object.assign(shared, createApi(ctx, shared));
    attachEventListeners(ctx, shared);
}
// ── run after boot settles ──────────────────────────────────────────────
function scheduleInitialScan(ctx, shared) {
    void Promise.resolve().then(() => {
        // Startup-roster static pre-check (issue #144): best-effort, MUST never
        // block or break the boot — a pre-check failure only records a report.
        //
        // #217: best-effort 的是「失败不阻断」，不是「可以缺席启动就绪信号」。
        // 预检的产物（startupIssues / startupCheckedAt 快照 + startup-issue 事件
        // 落盘）同样是启动结果：它晚于 bootPromise 完成时，API 会读到空
        // startupIssues、teardown 会在它落盘前返回（旧快照覆盖下一个实例）。
        const startupCheck = runStartupCheck(ctx, shared).catch((error) => {
            ctx.logger?.warn(`[dsh-my-guardian] startup pre-check failed (recorded only): ${error instanceof Error ? error.message : String(error)}`);
        });
        const scan = initialScan(shared).catch((error) => {
            // the scan must never take the process down
            ctx.logger?.warn(`[dsh-my-guardian] initial scan failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        // 无论成败都放行 API：扫描/预检失败只降级，不能让 API 永久挂起
        void Promise.all([scan, startupCheck]).finally(() => shared.markBooted());
    });
}
// ── staged file watching (new candidates at runtime) + poll fallback ────
function startWatchers(ctx, shared) {
    try {
        shared.watcher = watch(shared.stagedFile, () => {
            if (!shared.ready)
                return;
            void shared.scanStaged().catch(() => { });
        });
    }
    catch {
        shared.watcher = null;
    }
    ctx.timer.interval(() => {
        if (!shared.ready)
            return;
        shared.ensureApi();
        void shared.scanStaged().catch(() => { });
    }, POLL_MS);
}
/** 插件状态查询（#155 聚合层）：返回 guardian 加载状态 + 最近事件。 */
function registerStatusQuery(ctx, shared) {
    ctx.on('plugin:status-query', (arg) => {
        const { plugin } = arg;
        if (plugin !== 'dsh-my-guardian')
            return undefined;
        const lastActions = (shared.state.events ?? []).slice(-5).map((e) => ({
            time: e.time ?? Date.now(),
            type: e.type ?? 'event',
            detail: e.message ?? '',
        }));
        return {
            ok: true,
            value: {
                plugin: 'dsh-my-guardian',
                config: { keys: ['safeMode', 'stagedFile'] },
                running: shared.ready,
                stats: { mounted: shared.mounted.size, safeMode: shared.state.safeMode === true },
                lastActions,
            },
        };
    });
}
/** teardown: unmount everything the guardian mounted, then persist.
 *
 *  disposer 返回 promise：await 它即保证「本实例启动路径 settle + 卸载 +
 *  全部排队快照落盘」完成，返回后本实例不再产生任何写。
 *  #189 只补了「写链 drain」+ async disposer：它覆盖不到 fire-and-forget 的
 *  启动预检（独立异步链，晚于 drain 才 persistSoon）；#217 把 bootPromise
 *  （现已含 initialScan + runStartupCheck）也等进来。
 *  见 docs/踩坑/固定sleep等异步落盘导致CI-flaky.md。 */
function registerTeardown(ctx, shared) {
    ctx.effect(() => async () => {
        if (shared.watcher !== null) {
            try {
                shared.watcher.close();
            }
            catch {
                // ignore
            }
            shared.watcher = null;
        }
        // 立刻进入收尾态：此后本实例不再扫描、不再接受任何持久化——
        // 飞行中的 HTTP handler、已排队的 watcher/轮询回调都可能在 teardown
        // 返回之后才 persistSoon，把旧实例快照覆盖到下一个实例的 state.json 上。
        // （initialScan 也会因为 disposed 而不再把 ready 置回 true。）
        shared.disposed = true;
        shared.ready = false;
        // #217: 再等本实例的启动路径（initialScan + 启动预检）settle。只 drain
        // 「已排队的写」不够——启动预检是 fire-and-forget 的独立异步链，它可能在
        // teardown 返回之后才 persistSoon（CI 上表现为随机红）。
        await shared.bootPromise;
        // unmount 内部已吞异常（best effort），逐个 await 期间它们各自入链
        await Promise.all([...shared.mounted].map((id) => shared.unmount(id)));
        // 收尾快照：此刻内存状态已完整（启动扫描 + 预检都 settle），写一次最终态
        shared.persistFinal();
        await shared.flushPersist();
    }, 'dsh-my-guardian: teardown');
}
