/**
 * dsh-my-guardian — dependency pre-check for the candidate mount pipeline.
 *
 * Reads a candidate plugin's package.json peerDependencies (from the profile
 * node_modules) and verifies each dependency is installed and version-satisfying
 * BEFORE the plugin is mounted. A failure is reported with its own classification
 * ('dependency-missing' / 'dependency-mismatch', #410) plus the separated
 * missingDeps / mismatchedDeps fields, and the mount is skipped — the plugin never
 * enters the runtime load path with a hole in its dependency graph
 * (issue #72: dsh-shared was not published).
 *
 * 安装建议（suggestions）只给**可执行**的命令：宿主（DSH 安装）自带的包
 * （@deepseek-ai/*、react / react-dom）不给命令——按提示执行会把宿主自有包的
 * 另一份拷贝装进 profile（#407/#410）；声明范围含空格 / 管道 / 比较符时也不给
 * 命令（拼出来无法执行）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { satisfies } from './dep-version.js';
// Locate a package directory below a node_modules root, following symlinks
// (pnpm store / npm link both expose package.json through the mirrored dir).
// Exported for the startup-roster pre-check (issue #144): resolvability of a
// roster plugin's own package is verified before peer dependencies.
export function findModuleDir(nmRoot, packageName) {
    const dir = join(nmRoot, packageName);
    return existsSync(join(dir, 'package.json')) ? dir : null;
}
// Base package of a specifier: 'pkg' -> 'pkg', '@scope/pkg' -> '@scope/pkg',
// 'pkg/sub' -> 'pkg', '@scope/pkg/sub' -> '@scope/pkg'. Peer specs are package
// roots today, but resolving the base keeps the lookup correct for any spec.
export function basePackage(spec) {
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
// Resolve a dependency from the plugin's nested node_modules, the profile
// node_modules (hoisted installs), or the profiles-root node_modules where the
// harness installs its host-provided @deepseek-ai/* packages. The pre-check
// previously stopped at the profile dir, so every plugin declaring a host
// package as a peer was reported as missing even though Node resolves it by
// walking up to $DSH_HOME/profiles/node_modules. Returns the dir or null.
function resolveDependencyDir(profileDir, pluginDir, dep) {
    const base = basePackage(dep);
    const nested = pluginDir === null ? null : findModuleDir(join(pluginDir, 'node_modules'), base);
    if (nested !== null)
        return nested;
    const inProfile = findModuleDir(join(profileDir, 'node_modules'), base);
    if (inProfile !== null)
        return inProfile;
    return findModuleDir(join(profileDir, '..', 'node_modules'), base);
}
function readPackageJson(dir) {
    if (dir === null)
        return null;
    try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    }
    catch {
        return null;
    }
}
function installedVersion(dir) {
    const pkg = readPackageJson(dir);
    return pkg !== null && typeof pkg.version === 'string' ? pkg.version : null;
}
// Inspect a single peer dependency and classify the outcome.
function examinePeer(dep, range, optional, pluginDir, profileDir) {
    const depDir = resolveDependencyDir(profileDir, pluginDir, dep);
    if (depDir === null) {
        if (optional)
            return { kind: 'warn', message: `可选依赖 ${dep} 缺失（未安装）` };
        return { kind: 'missing', name: dep };
    }
    const version = installedVersion(depDir);
    if (version !== null && typeof range === 'string' && range.trim() !== '' && !satisfies(version, range)) {
        const issue = { name: dep, expected: range, found: version };
        if (optional)
            return { kind: 'warn', message: `可选依赖 ${dep} 版本不满足：${range}（当前 ${version}）` };
        return { kind: 'mismatch', issue };
    }
    return { kind: 'ok' };
}
/** 宿主（DSH 安装）自带的包：装进 profile 只会多出一份拷贝并可能遮蔽宿主版本（#407）。 */
const HOST_PACKAGE_NAMES = new Set(['react', 'react-dom']);
/**
 * 该依赖是否由宿主（DSH 安装 / 宿主前端）提供，而不是「用户装进 profile 的包」。
 * @deepseek-ai/* 是宿主 runtime 供给的包；react / react-dom 由宿主前端运行时注入。
 * 对这类包给出 `dsh plugin add …` 建议 = 把宿主自有包的另一份拷贝装进 profile（#407/#410）。
 */
export function isHostProvided(spec) {
    const base = basePackage(spec);
    return base.startsWith('@deepseek-ai/') || HOST_PACKAGE_NAMES.has(base);
}
/**
 * 声明范围能否直接拼进 `dsh plugin add <name>@<range>`：只接受单一 ^ / ~ / 精确
 * 版本。含空格、管道、比较符或空版本的范围（`^18.2.0 || ^19.3.0`）拼出来的命令
 * 在 shell 里无法执行（#410：畸形 installHint），一律不生成命令。
 */
