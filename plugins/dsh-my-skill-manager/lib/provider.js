/**
 * dsh-my-skill-manager — disable placeholder provider.
 *
 * Registered into the GLOBAL skill layer with rank 0, it wins every same-name
 * candidate in that layer (filesystem ranks are 100–500, runtime 250): a
 * disabled skill's summary in the merged catalog becomes this placeholder
 * ("已禁用"), so the model no longer receives the real skill and `get()`
 * refuses to load its body. `list()` is cwd-sensitive: the project config is
 * resolved from the viewing session's cwd, so a disabled name only shadows
 * skills inside that project; the global list applies everywhere.
 *
 * Conservative by design: names that appear in no config produce no
 * candidates, so an untouched catalog is byte-identical to before.
 */
import { readConfigFile, globalConfigFile, readProjectConfig } from './config.js';
const PROVIDER_NAME = 'my-skill-manager';
/** Below every filesystem rank (100–500) and the runtime rank (250). */
const DISABLED_RANK = 0;
/** Build the provider. Config is read per `list()` call; after a config save
 *  the caller fires `control.invalidate()` so the skill catalog recalculates. */
export function createDisablerProvider() {
    return {
        name: PROVIDER_NAME,
        async list(options) {
            const cwd = typeof options?.cwd === 'string' && options.cwd !== '' ? options.cwd : undefined;
            const disabled = await disabledNamesOf(cwd);
            return [...disabled].map((name) => ({
                name,
                description: '已禁用（dsh-my-skill-manager）——该 skill 被启用/禁用配置禁用，模型不会加载它。',
                invocation: { modelInvocable: false, userInvocable: false },
                source: 'disabled',
                provider: PROVIDER_NAME,
                rank: DISABLED_RANK,
            }));
        },
        async get() {
            return undefined; // disabled: the skill body must not load
        },
    };
}
/** Union of the global and (cwd-resolved) project disabled names. */
export async function disabledNamesOf(cwd) {
    const global = await readConfigFile(globalConfigFile());
    const globalNames = global.global.disabled;
    if (cwd === undefined)
        return globalNames;
    const project = await readProjectConfig(cwd);
    return [...new Set([...globalNames, ...project.project.disabled])];
}
