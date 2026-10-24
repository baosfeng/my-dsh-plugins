/**
 * dsh-my-skill-manager — 启用/禁用配置读写（双作用域）。
 *
 * 作用域：
 *  - global:  `$DSH_HOME/skills.enabled.json`（缺省 `~/.dsh/skills.enabled.json`）
 *  - project: `<projectRoot>/.dsh/skills.enabled.json`，projectRoot = 从 cwd
 *    向上找最近的 `.git` 目录（随仓库版本化）。
 *
 * 文档形状（向后兼容既有用户数据，只有 disabled 生效）：
 *   { "global": { "disabled": [...] }, "project": { "disabled": [...] } }
 *
 * 读：缺失 / 损坏 / 结构异常一律降级为空名单（防御式，不抛）。
 * 写：先建目录，tmp + rename 原子落盘，保留另一作用域的内容。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { findProjectRoot } from 'dsh-shared';
/** 配置文件固定名。 */
export const CONFIG_FILE_NAME = 'skills.enabled.json';
/** 项目配置目录（项目根下）。 */
const PROJECT_CONFIG_DIR = '.dsh';
/** DSH 主目录（$DSH_HOME，缺省 ~/.dsh）。 */
export function dshHome() {
    const home = process.env.DSH_HOME;
    return typeof home === 'string' && home !== '' ? home : join(homedir(), '.dsh');
}
/** 全局配置文件路径。 */
export function globalConfigFile() {
    return join(dshHome(), CONFIG_FILE_NAME);
}
/** 空配置文档。 */
export function emptyConfig() {
    return { global: { disabled: [] }, project: { disabled: [] } };
}
/** 过滤 + 去重的禁用名单规整（保持出现顺序）。 */
export function normalizeDisabledList(value) {
    if (!Array.isArray(value))
        return [];
    const names = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const name = item.trim();
        if (name === '' || names.includes(name))
            continue;
        names.push(name);
    }
    return names;
}
/** 只保留已知形状（未知字段丢弃，非法值降级为空）。 */
export function normalizeConfig(value) {
    const result = emptyConfig();
    if (value === null || typeof value !== 'object')
        return result;
    const source = value;
    result.global.disabled = normalizeDisabledList(source.global?.disabled);
    result.project.disabled = normalizeDisabledList(source.project?.disabled);
    return result;
}
/** 读取一个配置文件（缺失 / 损坏 / 结构异常 → 空配置）。 */
export async function readConfigFile(file) {
    try {
        const raw = await readFile(file, 'utf8');
        return normalizeConfig(JSON.parse(raw));
    }
    catch {
        return emptyConfig();
    }
}
/** 原子写配置文件（tmp + rename；自动建目录）。 */
export async function writeConfigFile(file, config) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf8');
    await rename(tmp, file);
}
/** 项目根（最近含 .git 的祖先；找不到时回退 cwd 自身）。 */
export async function projectRootOf(cwd) {
    return findProjectRoot(cwd);
}
/** 项目配置文件路径。 */
export async function projectConfigFileOf(cwd) {
    return join(await projectRootOf(cwd), PROJECT_CONFIG_DIR, CONFIG_FILE_NAME);
}
/** 读取全局配置。 */
export async function readGlobalConfig() {
    return readConfigFile(globalConfigFile());
}
/** 读取某个 cwd 的项目配置。 */
export async function readProjectConfig(cwd) {
    return readConfigFile(await projectConfigFileOf(cwd));
}
/** 读取两个作用域的禁用名单（cwd 缺省时项目段为空）。 */
export async function readDisabledLists(cwd) {
    const global = await readGlobalConfig();
    if (cwd === undefined || cwd === '') {
        return { globalDisabled: global.global.disabled, projectDisabled: [] };
    }
    const project = await readProjectConfig(cwd);
    return { globalDisabled: global.global.disabled, projectDisabled: project.project.disabled };
}
/** 保存一个作用域的禁用名单；返回写入的文件路径。 */
export async function saveDisabledList(input) {
    const disabled = normalizeDisabledList(input.disabled);
    const file = input.scope === 'global'
        ? globalConfigFile()
        : await projectConfigFileOf(input.cwd !== undefined && input.cwd !== '' ? input.cwd : process.cwd());
    const doc = await readConfigFile(file);
    doc[input.scope].disabled = disabled;
    await writeConfigFile(file, doc);
    return file;
}
