/**
 * dsh-my-guard — host half.
 *
 * 安全护栏三件套：
 *  1. 执行前护栏：监听 tools/pre-execute，破坏性命令（rm -rf / 等）执行前
 *     拦截/确认——默认 observe 只读观察 + 告警（透传 next()，不改变工具
 *     流程）；mode=ask 时返回 `{ kind: 'ask', reason }` 触发 DSH 原生审批
 *     确认；mode=deny 时直接拦截；用户自定义护栏规则（正则 + 模式 + 严重
 *     级）与内置规则合并生效（issue #88）；
 *  2. 安装前投毒扫描：检测 bash 命令中的 `dsh plugin add <pkg>` 异步扫描
 *     包内容（本地目录或 registry tarball，绝不执行包内代码），可疑内容
 *     （可疑脚本/密钥/恶意依赖）告警；`POST /guard/api/scan` 手动扫描；
 *  3. 提示注入检测：监听 session/event 的 user/message（过滤插件注入），
 *     规则 + 启发式检测 prompt injection / jailbreak，命中告警。
 *
 * 告警统一进 store（$DSH_HOME/guard/alerts.json，防抖 + 原子写 + 重启
 * 恢复），侧边栏「安全护栏」面板展示 + 用户确认机制；高严重级告警（deny
 * 拦截/密钥泄露等）经 dsh-my-notify 推送通知（可选集成 + 同类型冷却）。
 *
 * 模块结构：
 *  - guard.js    — 执行前护栏（tools/pre-execute 拦截/确认 + 投毒扫描联动）
 *  - custom-rules.js — 自定义护栏规则（编译/匹配/合并决策，issue #88）
 *  - notify.js   — 高严重级告警通知（dsh-my-notify 触发接口 + 冷却）
 *  - poison.js   — 投毒扫描引擎（纯函数：目录/tarball/包名）
 *  - injection.js — 提示注入检测（纯函数：规则 + 启发式）
 *  - store.js    — 告警存储（持久化 / 上限 / 确认）
 *  - routes.js   — /guard/api 路由（状态 / 告警 / 扫描 / 确认 / 规则）
 */
import { createStore } from './store.js'
import { attachGuardListener, normalizeMode } from './guard.js'
import { attachInjectionListener } from './injection.js'
import { registerGuardRoutes } from './routes.js'
import { compileCustomRules, rawRulesOf } from './custom-rules.js'
import { createNotifier } from './notify.js'
import { DEFAULT_NOTIFY_COOLDOWN_MS } from './constants.js'
import { currentProfile, patchFileOf, writePatchConfig } from 'dsh-shared'
import type { DshContext, GuardOptions, GuardMode, CompiledRule } from './types.js'

export const name = 'dsh-my-guard'

export const inject = ['webServer']

/** 插件配置接口。 */
export interface Config {
  mode?: unknown
  poisonScan?: boolean
  injection?: boolean
  customRules?: unknown
  notifyEnabled?: boolean
  notifyCooldownMs?: number
  notifyToken?: string
  notifyBaseUrl?: string
}

