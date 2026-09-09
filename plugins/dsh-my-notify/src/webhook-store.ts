/**
 * dsh-my-notify — webhooks 配置持久化 + 失败记录（issue #92）。
 *
 * webhooks 是对象数组，cordis.patch.yml 的 YAML 子集序列化
 * （writePatchConfig 的 yamlValue）只支持标量数组，无法表达对象数组——
 * 因此 webhooks 单独持久化到 `$DSH_HOME/profiles/<profile>/
 * notify-webhooks.json`（原子写 tmp+rename，dsh-shared atomicWriteJson），
 * API 层面仍并入现有 GET/PUT /notify/api/config 模式（config.webhooks
 * 字段），设置页保存即生效、重启恢复。
 *
 * 失败记录：内存环形缓冲（默认 50 条），GET /notify/api/webhooks 暴露，
 * 设置页可见。
 */
import { readFileSync } from 'node:fs'
import { atomicWriteJson } from 'dsh-shared'
import type { FailureLog, Logger, WebhookConfig, WebhookFailure, WebhookStore } from './types.js'

/** 失败记录环形缓冲上限。 */
export const FAILURE_LOG_LIMIT = 50

/** 创建 webhook 存储：load（同步，apply 时调用）+ save（原子写 JSON）。 */
export function createWebhookStore({ file, logger }: { file: string; logger: Logger }): WebhookStore {
  return {
    failures: createFailureLog(FAILURE_LOG_LIMIT),
    load() {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        return Array.isArray(parsed) ? (parsed as WebhookConfig[]) : []
      } catch {
        // 文件不存在/损坏 → 空列表（尽力而为，不打断启动）
        return []
      }
    },
    async save(webhooks: WebhookConfig[]) {
      await atomicWriteJson(file, webhooks, logger, 'dsh-my-notify webhooks')
    },
  }
}

/** 失败记录环形缓冲：add 追加（超限丢最旧），list 返回副本。 */
export function createFailureLog(limit: number): FailureLog {
  const entries: WebhookFailure[] = []
  return {
    add(failure: WebhookFailure) {
      entries.push(failure)
      if (entries.length > limit) entries.splice(0, entries.length - limit)
    },
    list() {
      return [...entries]
    },
  }
}
