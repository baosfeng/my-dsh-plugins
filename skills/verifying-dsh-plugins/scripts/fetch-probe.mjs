#!/usr/bin/env node
/**
 * fetch-probe.mjs — `NODE_OPTIONS=--import` 探针：包住最内层 globalThis.fetch，
 * 把匹配 URL 的出站请求头（有无 x-opencode-session / authorization）逐条追加到
 * JSONL 日志。用于发版前功能级验证的「真实模型调用」取证，以及对照组/实验组对比
 * （对照组复现问题、实验组证明修复，二者缺一不可）。
 *
 * 用法（探针必须在 DSH 入口之前加载，只有 --import 做得到）：
 *
 *   NODE_OPTIONS="--import /abs/path/skills/verifying-dsh-plugins/scripts/fetch-probe.mjs" \
 *   PROBE_LOG=/tmp/probe.jsonl PROBE_MATCH=opencode.ai \
 *   DSH_HOME=/tmp/dsh-verify-headless dsh --profile headless-verify "只回复 PONG，不要调用任何工具"
 *
 * 环境变量：
 *   PROBE_LOG      输出 JSONL 路径（默认 /tmp/dsh-fetch-probe.jsonl）
 *   PROBE_MATCH    URL 子串过滤；空则记录全部 fetch
 *   PROBE_VERBOSE  1 = 同时把每条记录打到 stderr
 *
 * 输出字段：{ ts, url, hasSessionHeader, sessionHeader, hasAuthorization }
 *   hasSessionHeader=false  → 该请求没带会话头（对照组复现 400 MissingSessionID 的证据）
 *   sessionHeader=<裸 UUID> → 插件 valueMode=uuid 生效
 *   hasAuthorization=true   → 补头未破坏鉴权（Authorization 仍在）
 */
import { appendFileSync } from 'node:fs'

const logPath = process.env.PROBE_LOG || '/tmp/dsh-fetch-probe.jsonl'
const match = process.env.PROBE_MATCH || ''
const verbose = process.env.PROBE_VERBOSE === '1'
const original = globalThis.fetch

globalThis.fetch = async function probedFetch(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input))
  if (match === '' || url.includes(match)) {
    const rawHeaders = init?.headers ?? (typeof input === 'object' && input !== null ? input.headers : undefined)
    const headers = new Headers(rawHeaders)
    const record = {
      ts: new Date().toISOString(),
      url,
      hasSessionHeader: headers.has('x-opencode-session'),
      sessionHeader: headers.get('x-opencode-session'),
      hasAuthorization: headers.has('authorization'),
    }
    appendFileSync(logPath, `${JSON.stringify(record)}\n`)
    if (verbose) console.error('[probe]', JSON.stringify(record))
  }
  return original.call(this, input, init)
}
