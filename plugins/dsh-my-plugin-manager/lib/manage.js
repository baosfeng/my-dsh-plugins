/**
 * dsh-my-plugin-manager — manage.ts: `dsh plugin` CLI for the update check.
 *
 * 唯一保留的 CLI 用法是更新检查（`dsh plugin --profile <p> outdated --json`）——
 * 官方插件管理没有 outdated / latest 面，这是本插件的真增量之一。安装 / 卸载 /
 * 启停已随 UI 一并下线：官方侧边栏插件页与 `dsh plugin add|remove` 是唯一入口。
 */
import { spawn } from 'node:child_process';
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
/** `dsh plugin --profile <profile> <command> <target>` 参数表。 */
export function pluginArgs(profile, command, target) {
    return ['plugin', '--profile', profile, command, target];
}
/** pnpm outdated --json: { "<pkg>": { current, latest, ... } } or empty {} . */
export async function outdatedPlugins(profile) {
    const result = await runDsh(pluginArgs(profile, 'outdated', '--json'));
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
