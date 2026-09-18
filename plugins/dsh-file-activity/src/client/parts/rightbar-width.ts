// ── right column default width (issue #384) ───────────────────────────
//
// Why this half exists: the host hardcodes the right column's first-open width
// at 45% of the frame (ui-layout columns.ts RIGHTBAR_DEFAULT_RATIO) and
// persists nothing, and it exposes NO width face on ctx.layout or
// ctx.sidebarRight. The one reachable channel is the layout entry's declared
// store seat: ctx.slots.entries('root') yields the ui-layout registration,
// whose store.create() returns the very instance AppFrame subscribes to (the
// framework itself goes through handle.create()).
//
// Semantics = DEFAULT, not override: the host fills layoutInfo.rightbar with
// the 45% value on the panel's first opening (stores.ts rightbar ??= …), so
// `rightbar === null` means "nothing opened or dragged it in this run". We
// write ONLY then; a value the user dragged is never touched.
//
// Every contract mismatch (no entry, factory-shaped store, no create(), a
// throwing create()/getSnapshot(), no setRightbar, an unexpected snapshot) is
// a SILENT skip with at most one debug line. Breaking the tab, the auto-open
// or the preview over a nicety like this would be far worse than doing
// nothing, so the whole path is detect-and-degrade.

/** Allowed ratio range in percent; the ceiling matches the host's own cap (70%). */
const RIGHTBAR_RATIO_MIN = 10
const RIGHTBAR_RATIO_MAX = 70
/** Ratio used when nothing valid is stored: the issue #384 default. */
const RIGHTBAR_RATIO_DEFAULT = 20

/** One-shot skip log gate, so a churning root seat cannot flood the console. */
let rightbarSkipLogged = false

/** Debug-only skip report; never throws, never warns (degradation is silent). */
function logRightbarSkip(reason: string, error?: unknown): void {
  if (rightbarSkipLogged) return
  rightbarSkipLogged = true
  try {
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[dsh-file-activity] 右侧边栏默认宽度未应用: ' + reason, error ?? '')
    }
  } catch {
    // logging must never break activation
  }
}

/** Whether a raw value is a usable percent ratio (finite, inside the range). */
function rightbarRatioValid(value: unknown): boolean {
  const ratio = Number(value)
  return Number.isFinite(ratio) && ratio >= RIGHTBAR_RATIO_MIN && ratio <= RIGHTBAR_RATIO_MAX
}

/** Persisted ratio, falling back to the default for missing/illegal values. */
function storedRightbarRatio(): number {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(RIGHTBAR_PREF_KEY)
  } catch {
    return RIGHTBAR_RATIO_DEFAULT
  }
  if (raw === null || !rightbarRatioValid(raw)) return RIGHTBAR_RATIO_DEFAULT
  return Number(raw)
}

/** Persist a ratio; an illegal value is rejected instead of poisoning storage. */
function saveRightbarRatio(value: unknown): boolean {
  if (!rightbarRatioValid(value)) return false
  try {
    window.localStorage.setItem(RIGHTBAR_PREF_KEY, String(Number(value)))
  } catch {
    // storage unavailable (private mode): the control still shows the value
  }
  return true
}

/** The host store instance we may write through, plus its live layoutInfo. */
interface RightbarLayoutTarget {
  setRightbar: (px: number) => void
  info: RightbarLayoutInfo
}

/**
 * The entry's store seat in HANDLE form (create() present), or null.
 * A factory-shaped seat is deliberately not guessed at: calling it would build
 * a second, unsubscribed instance instead of the one AppFrame renders.
 * @param entry - one 'root' seat snapshot.
 * @returns the handle-shaped seat, or null.
 */
function rightbarStoreSeat(entry: SlotEntrySnapshot | undefined): SlotStoreSeat | null {
  const store = entry && entry.store
  if (!store || typeof store !== 'object') return null
  if (typeof store.create !== 'function') return null
  return store
}

