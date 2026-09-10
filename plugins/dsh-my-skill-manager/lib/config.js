/**
 * dsh-my-skill-manager — enable/disable config storage.
 *
 * Two scopes, exactly like the issue asks:
 *  - global:  $DSH_HOME/skills.enabled.json (fallback ~/.dsh/skills.enabled.json)
 *  - project: <projectRoot>/.dsh/skills.enabled.json, where projectRoot is the
 *    nearest ancestor with a .git directory (findProjectRoot), resolved from
 *    the session cwd — so the config travels with the repo (versionable).
 *
 * Config shape (only `disabled` is used; `enabled` whitelisting is a future
 * extension and stays untouched when present):
 *   { "global": { "disabled": [...] }, "project": { "disabled": [...] } }
 *
 * A project config's `disabled` list applies to that project only and may
 * disable global skills too (project overrides global). The global list
 * applies to every project. Reads are defensive: missing/corrupt files
 * degrade to empty lists; writes are atomic (tmp+rename).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { findProjectRoot } from 'dsh-shared';
/** Global config file: $DSH_HOME/skills.enabled.json (fallback ~/.dsh/...). */
export function globalConfigFile() {
    const home = process.env.DSH_HOME;
    if (typeof home === 'string' && home !== '')
        return `${home}/skills.enabled.json`;
    return `${homedir()}/.dsh/skills.enabled.json`;
}
/** Empty config document. */
function emptyConfig() {
    return { global: { disabled: [] }, project: { disabled: [] } };
}
/** Read one config file (missing/corrupt → empty config). */
export async function readConfigFile(file) {
    try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object')
            return normalizeConfig(parsed);
    }
    catch {
        // first run or unreadable file: empty config
    }
    return emptyConfig();
}
/** Keep only the known shape; anything else is ignored defensively. */
export function normalizeConfig(config) {
    const result = emptyConfig();
    const disabledOf = (section) => {
        // 断言仅为通过类型检查：运行时语义与迁移前一致（可选链对任意值安全）。
        const list = config?.[section]?.disabled;
        return Array.isArray(list) ? list.filter((name) => typeof name === 'string' && name !== '') : [];
    };
    result.global.disabled = [...new Set(disabledOf('global'))];
    result.project.disabled = [...new Set(disabledOf('project'))];
    return result;
}
/** Write one config file atomically (tmp + rename); creates the directory. */
export async function writeConfigFile(file, config) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
    await rename(tmp, file);
}
/** Project config path for a cwd: <projectRoot>/.dsh/skills.enabled.json. */
export async function projectConfigFileOf(cwd) {
    const root = await findProjectRoot(cwd);
    return join(root, '.dsh', 'skills.enabled.json');
}
/** Read the project config for a cwd (missing/corrupt → empty config). */
export async function readProjectConfig(cwd) {
    return readConfigFile(await projectConfigFileOf(cwd));
}
