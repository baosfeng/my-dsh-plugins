/**
 * Store lifecycle for file activity: async state load with buffering of
 * records that arrive before it completes, debounced atomic persistence
 * (tmp+rename) and a teardown flush. The exposed store object carries a live
 * `state` reference so route handlers always read the current document.
 */
import { atomicWriteJson } from 'dsh-shared';
import { applyRecord, createState, loadState, mapOp, stateFile, trimLoadedState } from './state.js';
/** Build the per-apply store: { state, record, schedulePersist, dispose }. */
export function createStore(ctx) {
    const store = {
        state: createState(),
        record: () => false,
        schedulePersist: () => { },
        dispose: () => { },
    };
    const handle = {
        ctx,
        file: stateFile(),
        store,
        pending: [],
        ready: false,
        persistTimer: null,
        dirtyChain: Promise.resolve(),
        persistNow: () => { },
        persistSoon: () => { },
    };
    handle.persistNow = () => persistNow(handle);
    handle.persistSoon = () => persistSoon(handle);
    store.record = (sessionId, path, op, time) => record(handle, sessionId, path, op, time);
    store.schedulePersist = () => persistSoon(handle);
    store.dispose = () => dispose(handle);
    void loadState(handle.file).then((loaded) => onLoaded(handle, loaded));
    return store;
}
/** Write the current state atomically (serialized through dirtyChain). */
function persistNow(handle) {
    handle.dirtyChain = handle.dirtyChain
        .then(() => atomicWriteJson(handle.file, handle.store.state, handle.ctx.logger, '[dsh-file-activity]'))
        .catch(() => { });
}
/** Debounced (500ms) schedule of a persist. */
function persistSoon(handle) {
    if (handle.persistTimer !== null)
        return;
    handle.persistTimer = setTimeout(() => {
        handle.persistTimer = null;
        persistNow(handle);
    }, 500);
}
/** State loaded: normalize/trim, mark ready, drain buffered records. */
function onLoaded(handle, loaded) {
    const result = trimLoadedState(loaded);
    handle.store.state = result.state;
    handle.ready = true;
    if (drainPending(handle) || result.trimmed)
        persistSoon(handle);
}
/** Apply every record buffered before the state load finished. */
function drainPending(handle) {
    const drained = handle.pending.splice(0);
    for (const item of drained) {
        applyRecord(handle.store.state, item.sessionId, item.path, mapOp(item.op), item.time);
    }
    return drained.length > 0;
}
/** Record an operation once state is loaded (buffered before that). */
function record(handle, sessionId, path, op, time) {
    if (!handle.ready) {
        handle.pending.push({ sessionId, path, op, time });
        return true;
    }
    if (applyRecord(handle.store.state, sessionId, path, op, time)) {
        persistSoon(handle);
        return true;
    }
    return false;
}
/** Tear down on unload: flush pending persistence. */
function dispose(handle) {
    if (handle.persistTimer !== null) {
        clearTimeout(handle.persistTimer);
        handle.persistTimer = null;
    }
    persistNow(handle);
    void handle.dirtyChain;
}
