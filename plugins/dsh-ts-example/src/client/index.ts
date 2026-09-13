/**
 * dsh-ts-example — client 端入口（TypeScript 源码，单文件）。
 *
 * 构建流程：`tsc -p tsconfig.client.json` 把本文件编译为 CommonJS 单文件
 * （lib/.client-build/index.js），scripts/build.mjs 再注入
 * lib/client.src.js 模板的 __CLIENT_BUNDLE__ 占位符，写出
 * lib/client.js（DSH 实际服务的 __ModuleLoader__ bundle）。
 *
 * 约束：client 端 TS 源码为单文件（无运行时相对 import——编译产物内联进
 * factory 作用域后，require 只认识 DSH 运行时注入的模块，如 react）。
 * 类型声明可拆文件（import type 编译期擦除）；需要多文件/复杂打包时可用
 * esbuild/tsdown（官方 tsdown.client.ts 协议）。
 *
 * 演示内容：侧边栏页签「TS 示例」——调 server 端 /ts-example/api/greeting
 * 显示问候语（client TS → server TS 全链路）。
 *
 * 侧边栏走**宿主原生扩展点**（issue #187 批 1），不再消费第三方
 * dsh-better-sidebar 服务：
 *   1. `ctx.sidebarRightTabs.register(...)` 注册页面类型（含 guide 胶囊，
 *      用户从右栏指南页点开）；
 *   2. keyed 席位 `sidebar.right.pane.tab` 注册面板本体（key = 类型 id）；
 *   3. keyed 席位 `sidebar.right.pane.tab.title` 注册页签标题。
 * 原生能力通过 Cordis 服务名 inject 获取（`slots` / `sidebarRightTabs`），
 * 无需 require 任何 `@deepseek-ai/dsh-client-ui-*` 包 —— 官方生产范本见
 * dsh-client-ui-sidebar-files/lib/client.js:681-711。
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'

// ── DSH 运行时类型（client 端最小契约，手写声明）──────────────────────

/** 宿主原生页签类型定义（dsh-client-ui-sidebar-right 的 register 入参子集）。 */
interface SidebarTabDefinition {
  /** 实现身份，全局唯一；同时是 body/title 席位注册用的 key（官方惯例 = 包名）。 */
  id: string
  /** 类型判别符，openTab 按它打开（本插件 = 原 better-sidebar 的 tab id）。 */
  kind: string
  /** 页签胶囊标题（打开时捕获；本节席另有 .title 席位负责实时标题）。 */
  title: (address: string) => string
  /** 指南页条目：order 决定相对顺序。 */
  guide?: Array<{ order: number; title: () => string; description?: () => string }>
}

/** keyed 席位注册表（@deepseek-ai/dsh-client-ui-slots 的服务面）。 */
interface SlotsService {
  register(descriptor: { name: string; key: string }, component: (props: any) => unknown): () => void
  inject(name: string, factory: () => unknown): () => void
}

/** 页签类型注册表（@deepseek-ai/dsh-client-ui-sidebar-right 的服务面）。 */
interface SidebarRightTabsService {
  register(definition: SidebarTabDefinition): () => void
}

/** client 端 Context（cordis Context 最小契约 + 宿主原生扩展点服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  slots: SlotsService
  sidebarRightTabs: SidebarRightTabsService
}

/** 页签面板要的运行时信息（原生 tabInfo hook 的子集）。 */
interface TabPanelProps {
  /** 面板可见性（原生：停靠页签需侧边栏展开且该页签激活）。 */
  visible?: boolean
  /** 会话作用域（原 better-sidebar 的 scope.sessionId）。 */
  scope?: { sessionId?: string }
}

/** 原生 keyed 席位注入的运行面（tab body / title 共用）。 */
interface NativeTabProps {
  sessionId?: string
  useTabInfo?: () => { tab?: { title?: string; visible?: boolean } }
}

// ── 插件体 ─────────────────────────────────────────────────────────────

/** 页签实现身份（官方惯例：包名；全局唯一）。 */
const TAB_ID = 'dsh-ts-example'
/** 页面类型判别符（沿用迁移前 better-sidebar 的 tab id）。 */
const TAB_KIND = 'dsh-ts-example:greeting'
/** 指南页相对顺序（沿用迁移前 better-sidebar 的 order）。 */
const TAB_ORDER = 90

export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: ClientContext): void {
  // 服务缺失（旧宿主）时静默跳过：判空必须同时覆盖 null 与 undefined
  // （typeof null 是 object，会骗过 === undefined 的写法）。
  const tabs = ctx.sidebarRightTabs
  const slots = ctx.slots
  if (tabs == null || slots == null) return

  ctx.effect(
    () =>
      tabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => 'TS 示例',
        guide: [{ order: TAB_ORDER, title: () => 'TS 示例' }],
      }),
    'dsh-ts-example: tab',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, GreetingTabBody),
      ),
    'dsh-ts-example: greeting tab body',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, GreetingTabTitle),
      ),
    'dsh-ts-example: greeting tab title',
  )
}

// ── 原生席位 → 面板适配 ────────────────────────────────────────────────

/**
 * 原生 tab body 席位：把原生 props（`sessionId` + `useTabInfo` hook）
 * 适配成面板契约（`scope.sessionId` + `visible`），面板本体零改动。
 * `useTabInfo` 缺失（契约不匹配）时保守取 visible=true，只影响轮询。
 */
function GreetingTabBody(props: NativeTabProps): ReactNode {
  const visible = props.useTabInfo?.()?.tab?.visible ?? true
  return createElement(GreetingPanel, { scope: { sessionId: props.sessionId }, visible })
}

/** 原生 tab title 席位：优先用宿主给定的标题（i18n 由文档标题决定）。 */
function GreetingTabTitle(props: NativeTabProps): ReactNode {
  return createElement('span', null, props.useTabInfo?.()?.tab?.title ?? 'TS 示例')
}

// ── 页面组件 ───────────────────────────────────────────────────────────

function GreetingPanel(props: { scope?: { sessionId?: string }; visible?: boolean }): ReactNode {
  const [greeting, setGreeting] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!props.visible) return
    let cancelled = false
    fetch(`/ts-example/api/greeting?name=${encodeURIComponent(props.scope?.sessionId ?? '')}`)
      .then((response) => response.json())
      .then((body: { greeting?: string }) => {
        if (!cancelled) {
          setGreeting(body.greeting ?? '')
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGreeting('(请求失败)')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.visible, props.scope?.sessionId])

  return createElement(
    'div',
    { style: { padding: '12px', fontFamily: 'var(--dsw-font-sans)' } },
    createElement('h3', null, 'TS 示例插件'),
    createElement('p', null, loading ? '加载中…' : greeting),
    createElement(
      'p',
      { style: { color: 'var(--dsw-alias-text-tertiary)', fontSize: '12px' } },
      'server 端由 TypeScript 编写（tsc 编译），client 端由 TypeScript 编写（构建时编译）。',
    ),
  )
}
