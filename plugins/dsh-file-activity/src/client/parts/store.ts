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
