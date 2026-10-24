/**
 * dsh-my-skill-manager — 目录 + 官方 catalog 合并成统一视图模型。
 *
 * 数据来源两条：
 *  1. `ctx.skills.list({ cwd })`：宿主合并后的官方目录（含来源 / provider /
 *     invocation / path）；被禁用占位覆盖的名字以 provider=my-skill-manager
 *     出现（真实条目信息只能靠目录扫描补全）。
 *  2. 插件侧目录扫描（diagnostics.scanSkillRoots）：与官方一致的四个根目录，
 *     补出「官方 catalog 未收录」的正常条目（cataloged:false）与异常诊断。
 *
 * 合并规则（list 不再按全局/项目视图过滤，双作用域由两个禁用名单表达）：
 *  - 官方条目优先：name 以 catalog 为准，path 缺失时用扫描结果补；
 *  - 占位条目：用扫描到的 description/source/path 还原真实信息（cataloged:true），
 *    扫描也没有时只留名字（bundled/runtime 等无实体目录的 skill）；
 *  - 仅在扫描里出现的条目：cataloged:false，provider 固定为 'filesystem'；
 *  - 行按 name 码点升序，行的 usage 取统计快照里的同名条目。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findProjectRoot } from 'dsh-shared';
import { dshHome } from './config-store.js';
import { DISABLED_PROVIDER } from './disabler.js';
import { scanSkillRoots } from './diagnostics.js';
/** skill 根目录的末级目录名。 */
const SKILLS_DIR_NAME = 'skills';
/** agents 主目录（$DSH_AGENTS_HOME，缺省 ~/.agents）。 */
export function agentsHome() {
    const home = process.env.DSH_AGENTS_HOME;
    return typeof home === 'string' && home !== '' ? home : join(homedir(), '.agents');
}
/** 全局（用户级）skill 根目录。 */
export function userSkillRoots() {
    return [
        { path: join(dshHome(), SKILLS_DIR_NAME), source: 'user-dsh' },
        { path: join(agentsHome(), SKILLS_DIR_NAME), source: 'user-agents' },
    ];
}
/** 项目级 skill 根目录（cwd → 项目根）。 */
export async function projectSkillRoots(cwd) {
    const root = await findProjectRoot(cwd);
    return [
        { path: join(root, '.dsh', SKILLS_DIR_NAME), source: 'project-dsh' },
        { path: join(root, '.agents', SKILLS_DIR_NAME), source: 'project-agents' },
    ];
}
/** 全部扫描根（全局 + 项目；cwd 缺省时只有全局）。 */
export async function skillRootsOf(cwd) {
    const roots = userSkillRoots();
    if (cwd === undefined || cwd === '')
        return roots;
    roots.push(...(await projectSkillRoots(cwd)));
    return roots;
}
/** 按 name 码点升序（确定性，不受 locale 影响）。 */
function compareName(a, b) {
    if (a.name < b.name)
        return -1;
    return a.name > b.name ? 1 : 0;
}
/** 合并官方目录与目录扫描结果（纯函数，便于单测）。 */
export function mergeCatalog(input) {
    const scanByName = new Map();
    for (const skill of input.scanned)
        scanByName.set(skill.name, skill);
    const rows = new Map();
    for (const summary of input.catalog) {
        const scanned = scanByName.get(summary.name);
        if (summary.provider === DISABLED_PROVIDER) {
            // 占位条目：真实信息只能来自目录扫描；没有实体目录时只保留名字。
            rows.set(summary.name, {
                name: summary.name,
                ...(scanned !== undefined
                    ? { description: scanned.description, source: scanned.source, path: scanned.path }
                    : {}),
                cataloged: true,
            });
            continue;
        }
        rows.set(summary.name, {
            name: summary.name,
            description: summary.description,
            source: summary.source,
            provider: summary.provider,
            ...(summary.path !== undefined ? { path: summary.path } : scanned !== undefined ? { path: scanned.path } : {}),
            cataloged: true,
            invocation: summary.invocation,
        });
    }
    for (const scanned of input.scanned) {
        if (rows.has(scanned.name))
            continue;
        rows.set(scanned.name, {
            name: scanned.name,
            description: scanned.description,
            source: scanned.source,
            provider: 'filesystem',
            path: scanned.path,
            cataloged: false,
        });
    }
    const usage = input.usage ?? {};
    return [...rows.values()]
        .map((row) => (usage[row.name] !== undefined ? { ...row, usage: usage[row.name] } : row))
        .sort(compareName);
}
/** 扫描目录 + 合并官方目录，产出 /list 的视图（不含配置名单）。 */
export async function buildCatalogView(input) {
    const cwd = input.cwd !== undefined && input.cwd !== '' ? input.cwd : '';
    const projectRoot = cwd === '' ? '' : await findProjectRoot(cwd);
    const roots = await skillRootsOf(cwd === '' ? undefined : cwd);
    const scanned = await scanSkillRoots(roots);
    return {
        cwd,
        projectRoot,
        scannedAt: Date.now(),
        skills: mergeCatalog({ catalog: input.catalog, scanned: scanned.skills, usage: input.usage }),
        diagnostics: { missing: scanned.issues },
    };
}
