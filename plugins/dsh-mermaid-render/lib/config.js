/**
 * dsh-mermaid-render — 应用层配置语义与持久化（issue #383 宿主设置面板）。
 *
 * 本插件的应用层配置只有一项：`injectPrompt`（是否向系统提示词注入 mermaid
 * 能力说明）。语义关键点是 **fail-safe 方向**：只有**显式 `false`** 才关闭，
 * 缺失 / 非法值（字符串、数字、null…）一律按默认 `true` 处理 —— 配错顶多多
 * 吃一点上下文预算，而静默丢掉能力会让模型退回 ASCII 画图。
 *
 * 持久化复用 dsh-shared：写回 profile 层 `cordis.patch.yml` 的插件行（行 id
 * 必须与 cordis.patch.yml 的 `- id: mermaid-render` 一致，写错会多出一条幽灵
 * 行、配置永不生效）。DSH 的 watchUserPatches 热重载该文件 → 重启不丢。
 *
 * 本文件编译为 lib/config.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { currentProfile, patchFileOf, writePatchConfig } from 'dsh-shared';
/** 配置行 id：与 cordis.patch.yml 的插件行 id 一致（不是包名、不是插件名前缀）。 */
export const CONFIG_ROW_ID = 'mermaid-render';
/** 应用层 config（patch 行的 config）→ 生效配置：仅显式 false 关闭。 */
export function createConfigState(config) {
    return { injectPrompt: config?.injectPrompt !== false };
}
/**
 * 请求体 → 生效配置；非对象（null / 数组 / 标量）返回 undefined，调用方回 400
 * 且**不落盘**（宁可拒绝，也不要把脏值写进 patch 文件）。
 * 对象内的字段非法/缺失都按默认 `true`（只认显式 false）。
 */
export function normalizeConfigPayload(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        return undefined;
    return { injectPrompt: payload.injectPrompt !== false };
}
/** 写回 profile patch 文件（原子写）；失败向上抛，调用方据此回错误码且不动内存。 */
export async function persistConfig(next) {
    await writePatchConfig(patchFileOf(currentProfile()), CONFIG_ROW_ID, { injectPrompt: next.injectPrompt });
}
