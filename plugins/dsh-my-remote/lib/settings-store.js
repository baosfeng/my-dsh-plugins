/**
 * dsh-my-remote — 设置页的持久化（issue #385）。
 *
 * 写回 profile 层 patch 文件（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`，
 * 与 DSH 的 `watchUserPatches` 同一份文件 → 写入即被 loader 热重载）：
 *  读取该行已有 config（含嵌套 webhooks）→ 合并**本次提交的字段** → 整行重写。
 *
 * 数据破坏防护（三条都是实测踩出来的）：
 *  1. 先读该行已有键再合并：`writePatchConfig` 语义是「删同 id 旧条目 → 追加新条目」，
 *     不合并会抹掉用户手写的 `end` / `ask` / `approval` 等键。
 *  2. 整行 YAML 由 settings-yaml 渲染：dsh-shared 的序列化写不出嵌套 webhook 对象
 *     （会变成 `webhooks: [null]`）。
 *  3. 只对**提交过**的字段取生效值，其余取该行原值 —— 否则「只改超时」会把生效值
 *     里空的 webhooks 写回，用户手写的 webhook 列表整段丢失。
 */
import { currentProfile, patchFileOf } from 'dsh-shared';
import { settingsPatch } from './settings-model.js';
import { parseRowConfig, readFileOrEmpty, serializeConfigBlock, writeRowEntry } from './settings-yaml.js';
/**
 * 写回行 id：必须与 plugins/dsh-my-remote/cordis.patch.yml 的插件行 id 一致 ——
 * loader 按行 id 匹配配置，id 不符会新增孤儿行、原行配置永不生效。
 */
export const SETTINGS_ROW_ID = 'remote';
/** 写回 profile 层 patch 文件（读已有 → 合并本次提交字段 → 整行重写，原子写）。 */
export async function persistSettings(payload, next) {
    const file = patchFileOf(currentProfile());
    const text = await readFileOrEmpty(file);
    const existing = parseRowConfig(text, SETTINGS_ROW_ID);
    const entry = renderEntry({ ...existing, ...settingsPatch(payload, next, existing) });
    await writeRowEntry(file, text, SETTINGS_ROW_ID, entry);
}
/** 渲染该行的 YAML 文本（`- id: remote` + `  config:` + 4 空格字段）。 */
function renderEntry(config) {
    return [`- id: ${SETTINGS_ROW_ID}`, '  config:', serializeConfigBlock(config)].join('\n');
}
