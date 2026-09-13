'use strict'
// ── tiny external store ───────────────────────────────────────────────
function createStore(initial) {
  let state = initial
  const listeners = new Set()
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
let sharedDataStore = null
/** Publish the activation's store for the root-scoped overlay seat. */
function registerSharedStore(store) {
  sharedDataStore = store
}
/** The activation's store, or null before apply() ran. */
function sharedStore() {
  return sharedDataStore
}
