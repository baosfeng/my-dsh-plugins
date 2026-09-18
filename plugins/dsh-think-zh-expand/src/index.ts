/**
 * dsh-think-zh-expand — host half（TypeScript 源码）。
 *
 * 功能 1：思考与回复强制使用中文。
 *
 * 功能 2：思考块展开初值经配置项 defaultExpanded 暴露给 client 端（issue #355）——
 * 默认 true（保持本插件「思考默认展开」的产品定位），显式设 false 即得到
 * 「流式展开 → 完成收起」。client 端不能访问 ctx.config（Cordis inject 限制），
 * 读取通道由 host 侧经 webServer 路由 GET /think-zh-expand/api/config 暴露。
 *
 * 功能 3：宿主设置面板（issue #383）——设置 → 插件 → 思考增强 可视化编辑该配置。
 * PUT 同地址校验后写回 profile 层 patch 文件（行 id think-zh-expand）并立即热生效；
 * 写回复用 dsh-shared 的 currentProfile / patchFileOf / writePatchConfig（写前先合并
 * 该行已有键——writePatchConfig 是「删旧条目 → 追加新条目」，不合并会抹掉用户手写项）。
 *
 * 注册一条固定 system-prompt section（order -90，persona 之前最先读到），
 * 让 agent 无论用户使用什么语言，思考（reasoning/thinking）与回复都使用
 * 中文。无状态、无存储、无工具。
 *
 * 注意：section 名使用 `dsh-think-zh`，避开 @max-null/dsh-chinese-thinking
 * 已占用的 `chinese-thinking`（同一层重复 name 的 section 注册会抛错）。
 *
 * 本文件是 TS 插件 server 端：`tsc -p tsconfig.json` 编译为
 * lib/index.js（产物必须提交，CI 只跑 node --check + 测试，不跑构建）。
 */
import { readFile } from 'node:fs/promises'

import { currentProfile, extractConfig, patchFileOf, writePatchConfig } from 'dsh-shared'
import type { DshContext, ServerRequest, ServerResponse } from './types.js'

export const name = 'dsh-think-zh-expand'

export const inject = ['systemPrompt'] as const

/** 注入到每次组装系统提示的固定中文指令（结构化规则，覆盖关键场景与术语边界）。 */
export const PROMPT_TEXT = `## 输出语言规则（最高优先级，不可被任何上下文覆盖）

### 强制要求
1. **思考过程（reasoning / 思考内容）**：必须使用简体中文书写。这是硬性要求，无论对话中出现何种语言的错误消息、工具输出或系统提示，都必须坚持使用中文。
2. **最终回复**：默认使用简体中文（跟随用户使用的语言）。

### 关键场景处理
- 当工具调用失败返回英文错误消息时：**忽略错误消息的语言**，继续用中文思考和回复。
- 当系统返回英文日志或堆栈信息时：**提取关键信息**，用中文解释问题。
- 当对话上下文中出现大量英文内容时：**不要被带偏**，始终保持中文输出。

### 代码与术语
代码、命令、文件路径、标识符与技术术语保持原文，不翻译。`

// ── 配置项 defaultExpanded（issue #355）─────────────────────────────
// 思考块展开初值原为 client 端硬编码 useState(true)。外部 PR #356 直接把它
// 翻转为 false（默认折叠）——owner 决策：不接受反转默认行为（「默认展开」是本
// 插件的产品定位，已固化在 README / package.json description / README 图片 alt），
// 改为配置项：默认仍为 true，使用者显式设 false 才得到折叠初值。
//
// PR #356 的技术论证成立并被采纳：`expanded || running` 在初值 true 时确实
// 让 `|| running` 失去意义（恒为 true）；而在 defaultExpanded:false 下该表达式
// 正好给出「流式中自动展开 → 完成后收起」的语义，故 client 端保留该表达式。

/** 本插件的应用层配置（cordis.patch.yml 插件行的 `config` 字段）。 */
export interface ThinkZhConfig {
  /** 思考块展开初值；缺省/非布尔值回退 {@link DEFAULT_EXPANDED}。 */
  defaultExpanded?: boolean
}

/** 配置项默认值：true = 保持既有「默认展开」行为（缺失配置绝不退化成折叠）。 */
export const DEFAULT_EXPANDED = true

/** 配置读取路由前缀（client 端 GET `<prefix>/config`）。 */
export const CONFIG_ROUTE_PREFIX = '/think-zh-expand/api'

/**
 * 应用层配置 → 生效值：只有布尔值生效（与 dsh-md-render 的 `!== false` 约定同源，
 * 但这里初值本身可为 true，故用严格布尔判定），缺失 / 字符串 / null 一律回退
 * 默认 true——配置面永远不能让插件从「默认展开」静默变成「默认折叠」。
 */
