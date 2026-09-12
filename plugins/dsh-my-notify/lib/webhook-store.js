/**
 * dsh-my-notify — webhooks 配置持久化 + 失败记录（issue #92）。
 *
 * webhooks 是对象数组，cordis.patch.yml 的 YAML 子集序列化
 * （writePatchConfig 的 yamlValue）只支持标量数组，无法表达对象数组——
 * 因此 webhooks 单独持久化到 `$DSH_HOME/profiles/<profile>/
 * notify-webhooks.json`（原子写 tmp+rename，dsh-shared atomicWriteJson；保存为
 * 用户显式操作 → force 立即落盘，issue #198），
 * API 层面仍并入现有 GET/PUT /notify/api/config 模式（config.webhooks
 * 字段），设置页保存即生效、重启恢复。
 *
 * 失败记录：内存环形缓冲（默认 50 条），GET /notify/api/webhooks 暴露，
 * 设置页可见。
 */
import { readFileSync } from 'node:fs';
import { atomicWriteJson } from 'dsh-shared';
/** 失败记录环形缓冲上限。 */
export const FAILURE_LOG_LIMIT = 50;
/** 创建 webhook 存储：load（同步，apply 时调用）+ save（原子写 JSON）。 */
export function createWebhookStore({ file, logger }) {
    return {
        failures: createFailureLog(FAILURE_LOG_LIMIT),
        load() {
            try {
                const parsed = JSON.parse(readFileSync(file, 'utf8'));
                return Array.isArray(parsed) ? parsed : [];
            }
            catch {
                // 文件不存在/损坏 → 空列表（尽力而为，不打断启动）
                return [];
            }
        },
        async save(webhooks) {
            // issue #198：用户点「保存」是低频**显式**操作——force 跳过默认 1s 节流
            // （否则 1s 内的连续保存会被拒绝、配置静默丢失）；字节上限沿用默认 1MB
            // （webhooks 为对象数组，体积远小于上限）。
            await atomicWriteJson(file, webhooks, logger, 'dsh-my-notify webhooks', { force: true });
        },
    };
}
/** 失败记录环形缓冲：add 追加（超限丢最旧），list 返回副本。 */
export function createFailureLog(limit) {
    const entries = [];
    return {
        add(failure) {
            entries.push(failure);
            if (entries.length > limit)
                entries.splice(0, entries.length - limit);
        },
        list() {
            return [...entries];
        },
    };
}
