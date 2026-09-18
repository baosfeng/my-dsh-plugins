/**
 * dsh-my-guard — 设置页配置读写（GET/PUT /guard/api/config）。
 *
 * 设置 → 插件 → 安全护栏页签编辑应用层配置（mode / poisonScan / injection /
 * notifyEnabled / notifyCooldownMs），保存即三步：
 *   1. **校验**：非法值一律回退默认——绝不把坏值写进 profile patch
 *      （写坏后 DSH 热重载会带着坏配置重启插件，比不生效更糟）；
 *   2. **写回**：profile patch 文件（复用 dsh-shared 的 writePatchConfig /
 *      patchFileOf / currentProfile；DSH 的 watchUserPatches 监听它热重载）；
 *   3. **生效**：立即 Object.assign 到内存 options——当前实例无需等重载，
 *      护栏监听器读的就是这份 options（见 guard.js / injection.js）。
 *
 * customRules（正则规则列表）不在这里编辑：侧边栏「安全护栏」面板已有完整
 * 编辑器，设置页只显示条数 + 指引（两套 JSON 编辑器并存必然口径分裂）。
 * 两条写入口（本文件与 POST /guard/api/rules）共用同一个 createConfigSaver，
 * 因此互相不会覆盖对方字段。
 */
import { currentProfile, patchFileOf, writePatchConfig } from 'dsh-shared';
import { normalizeMode } from './guard.js';
import { compileCustomRules, rawRulesOf } from './custom-rules.js';
import { DEFAULT_NOTIFY_COOLDOWN_MS } from './constants.js';
import { readJsonBody, writeJson } from './http.js';
/** 生效配置快照（GET /guard/api/config 与 /guard/api/status 共用同一形状）。 */
export function configValue(options) {
    return {
        mode: options.mode,
        poisonScan: options.poisonScan,
        injection: options.injection,
        customRulesCount: Array.isArray(options.customRules) ? options.customRules.length : 0,
        notifyEnabled: options.notifyEnabled === true,
        notifyCooldownMs: options.notifyCooldownMs,
    };
}
/** 通知冷却时长规整（非法回退默认 60s）。 */
export function normalizeCooldown(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_NOTIFY_COOLDOWN_MS;
}
/** 布尔配置项校验：未提交保持现值，提交但非法回退默认（默认全开/关闭）。 */
function boolOr(value, current, fallback) {
    if (typeof value === 'boolean')
        return value;
    return value === undefined ? current : fallback;
}
/**
 * 合并设置页提交的配置补丁 → 新 options + 被丢弃的非法规则数。
 * 未提交的字段保持现值（两个写入口可以只提交自己那一部分，互不覆盖）。
 */
export function mergeConfigPatch(options, payload) {
    const raw = payload.customRules;
    const customRules = raw === undefined ? options.customRules : compileCustomRules(raw);
    const dropped = raw === undefined ? 0 : rawCountOf(raw) - customRules.length;
    return {
        next: {
            mode: payload.mode === undefined ? options.mode : normalizeMode(payload.mode),
            poisonScan: boolOr(payload.poisonScan, options.poisonScan, true),
            injection: boolOr(payload.injection, options.injection, true),
            customRules,
            notifyEnabled: boolOr(payload.notifyEnabled, options.notifyEnabled, false),
            notifyCooldownMs: payload.notifyCooldownMs === undefined ? options.notifyCooldownMs : normalizeCooldown(payload.notifyCooldownMs),
            notifyToken: options.notifyToken,
            notifyBaseUrl: options.notifyBaseUrl,
        },
        dropped,
    };
}
/** 配置保存器：校验 → 写 profile patch → 更新内存（routes 与设置页共用）。 */
export function createConfigSaver(options) {
    return async (next) => {
        const { next: merged, dropped } = mergeConfigPatch(options, next);
        await writePatchConfig(patchFileOf(currentProfile()), 'guard', patchConfigOf(merged));
        Object.assign(options, merged);
        return { ...configValue(merged), customRules: rawRulesOf(merged.customRules), dropped };
    };
}
/** /guard/api/config 分派：GET 读生效配置，PUT 校验后写回；非 config 返回 false。 */
export async function dispatchConfigApi(method, request, response, options, control) {
    if (method !== 'config')
        return false;
    if (request.method === 'GET') {
        writeJson(response, 200, { ok: true, value: configValue(options) });
        return true;
    }
    if (request.method === 'PUT') {
        await handleConfigPut(request, response, control);
        return true;
    }
    return false;
}
/** PUT /guard/api/config：保存不可用时 400（与 POST /rules 同契约）。 */
async function handleConfigPut(request, response, control) {
    if (control === undefined || typeof control.saveConfig !== 'function') {
        writeJson(response, 400, { ok: false, error: { message: 'config not available' } });
        return;
    }
    const payload = await readJsonBody(request);
    const result = await control.saveConfig(payload);
    writeJson(response, 200, { ok: true, value: result });
}
/** 原始规则条数（设置页/侧边栏错误提示：被丢弃数 = 原始条数 - 编译通过条数）。 */
function rawCountOf(value) {
    return Array.isArray(value) ? value.length : 0;
}
/** 序列化为 patch 配置（customRules 对象数组 → JSON 字符串，YAML 子集可写）。 */
function patchConfigOf(options) {
    return {
        mode: options.mode,
        poisonScan: options.poisonScan,
        injection: options.injection,
        customRules: JSON.stringify(rawRulesOf(options.customRules)),
        notifyEnabled: options.notifyEnabled,
        notifyCooldownMs: options.notifyCooldownMs,
    };
}