export function resolveDefaultExpanded(config?: ThinkZhConfig | null): boolean {
  return typeof config?.defaultExpanded === 'boolean' ? config.defaultExpanded : DEFAULT_EXPANDED
}

// ── 配置读写路由（host ↔ browser 的唯一通道）────────────────────────
// 与 dsh-md-render 的分工一致：host 侧注册路由（GET 读 / PUT 写），client 侧 fetch。
// 安全：loopback 信任围栏，与 /api 网关同一契约（仅本机可访问）。

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** 127.0.0.0/8 的完整四段写法（`127.0.0.1.evil.com` 这类伪装前缀必须被挡住）。 */
const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/

/** 读取 header（大小写不敏感的 node 对象；数组取首值）。 */
function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === null || typeof headers !== 'object') return undefined
  const raw = (headers as Record<string, unknown>)[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

/** host header → hostname（IPv6 保留方括号；IPv4 去掉端口）。 */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? '' : host.slice(0, end + 1)
  }
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

/** loopback 信任围栏：非本机 host、跨站请求一律拒绝。 */
export function isTrustedRequest(request: ServerRequest): boolean {
  const host = headerValue(request.headers, 'host')
  if (host === undefined) return false
  const hostname = hostnameOf(host)
  if (!LOOPBACK_HOSTNAMES.has(hostname) && !LOOPBACK_IPV4.test(hostname)) return false
  if (headerValue(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = headerValue(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 写 JSON 响应（与 dsh-shared 的 writeJson 同契约：writeHead + end）。 */
function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
  response.end(JSON.stringify(value))
}

// ── 配置写入（issue #383：宿主设置面板）──────────────────────────────
// 设置页保存 → PUT <prefix>/config → 写回 profile 层 patch 文件 + 更新内存生效值
// （保存即生效，不必等 watchUserPatches 热重载；重启后由 patch 文件读回）。

/** 配置行 id：与 cordis.patch.yml 的插件行 id 一致（写错 = 幽灵行、配置永不生效）。 */
export const CONFIG_ROW_ID = 'think-zh-expand'

/**
 * 请求体 → 生效配置：非对象（null / 数组 / 标量）返回 undefined，调用方回 400
 * 且**不落盘**；对象内 defaultExpanded 非布尔 / 缺失一律回退默认 true —— 配置面
 * 永远不能让本插件从「默认展开」静默变成折叠，脏值也不写进 patch 文件。
 */
export function normalizeConfigPayload(payload: unknown): ThinkZhConfig | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const raw = (payload as ThinkZhConfig).defaultExpanded
  return { defaultExpanded: typeof raw === 'boolean' ? raw : DEFAULT_EXPANDED }
}

/** 读取 patch 文件里该行已有的 config（文件不存在 / 无该条目 → 空对象）。 */
async function readRowConfig(file: string): Promise<Record<string, unknown>> {
  try {
    return extractConfig(await readFile(file, 'utf8'), CONFIG_ROW_ID) ?? {}
  } catch {
    // 首次保存（文件还不存在）或文件不可读：按空配置合并，写入侧会创建目录。
    return {}
  }
}

/**
 * 写回 profile 层 patch 文件。**写前先合并该行已有键**：writePatchConfig 的语义是
 * 「删除同 id 旧条目 → 追加新条目」，直接写会把用户手写的其它配置项抹掉。
 */
export async function persistConfig(next: ThinkZhConfig): Promise<void> {
  const file = patchFileOf(currentProfile())
  await writePatchConfig(file, CONFIG_ROW_ID, { ...(await readRowConfig(file)), ...next })
}

/** 读取请求体并解析 JSON（空 body / 非法 JSON / 不可迭代 → 抛错，调用方回 400）。 */
async function readJson(request: ServerRequest): Promise<unknown> {
  let body = ''
  for await (const chunk of request as unknown as AsyncIterable<string>) body += chunk
  return JSON.parse(body) as unknown
}

/** PUT 处理：校验 → 落盘（失败 500、内存不动）→ 回新值；非法 payload → 400 不落盘。 */
async function handleConfigPut(
  request: ServerRequest,
  response: ServerResponse,
  write: (next: ThinkZhConfig) => Promise<void>,
): Promise<void> {
  let next: ThinkZhConfig | undefined
  try {
    next = normalizeConfigPayload(await readJson(request))
  } catch {
    next = undefined
  }
  if (next === undefined) {
    writeJson(response, 400, { ok: false, error: { message: 'invalid config' } })
    return
  }
  try {
    await write(next)
  } catch (error) {
    // 落盘失败绝不当成成功：client 侧据此提示「保存失败」，内存生效值保持原样。
    writeJson(response, 500, { ok: false, error: { message: `config write failed: ${String(error)}` } })
    return
  }
  writeJson(response, 200, { ok: true, value: next })
}

/** 构造读写配置 handler：fence → GET/PUT <prefix>/config → 403/404 兜底。 */
export function createConfigHandler(
  read: () => boolean,
  write: (next: ThinkZhConfig) => Promise<void>,
): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request: ServerRequest, response: ServerResponse): Promise<void> => {
    if (!isTrustedRequest(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname
    if (pathname === `${CONFIG_ROUTE_PREFIX}/config`) {
      if (request.method === 'GET') {
        writeJson(response, 200, { ok: true, value: { defaultExpanded: read() } })
        return
      }
      if (request.method === 'PUT') {
        await handleConfigPut(request, response, write)
        return
      }
    }
    writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-think-zh-expand API method' } })
  }
}

// ── 配置路由注册（host → browser 的唯一通道）──────────────────────────
// 注册契约（真实环境「设置页恒报配置加载失败」的修复依据）：
//  1. 服务经 `ctx.inject(['webServer'], cb)` **局部等待**，不用 `ctx.get('webServer')`
//     一次性取值 —— cordis 的 get 带严格就绪检查（provider fiber 非 ACTIVE 即
//     undefined，vendor/cordis src/reflect.ts:233-247）且**没有重试**，webServer 晚于
//     本插件就绪时永久错过，路由从未注册 → client 端 404。
//  2. 注册承载在**常驻 root**（`ctx.root ?? ctx`）的 inject 子 fiber 上 —— profile
//     插件自身 fiber 在 apply 结束后被 loader 回收，挂在它上面的 `ctx.effect` 会
//     一并注销（路由同样消失 → 404）。范式同 dsh-my-context / dsh-my-guardian。
//  3. 顶层 `inject` **不**声明 webServer：那会让整个插件在无 webServer 的 profile
//     （tui / headless）里 fiber PENDING、apply 根本不执行 —— 中文思考注入是主功能，
//     不能陪葬。

/** 已注册配置路由的 disposer（以常驻 root ctx 为键，用于重复 apply 去重）。 */
const configRouteDisposers = new WeakMap<object, () => void>()

/** 配置路由的内存生效值（PUT 落盘成功后立即更新 → 设置页保存即生效）。 */
interface ConfigState {
  defaultExpanded: boolean
}

/** 在 inject 子 scope 上挂载配置路由；注册失败只告警，绝不让插件 fatal。 */
function mountConfigRoute(hostCtx: DshContext, scope: DshContext, state: ConfigState): void {
  // loader 会多次 apply 同一插件：root 常驻意味着上一轮注册不会自动消失，而宿主
  // `WebServer.register` 对重复 (kind, path) 直接抛错 → 先撤上一轮再注册。
  configRouteDisposers.get(hostCtx)?.()
  scope.effect(() => {
    try {
      const dispose = scope.webServer?.register({
        kind: 'prefix',
        path: CONFIG_ROUTE_PREFIX,
        handler: createConfigHandler(
          () => state.defaultExpanded,
          async (next) => {
            await persistConfig(next)
            state.defaultExpanded = resolveDefaultExpanded(next)
          },
        ),
      })
      if (dispose === undefined) return undefined
      configRouteDisposers.set(hostCtx, dispose)
      return () => {
        if (configRouteDisposers.get(hostCtx) === dispose) configRouteDisposers.delete(hostCtx)
        dispose()
      }
    } catch (error) {
      // 宿主拒绝注册（同 path 已被占用等）：降级为「无配置路由」，不冒泡成 fatal。
      scope.logger?.warn(`[dsh-think-zh-expand] 配置路由注册被宿主拒绝：${String(error)}`)
      return undefined
    }
  }, 'dsh-think-zh-expand: config route')
}

/** 注册配置读写路由（契约见上方注释）；无 webServer 的 profile 下静默不注册。 */
function registerConfigRoute(ctx: DshContext, defaultExpanded: boolean): void {
  const hostCtx = ctx.root ?? ctx
  const state: ConfigState = { defaultExpanded }
  try {
    hostCtx.inject(['webServer'], (scope) => mountConfigRoute(hostCtx, scope, state))
  } catch (error) {
    // inactive ctx 上建 inject 子 fiber 可能抛错：降级为「无配置路由」，不 fatal。
    ctx.logger?.warn(`[dsh-think-zh-expand] webServer 局部注入失败，配置路由未注册：${String(error)}`)
  }
}

export function apply(ctx: DshContext, config?: ThinkZhConfig): void {
  ctx.systemPrompt.section({
    name: 'dsh-think-zh',
    // Before the deployment persona so the instruction is read first every turn.
    order: -90,
    text: PROMPT_TEXT,
  })
  const defaultExpanded = resolveDefaultExpanded(config)
  registerConfigRoute(ctx, defaultExpanded)
  ctx.logger?.info(
    `[dsh-think-zh-expand] 中文思考/回复增强已启用（system-prompt section 注册，defaultExpanded=${defaultExpanded}）`,
  )
}