/**
 * The instance's layoutInfo when it is writable, or null.
 * @param instance - handle-created store instance.
 * @returns layoutInfo, or null when the shape is foreign or a width exists.
 */
function rightbarWritableInfo(instance: SlotStoreInstance): RightbarLayoutInfo | null {
  if (typeof instance.getSnapshot !== 'function') return null
  const snapshot = instance.getSnapshot()
  const info = snapshot && snapshot.layoutInfo
  if (!info || typeof info !== 'object') return null
  // NULL is the only green light: any number means this run already owns a
  // width (the host's own 45% first-open default, or a user drag).
  if (info.rightbar !== null) return null
  return info
}

/**
 * Turn a handle-created instance into a write target, or null.
 * @param instance - handle-created store instance.
 * @returns the write target, or null.
 */
function rightbarTargetFromInstance(instance: SlotStoreInstance | null | undefined): RightbarLayoutTarget | null {
  if (!instance) return null
  const info = rightbarWritableInfo(instance)
  if (!info) return null
  if (!instance.actions || typeof instance.actions.setRightbar !== 'function') return null
  return { setRightbar: instance.actions.setRightbar, info }
}

/**
 * Resolve the ui-layout instance behind the 'root' seat, or null when the host
 * contract does not match. The snapshot shape is the test: writing the width
 * goes through exactly that shape, so a shape we cannot read is a channel we
 * must not use.
 * @param ctx - client root context.
 * @returns the write target, or null (caller stays silent).
 */
function rightbarLayoutTarget(ctx: ClientContext): RightbarLayoutTarget | null {
  const slots = ctx && ctx.slots
  if (!slots || typeof slots.entries !== 'function') {
    logRightbarSkip('ctx.slots.entries 不可用')
    return null
  }
  const entries = slots.entries('root') || []
  for (const entry of entries) {
    try {
      const target = rightbarTargetFromInstance(rightbarStoreSeat(entry)?.create?.())
      if (target) return target
    } catch (error) {
      logRightbarSkip('读取 root 席位 store 失败', error)
    }
  }
  logRightbarSkip('未找到可写的 ui-layout root 席位')
  return null
}

/**
 * Apply the configured default width once, if the panel has no width yet.
 * @param ctx - client root context.
 */
function applyRightbarDefaultWidth(ctx: ClientContext): void {
  try {
    const target = rightbarLayoutTarget(ctx)
    if (!target) return
    // The snapshot's own viewportWidth is the value the host's clamp uses, so
    // prefer it; window.innerWidth only covers a snapshot that omits it.
    const viewport = Number.isFinite(target.info.viewportWidth)
      ? (target.info.viewportWidth as number)
      : window.innerWidth
    if (!Number.isFinite(viewport)) {
      logRightbarSkip('viewportWidth 不可用')
      return
    }
    const px = Math.round(viewport * (storedRightbarRatio() / 100))
    if (!Number.isFinite(px) || px <= 0) {
      logRightbarSkip('计算出的宽度非法')
      return
    }
    target.setRightbar(px)
  } catch (error) {
    logRightbarSkip('应用宽度失败', error)
  }
}

/**
 * Install the preference: apply once at activation, then re-resolve the
 * instance after a 'root' seat change (HMR / remount must not keep a stale
 * instance). The returned disposer releases the subscription with the fiber.
 * @param ctx - client root context.
 * @returns the subscription disposer, when one was taken.
 */
function installRightbarDefaultWidth(ctx: ClientContext): (() => void) | undefined {
  applyRightbarDefaultWidth(ctx)
  const slots = ctx && ctx.slots
  if (!slots || typeof slots.subscribe !== 'function') return undefined
  try {
    const dispose = slots.subscribe('root', () => applyRightbarDefaultWidth(ctx))
    return typeof dispose === 'function' ? () => dispose() : undefined
  } catch (error) {
    logRightbarSkip('订阅 root 席位失败', error)
    return undefined
  }
}
