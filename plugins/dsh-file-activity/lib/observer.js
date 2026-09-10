/**
 * fs/observed event listener factory: filters noise (absent observations,
 * missing actors / session ids / tool names), resolves the touched path
 * (backend displayPath preferred, falling back to the file_path argument)
 * and records it through the store's record().
 */
import { mapOp } from './state.js';
export function createFsObserver(record) {
    return (target, observation, actor) => {
        // Only authoritative PRESENT observations mean a file was actually
        // touched; absent observations (e.g. a failed read of a missing file)
        // are noise.
        if (!isPresentObservation(observation))
            return;
        if (!isValidActor(actor))
            return;
        const sessionId = actor.agent?.id;
        if (typeof sessionId !== 'string' || sessionId === '')
            return;
        // Prefer the backend-resolved absolute path; fall back to the raw argument.
        const rawPath = resolveObservedPath(target, actor);
        if (rawPath === '')
            return;
        record(sessionId, rawPath, mapOp(actor.name), Date.now());
    };
}
/** A PRESENT observation is the only authoritative "file was touched" signal. */
function isPresentObservation(observation) {
    return observation !== undefined && observation !== null && observation.kind === 'present';
}
/** The actor must exist and carry a non-empty string tool name. */
function isValidActor(actor) {
    if (actor === undefined || actor === null)
        return false;
    const name = actor.name;
    return typeof name === 'string' && name !== '';
}
/** Resolve the touched path: backend displayPath preferred, else file_path. */
function resolveObservedPath(target, actor) {
    const displayPath = target?.displayPath;
    if (typeof displayPath === 'string' && displayPath !== '')
        return displayPath;
    const args = actor.arguments;
    if (args !== null && typeof args === 'object' && typeof args.file_path === 'string')
        return args.file_path;
    return '';
}
