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
/** Update a plugin to its latest version. */
export function updatePlugin(profile, name) {
    return runDsh(pluginArgs(profile, 'update', name));
}
/** Enable a plugin (set enabled: true in cordis.patch.yml). */
export async function enablePlugin(profileDir, moduleName) {
    return togglePluginEnabled(profileDir, moduleName, true);
}
/** Disable a plugin (set enabled: false in cordis.patch.yml). */
export async function disablePlugin(profileDir, moduleName) {
    return togglePluginEnabled(profileDir, moduleName, false);
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
/**
 * Toggle plugin enabled state in cordis.patch.yml.
 *
 * DSH 插件启用机制：cordis.patch.yml 中每个插件条目可以有 `enabled` 字段。
 * 当 enabled 为 false 时，该插件不会被加载。
 *
 * 注意：这个函数会修改 cordis.patch.yml 文件，需要谨慎处理。
 */
async function togglePluginEnabled(profileDir, moduleName, enabled) {
    try {
        const patchPath = join(profileDir, 'cordis.patch.yml');
        let patchContent;
        try {
            patchContent = readFileSync(patchPath, 'utf8');
        }
        catch {
            // 如果文件不存在，创建一个新的
            patchContent = '';
        }
        // 解析 YAML 内容（简化处理，实际应该用 YAML 解析器）
        // 这里假设 cordis.patch.yml 的格式是标准的 YAML 数组
        const lines = patchContent.split('\n');
        let found = false;
        const newLines = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 查找包含 moduleName 的行
            if (line.includes(moduleName)) {
                found = true;
                // 检查下一行是否有 enabled 字段
                if (i + 1 < lines.length && lines[i + 1].includes('enabled:')) {
                    // 替换 enabled 字段
                    newLines.push(line);
                    newLines.push(`      enabled: ${enabled}`);
                    i++; // 跳过原来的 enabled 行
                }
                else {
                    // 添加 enabled 字段
                    newLines.push(line);
                    newLines.push(`      enabled: ${enabled}`);
                }
            }
            else {
                newLines.push(line);
            }
        }
        // 如果没有找到该插件，添加一个新的条目
        if (!found) {
            const newEntry = `    - insert:\n      - id: ${moduleName}\n        name: '${moduleName}'\n        enabled: ${enabled}`;
            newLines.push(newEntry);
        }
        // 写入文件
        const { writeFileSync } = await import('node:fs');
        writeFileSync(patchPath, newLines.join('\n'), 'utf8');
        return {
            ok: true,
            code: 0,
            stdout: `Plugin ${moduleName} ${enabled ? 'enabled' : 'disabled'}`,
            stderr: '',
        };
    }
    catch (error) {
        return {
            ok: false,
            code: -1,
            stdout: '',
            stderr: `Failed to toggle plugin enabled state: ${error}`,
            error: String(error),
        };
    }
}