export function apply(ctx: DshContext, config?: Config): void {
  // ── 配置（应用层 config 覆盖，默认全部开启）─────────────────────────
  const options: GuardOptions = {
    mode: normalizeMode(config?.mode),
    poisonScan: config?.poisonScan !== false,
    injection: config?.injection !== false,
    customRules: normalizeCustomRules(config?.customRules),
    notifyEnabled: config?.notifyEnabled === true,
    notifyCooldownMs: normalizeCooldown(config?.notifyCooldownMs),
    notifyToken: typeof config?.notifyToken === 'string' ? config.notifyToken : '',
    notifyBaseUrl: deriveNotifyBaseUrl(ctx, config),
  }

  // ── 告警存储：持久化 + 重启恢复 ─────────────────────────────────────
  const store = createStore(ctx)

  // ── 高严重级告警通知（dsh-my-notify 可选集成 + 同类型冷却）─────────
  const notifier = createNotifier({
    options,
    baseUrl: options.notifyBaseUrl,
    token: options.notifyToken,
  })

  // 统一记录出口：入库 + 高严重级尝试通知（通知异步、失败静默）。
  const recordAlert = (alert: { type: string; sessionId?: string; severity: string; message: string; detail?: Record<string, unknown> }) => {
    const item = store.record(alert)
    notifier.notify(alert)
    return item
  }

  // ── 配置保存：自定义规则 + 通知设置 → profile patch + 更新内存 ─────
  // 设置页保存即生效；DSH 的 watchUserPatches 会热重载 patch 文件。
  const saveConfig = async (next: { customRules?: unknown[]; notifyEnabled?: boolean; notifyCooldownMs?: number }) => {
    const customRules = next.customRules === undefined ? options.customRules : compileCustomRules(next.customRules)
    const merged: GuardOptions = {
      mode: options.mode,
      poisonScan: options.poisonScan,
      injection: options.injection,
      customRules,
      notifyEnabled: typeof next.notifyEnabled === 'boolean' ? next.notifyEnabled : options.notifyEnabled,
      notifyCooldownMs: normalizeCooldown(next.notifyCooldownMs ?? options.notifyCooldownMs),
      notifyToken: options.notifyToken,
      notifyBaseUrl: options.notifyBaseUrl,
    }
    // 持久化到 profile patch
    await writePatchConfig(patchFileOf(currentProfile()), 'guard', patchConfigOf(merged))
    Object.assign(options, merged)
    const dropped = next.customRules === undefined ? 0 : rawCountOf(next.customRules) - customRules.length
    return {
      customRules: rawRulesOf(options.customRules),
      notifyEnabled: options.notifyEnabled,
      notifyCooldownMs: options.notifyCooldownMs,
      dropped,
    }
  }

  // ── 执行前护栏（破坏性命令拦截/确认 + 投毒扫描联动）────────────────
  attachGuardListener(ctx, options, recordAlert)

  // ── 提示注入检测（user/message 监听）─────────────────────────────────
  if (options.injection) attachInjectionListener(ctx, recordAlert)

  // ── 路由（状态 / 告警 / 扫描 / 确认 / 规则）────────────────────────
  registerGuardRoutes(ctx, store, options, { saveConfig })

  // ── 卸载冲刷：清防抖定时器 + 立即落盘 ───────────────────────────────
  ctx.effect(() => store.dispose, 'dsh-my-guard: persistence teardown')
}

// ── helpers ────────────────────────────────────────────────────────────────

/** 编译自定义规则（config 可能为 JSON 字符串（patch 持久化）或数组（测试。 */
function normalizeCustomRules(value: unknown): CompiledRule[] {
  if (typeof value === 'string') {
    try {
      return compileCustomRules(JSON.parse(value))
    } catch {
      return compileCustomRules([])
    }
  }
  return compileCustomRules(value)
}

/** 通知冷却时长规整（非法回退默认 60s）。 */
function normalizeCooldown(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_NOTIFY_COOLDOWN_MS
}

/** 从 webServer 派生 loopback 基础地址（无端口/未注入返回空串）。 */
function deriveNotifyBaseUrl(ctx: DshContext, config?: Config): string {
  if (typeof config?.notifyBaseUrl === 'string' && config.notifyBaseUrl !== '') return config.notifyBaseUrl
  const webServer = ctx.webServer
  if (webServer === undefined || webServer === null || typeof webServer.port !== 'number' || webServer.port <= 0) {
    return ''
  }
  const host = typeof webServer.host === 'string' && webServer.host !== '' ? webServer.host : '127.0.0.1'
  return `http://${host}:${webServer.port}`
}

/** 原始规则条数（定制化设置错误提示：被丢弃数 = 原始条数 - 编译通过条数）。 */
function rawCountOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/** 序列化为 patch 配置（customRules 对象数组 → JSON 字符串，YAML 子集可写）。 */
function patchConfigOf(options: GuardOptions): Record<string, unknown> {
  return {
    mode: options.mode,
    poisonScan: options.poisonScan,
    injection: options.injection,
    customRules: JSON.stringify(rawRulesOf(options.customRules)),
    notifyEnabled: options.notifyEnabled,
    notifyCooldownMs: options.notifyCooldownMs,
  }
}