const INSTALLABLE_RANGE = /^[~^]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/;
function installableRange(range) {
    return typeof range === 'string' && INSTALLABLE_RANGE.test(range) ? range : null;
}
/**
 * 可执行的修复命令（#410）：宿主提供的包不给命令；版本不满足只在声明范围本身
 * 可安全拼进命令时给出钉住版本的命令，否则不给（宁缺勿畸形）。
 */
function buildSuggestions(missing, mismatched) {
    const suggestions = [];
    for (const dep of missing) {
        if (isHostProvided(dep))
            continue;
        suggestions.push(`dsh plugin add ${dep}`);
    }
    for (const item of mismatched) {
        if (isHostProvided(item.name))
            continue;
        const range = installableRange(item.expected);
        if (range !== null)
            suggestions.push(`dsh plugin add ${item.name}@${range}`);
    }
    return suggestions;
}
function objectOrEmpty(value) {
    return (value ?? {});
}
// Group every peer into missing / mismatched / warning buckets.
function classifyPeers(peers, meta, pluginDir, profileDir) {
    const missing = [];
    const mismatched = [];
    const warnings = [];
    for (const [dep, range] of Object.entries(peers)) {
        const result = examinePeer(dep, range, meta[dep]?.optional === true, pluginDir, profileDir);
        if (result.kind === 'missing')
            missing.push(result.name);
        else if (result.kind === 'mismatch')
            mismatched.push(result.issue);
        else if (result.kind === 'warn')
            warnings.push(result.message);
    }
    return { missing, mismatched, warnings };
}
function skippedResult(reason) {
    return { ok: true, missing: [], mismatched: [], suggestions: [], warnings: [`跳过依赖预检：${reason}`] };
}
/**
 * Pre-check the peer dependencies of a candidate plugin. Returns:
 *   { ok, missing, mismatched, suggestions, warnings }
 *  - missing: deps required (not optional) but absent from node_modules
 *  - mismatched: deps present at a version outside the declared range
 *  - suggestions: `dsh plugin add ...` repair commands
 *  - warnings: non-blocking notes (plugin unreadable / optional peers missing)
 * When the plugin or its package.json cannot be located the check is skipped
 * (ok: true) so an unusual install layout is never a false block.
 */
export function checkPeerDependencies({ profileDir, pluginName, }) {
    const pluginDir = findModuleDir(join(profileDir, 'node_modules'), basePackage(pluginName));
    if (pluginDir === null)
        return skippedResult(`无法定位插件 ${pluginName}（未在 profile node_modules 找到 package.json）`);
    const pkg = readPackageJson(pluginDir);
    if (pkg === null)
        return skippedResult(`无法解析 ${pluginName} 的 package.json`);
    const { missing, mismatched, warnings } = classifyPeers(objectOrEmpty(pkg.peerDependencies), objectOrEmpty(pkg.peerDependenciesMeta), pluginDir, profileDir);
    return {
        ok: missing.length === 0 && mismatched.length === 0,
        missing,
        mismatched,
        suggestions: buildSuggestions(missing, mismatched),
        warnings,
    };
}
/** 缺失一句：宿主提供的包不提示安装（#410：按提示执行会装错）。 */
function missingSentence(dep) {
    return isHostProvided(dep)
        ? `宿主提供的依赖 ${dep} 未在 profile 解析（由宿主运行时供给，无需安装）`
        : `缺少依赖 ${dep}（请先安装）`;
}
/** 版本不满足一句：单独成句，绝不复用「缺少依赖（请先安装）」文案（#410）。 */
function mismatchSentence(item) {
    const sentence = `依赖版本不满足 ${item.name}：声明 ${item.expected}，当前 ${item.found}`;
    return isHostProvided(item.name) ? `${sentence}（宿主提供，无需安装）` : sentence;
}
/**
 * Build the message recorded for a failed pre-check. 缺失与版本不满足是两种结论，
 * 各自成句（#410）：此前二者被合并渲染成「缺少依赖 X（请先安装）」，把「装着但
 * 版本不在声明范围」误诊成缺失，并诱导用户把宿主自有包装进 profile。
 */
export function buildDependencyMessage(result) {
    const missing = Array.isArray(result.missing) ? result.missing : [];
    const mismatched = Array.isArray(result.mismatched) ? result.mismatched : [];
    const sentences = [...missing.map(missingSentence), ...mismatched.map(mismatchSentence)];
    if (sentences.length === 0)
        return '依赖预检失败';
    return sentences.join('；');
}
/**
 * 预检失败的分类（#410）：硬缺失与版本不满足在面板/失败分类徽标上必须能区分。
 * 两者同时存在时记硬缺失（单一徽标字段只承载一个值，两类文案都进 message）。
 */
export function dependencyFailureType(result) {
    const missing = Array.isArray(result.missing) ? result.missing : [];
    return missing.length > 0 ? 'dependency-missing' : 'dependency-mismatch';
}
/** Classify a mount failure for the isolation record (issue #86). */
export function classifyFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot find module|MODULE_NOT_FOUND|Cannot resolve/i.test(message))
        return 'dependency';
    if (/already exists|already in use|conflict/i.test(message))
        return 'other';
    return 'code';
}
