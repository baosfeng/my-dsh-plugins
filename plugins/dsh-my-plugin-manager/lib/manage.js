/**
 * dsh-my-plugin-manager — manage.ts: spawn the `dsh plugin` CLI for install /
 * uninstall / outdated, and read installed versions from the profile dir.
 *
 * The panel edits the same files `dsh plugin` manages (profile package.json +
 * cordis.patch.yml via the bundle patch), so the CLI is the single source of
 * truth — no hand-editing of patch files. New plugins load on the next DSH
 * restart (candidate-area hot mount remains the guardian plugin's job).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/** Run `dsh plugin --profile <profile> <args...>` and collect output. */
export function runDsh(args, options = {}) {
    return new Promise((resolve) => {
        const child = spawn('dsh', args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => resolve({ ok: false, code: -1, stdout, stderr, error: String(error?.message ?? error) }));
        child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    });
}
export function pluginArgs(profile, command, target) {
    return ['plugin', '--profile', profile, command, target];
}
/** Install a plugin (npm name or link:/path). */
export function installPlugin(profile, source) {
    return runDsh(pluginArgs(profile, 'add', source));
}
/** Remove an installed package. */
export function uninstallPlugin(profile, name) {
    return runDsh(pluginArgs(profile, 'remove', name));
}
/** pnpm outdated --json: { "<pkg>": { current, latest, ... } } or empty {} . */
export async function outdatedPlugins(profile) {
    const result = await runDsh(['plugin', '--profile', profile, 'outdated', '--json']);
    if (!result.ok)
        return {
            ok: false,
            error: result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`,
        };
    try {
        const parsed = JSON.parse(result.stdout.trim() || '{}');
        // pnpm outdated --json 的每项形状：{ current, latest, ... }（逐字段兜底）。
        const entries = Object.entries(parsed);
        return {
            ok: true,
            outdated: entries.map(([name, info]) => ({
                name,
                current: typeof info.current === 'string' ? info.current : '',
                latest: typeof info.latest === 'string' ? info.latest : '',
            })),
        };
    }
    catch {
        return { ok: false, error: 'outdated output was not JSON' };
    }
}
/** Installed version of a package in the profile dir ('' when unknown). */
export function installedVersionOf(profileDir, moduleName) {
    try {
        const scope = moduleName.startsWith('@') ? moduleName.split('/')[0] : null;
        const base = scope
            ? join(profileDir, 'node_modules', scope, moduleName.slice(scope.length + 1))
            : join(profileDir, 'node_modules', moduleName);
        const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' ? pkg.version : '';
    }
    catch {
        return '';
    }
}
