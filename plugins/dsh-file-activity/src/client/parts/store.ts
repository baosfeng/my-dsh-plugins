// ── tiny external store ───────────────────────────────────────────────

/** 极简外部 store 契约（useSyncExternalStore 消费 subscribe/getSnapshot）。 */
interface DataStore<T extends object> {
  getSnapshot(): T
  set(patch: Partial<T>): void
  subscribe(listener: () => void): () => unknown
}

function createStore<T extends object>(initial: T): DataStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    set(patch) {
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// ── shared store slot ─────────────────────────────────────────────────
//
// The tab body renders inside a session-scoped seat while the floating preview
// renders inside the root-scoped 'shell.overlay' seat, so the store the two
// halves share cannot travel as a prop from one to the other. One module-level
// reference is enough: the overlay seat is mounted for the plugin's whole
// lifetime and only ever reads the CURRENT store, and a rebuild replaces the
// reference before the new overlay renders.

/** The store the overlay seat reads; set once per activation. */
let sharedDataStore: DataStore<DataState> | null = null

/** Publish the activation's store for the root-scoped overlay seat. */
function registerSharedStore(store: DataStore<DataState>): void {
  sharedDataStore = store
}

/** The activation's store, or null before apply() ran. */
function sharedStore(): DataStore<DataState> | null {
  return sharedDataStore
}
