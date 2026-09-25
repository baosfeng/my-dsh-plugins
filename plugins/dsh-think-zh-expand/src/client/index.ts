/**
 * dsh-think-zh-expand — client 端入口（TypeScript 源码）。
 *
 * 构建：`tsc -p tsconfig.client.json` 编译本文件与设置页 part
 * （src/client/settings.ts）为 CommonJS，scripts/build.mjs 注入 lib/client.src.js
 * 模板的占位符后写出 lib/client.js（DSH 实际服务的 __ModuleLoader__ bundle）。
 * 约束：产物内联进 factory 作用域，故源码不得有运行时相对 import
 * （require 只认识宿主注入的模块，如 react）。
 *
 * 功能 2：思考（reasoning）内容默认展开显示（配置项 defaultExpanded，#355）。
 * 功能 3：宿主设置面板（#383，视图见 settings.ts）。
 *
 * issue #428：界面硬编码英文的中文化词表已移除 —— 官方 zh locale 已是文案真源
 * （ui-chat/src/client/locale.ts 的 message.think、ui-conversation/src/client/locales.ts
 * 的「工具调用」），本插件再扫 DOM 改写文本属重复实现且会误伤宿主文案。
 */
import { createElement, useState, type ReactNode } from 'react'

// ── 配置项 defaultExpanded（issue #355 / #383）：展开初值可配置 ──────────
// owner 决策（否决 PR #356 的「默认折叠」反转）：默认仍 true——「思考默认展开」
// 是本插件的产品定位（README / description / 图片 alt 已固化），显式设 false 才
// 折叠。client 不能访问 ctx.config（Cordis inject 限制），故经 host 半的配置路由
// GET /think-zh-expand/api/config 拉取（设置页保存走同一地址的 PUT）。
// 回退契约（防回归）：配置缺失 / 值非布尔 / 拉取失败 → 一律 true，绝不变成折叠。

/** 配置读取地址（host 半边 src/index.ts 的 CONFIG_ROUTE_PREFIX + /config）。 */
const CONFIG_URL = '/think-zh-expand/api/config'

/** 展开初值默认值：true = 默认展开（既有行为）。 */
export const DEFAULT_EXPANDED = true

/** 模块级生效值：渲染时作为 useState 初值读取。 */
let defaultExpanded = DEFAULT_EXPANDED

/** 配置快照 → 生效值：只有布尔 defaultExpanded 生效，其余（含 null/字符串）回退 true。 */
export function resolveDefaultExpanded(config?: Record<string, unknown> | null): boolean {
  if (config === null || config === undefined) return DEFAULT_EXPANDED
  const value = config.defaultExpanded
  return typeof value === 'boolean' ? value : DEFAULT_EXPANDED
}

/** 应用一份配置快照，返回生效值。 */
export function setDefaultExpanded(config?: Record<string, unknown> | null): boolean {
  defaultExpanded = resolveDefaultExpanded(config)
  return defaultExpanded
}

/** 当前生效的展开初值。 */
export function getDefaultExpanded(): boolean {
  return defaultExpanded
}

/**
 * 异步拉取 host 侧配置并应用（client apply 时调用一次）。
 * 失败（无 fetch / 网络错误 / ok!==true / value 非对象）一律保持默认展开。
 */
export function initConfigFromServer(): Promise<void> {
  if (typeof fetch !== 'function') return Promise.resolve()
  return fetch(CONFIG_URL)
    .then((res) => res.json())
    .then((body: unknown) => {
      if (body === null || typeof body !== 'object') return
      const payload = body as { ok?: boolean; value?: unknown }
      if (payload.ok !== true) return
      if (payload.value === null || typeof payload.value !== 'object') return
      setDefaultExpanded(payload.value as Record<string, unknown>)
    })
    .catch(() => {
      // 服务不可用：保持默认展开，不影响渲染能力。
    })
}

// ── DSH 运行时类型（client 端最小契约）──────────────────────────────

/** client 端 Context（cordis Context 最小契约 + slots 服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  slots: SlotsService
}

/** slots 服务（渲染器注入/注册）。 */
interface SlotsService {
  inject(name: string, callback: () => () => void): () => void
  register(
    desc: { name: string; key: string; priority: number; registrant: string },
    renderer: (props: Record<string, unknown>) => ReactNode,
  ): () => void
}

/** assistant-step 节点数据。 */
interface AssistantStepData {
  blocks: Array<{ kind: string; text?: string; attachment?: unknown }>
  status?: string
}

/** assistant-step 节点。 */
interface AssistantStepNode {
  data?: AssistantStepData
}

/** renderMessageImages 函数签名。 */
interface RenderMessageImages {
  (options: { images: Array<{ attachment: unknown }>; align: string }): ReactNode
}

// ── MarkdownView（宿主官方 baseline 组件，issue #428）───────────────
// 渲染内核由模板（client.src.js）在 factory 作用域解析为平台 seed 模块
// @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText（官方推荐路线）；
// 不再跨插件 require 另一个特性插件提供的渲染器。此处只声明类型，赋值在模板里完成。
declare const MarkdownView: (props: { text: string }) => ReactNode

// ── 官方图标（issue #73 对齐官方 ReasoningRow）────────────────────

/** 官方 IconChevronDownOutline14（14×14，fill=currentColor） */
function chevronDownIcon({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return createElement(
    'svg',
    { width: size, height: size, className, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('path', {
      d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
      fill: 'currentColor',
    }),
  )
}

/** 官方 IconThinkOutline14（14×14，fill=currentColor）：收起态思考图标。 */
function thinkIcon({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return createElement(
    'svg',
    { width: size, height: size, className, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('path', {
      d: 'M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z',
      fill: 'currentColor',
    }),
    createElement('path', {
      fillRule: 'evenodd',
      clipRule: 'evenodd',
      d: 'M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.9734 11.6836 6.16199 11.8397 6.35725C12.2548 5.94218 12.3869 5.06315 11.9071 3.73034C11.7688 3.34628 11.5841 2.9433 11.7147 2.15998Z',
      fill: 'currentColor',
    }),
  )
}

// ── 控制标签剥离 ───────────────────────────────────────────────────
const CONTROL_TAG_RE = /<\s*\/?\s*(?:think|review|answer)\s*>/gi

function stripControlTags(text: string): string {
  if (typeof text !== 'string' || text === '') return text
  return text.replace(CONTROL_TAG_RE, '')
}

// ── 思考块：默认展开，可点击收起，流式中强制展开 ───────────────────
interface ThinkBlockProps {
  text: string
  running: boolean
}

function ThinkBlock({ text, running }: ThinkBlockProps): ReactNode {
  const cleanText = stripControlTags(text)
  // issue #355：初值来自配置项 defaultExpanded（缺省 / 取不到配置 → true）。
  const [expanded, setExpanded] = useState(defaultExpanded)
  // 流式生成中强制展开。初值 true 时该条件恒成立（正是 PR #356 指出的冗余），
  // 但在 defaultExpanded:false 下它给出「流式中自动展开、完成后收起」的语义，
  // 故保留 `|| running`（外部贡献者的技术论证成立，被本方案采纳）。
  const open = expanded || running
  const firstLine = (t: string): string => {
    const nl = t.indexOf('\n')
    return nl === -1 ? t : t.slice(0, nl)
  }
  return createElement(
    'div',
    { className: 'dsh-think-zh-expand-think', 'data-variant': 'think', 'data-state': running ? 'running' : 'ok' },
    createElement(
      'div',
      {
        className: 'dsh-think-zh-expand-think-head',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        onClick: () => setExpanded((v: boolean) => !v),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v: boolean) => !v)
          }
        },
      },
      // leading：展开态只显示 chevron；收起态显示 Think 图标 + chevron
      createElement(
        'span',
        { className: 'dsh-think-zh-expand-think-leading' },
        open
          ? createElement(
              'span',
              { className: 'dsh-think-zh-expand-think-chevron' },
              createElement(chevronDownIcon as unknown as (props: { size?: number }) => ReactNode, { size: 14 }),
            )
          : [
              createElement(
                'span',
                { className: 'dsh-think-zh-expand-think-icon' },
                createElement(thinkIcon as unknown as (props: { size?: number }) => ReactNode, { size: 14 }),
              ),
              createElement(
                'span',
                { className: 'dsh-think-zh-expand-think-chevron dsh-think-zh-expand-think-chevron-hover' },
                createElement(chevronDownIcon as unknown as (props: { size?: number }) => ReactNode, { size: 14 }),
              ),
            ],
      ),
      createElement('span', { className: 'dsh-think-zh-expand-think-title' }, '思考'),
      !open && [
        createElement('span', { className: 'dsh-think-zh-expand-think-separator', 'aria-hidden': 'true' }),
        createElement('span', { className: 'dsh-think-zh-expand-think-summary' }, firstLine(cleanText)),
      ],
    ),
    // 思考内容走统一 Markdown 渲染（宿主官方 baseline MarkdownText）
    open &&
      createElement(
        'div',
        { className: 'dsh-think-zh-expand-think-body' },
        createElement(MarkdownView, { text: cleanText }),
      ),
  )
}

// ── 图片块：把相邻 image 块收集为一组 ──────────────────────────────
function imageGroupEnd(blocks: AssistantStepData['blocks'], i: number): number {
  let end = i
  while (end + 1 < blocks.length) {
    const next = blocks[end + 1]
    if (!next || next.kind !== 'image') break
    end += 1
  }
  return end
}

/** 渲染单个 block；不认识的块返回 null。 */
function renderBlock(
  blocks: AssistantStepData['blocks'],
  i: number,
  streaming: boolean,
  last: number,
  renderMessageImages?: RenderMessageImages,
): ReactNode {
  const block = blocks[i]
  if (block.kind === 'text' && typeof block.text === 'string') {
    return createElement(MarkdownView, { key: 't' + i, text: stripControlTags(block.text) })
  }
  if (block.kind === 'reasoning' && typeof block.text === 'string') {
    return createElement(ThinkBlock, {
      key: 'r' + i,
      text: block.text,
      running: streaming && i === last,
    })
  }
  if (block.kind === 'image' && typeof renderMessageImages === 'function') {
    const end = imageGroupEnd(blocks, i)
    const images = blocks.slice(i, end + 1).map((b) => ({ attachment: b.attachment }))
    return createElement('div', { key: 'img' + i }, renderMessageImages({ images, align: 'start' }))
  }
  return null
}

/** 渲染 blocks 全列表。 */
function renderBlocks(
  blocks: AssistantStepData['blocks'],
  streaming: boolean,
  renderMessageImages?: RenderMessageImages,
): ReactNode[] {
  const last = blocks.length - 1
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (!block) continue
    const el = renderBlock(blocks, i, streaming, last, renderMessageImages)
    if (!el) continue
    if (block.kind === 'image') i = imageGroupEnd(blocks, i)
    rendered.push(el)
  }
  return rendered
}

// ── assistant-step 节点渲染器 ──────────────────────────────────────
interface AssistantStepViewProps {
  node: AssistantStepNode
  renderMessageImages?: RenderMessageImages
}

function AssistantStepView({ node, renderMessageImages }: AssistantStepViewProps): ReactNode {
  const data = node && node.data ? node.data : null
  if (!data || !Array.isArray(data.blocks)) return null
  const streaming = data.status === 'running'
  const interrupted = data.status === 'interrupted'
  const rendered = renderBlocks(data.blocks, streaming, renderMessageImages)
  if (interrupted) {
    rendered.push(createElement('span', { key: 'stopped', className: 'dsh-think-zh-expand-stopped' }, '已停止'))
  }
  return createElement(
    'div',
    { className: 'dsh-think-zh-expand-assistant', 'data-streaming': streaming || undefined },
    createElement('div', { className: 'dsh-think-zh-expand-assistant-body' }, rendered),
  )
}

// ── 共享图标声明（构建时由 build.mjs 从 dsh-shared 注入到 factory 作用域）──
declare const icon: Record<string, (size?: number) => unknown>
declare const fileIconByExt: (ext: string, size?: number) => unknown

// ── Factory 作用域变量声明 ─────────────────────────────────────────
// client 端编译产物将内联进 __ModuleLoader__ factory 作用域，该作用域
// 由模板（lib/client.src.js）声明了 var module / var exports / require。
// 此处声明同名变量让 tsc 不报错。
declare const module: { exports: Record<string, unknown> }

/** 共享样式注入（dsh-shared/client-parts/style-tag.part.js，构建期拼接；issue #186 P2）。 */
declare function installStyles(
  ctx: { effect: (fn: () => void | (() => void), label?: string) => void },
  attr: string,
  css: string,
  label: string,
): void

// ── 样式 ───────────────────────────────────────────────────────────
const STYLES = `
.dsh-think-zh-expand-assistant{display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:16px;line-height:28px}
.dsh-think-zh-expand-assistant-body{display:flex;flex-direction:column;gap:16px}
.dsh-think-zh-expand-think{display:flex;flex-direction:column;width:100%;min-width:0}
.dsh-think-zh-expand-think-head{position:relative;overflow:hidden;display:flex;align-items:center;height:24px;min-width:0;cursor:pointer;user-select:none}
.dsh-think-zh-expand-think-leading{position:relative;flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;padding:0;border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-think-zh-expand-think-icon{display:inline-flex;opacity:1;transition:opacity .1s ease}
.dsh-think-zh-expand-think-head:hover .dsh-think-zh-expand-think-icon{opacity:0}
.dsh-think-zh-expand-think-chevron{display:inline-flex;color:var(--dsw-alias-label-secondary)}
.dsh-think-zh-expand-think-chevron-hover{position:absolute;top:0;right:0;bottom:0;left:0;margin:auto;opacity:0;transition:opacity .1s ease}
.dsh-think-zh-expand-think-head:hover .dsh-think-zh-expand-think-chevron-hover{opacity:1}
.dsh-think-zh-expand-think-title{flex:none;font-size:14px;line-height:24px;color:var(--dsw-alias-label-secondary)}
.dsh-think-zh-expand-think-separator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}
.dsh-think-zh-expand-think-summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}
.dsh-think-zh-expand-think-body{white-space:pre-wrap;word-break:break-word;padding:4px 0 4px 22px;font-size:14px;line-height:24px;color:var(--dsw-alias-label-tertiary)}
.dsh-think-zh-expand-stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:6px;align-self:flex-start;padding:0 6px;font-size:11px;line-height:18px}
    `

// ── 插件入口 ───────────────────────────────────────────────────────

// 注：编译产物内联进 factory 作用域后，module.exports 已在模板中声明。
// 此处直接使用 module.exports（模板顶部已声明 var module = { exports: {} }）。
const _exports = module.exports as Record<string, unknown>
_exports.inject = ['slots']

_exports.apply = function apply(ctx: ClientContext): void {
  // issue #355：先按 host 侧配置初始化展开初值（异步；失败保持默认 true）。
  void initConfigFromServer()

  // 样式注入走共享实现（issue #186 P2）：与同仓其它 client 插件
  // 同一份「无条件注入 + 随 fiber teardown 卸载」逻辑（style-tag.part.js）。
  installStyles(ctx, 'data-dsh-think-zh-expand', STYLES, 'dsh-think-zh-expand: styles')

  // Replace the built-in assistant-step renderer
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.chat.node', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.node',
            key: 'assistant-step',
            priority: -1,
            registrant: 'dsh-think-zh-expand',
          },
          (props: Record<string, unknown>) =>
            createElement(AssistantStepView, props as unknown as AssistantStepViewProps),
        ),
      ),
    'dsh-think-zh-expand: assistant-step renderer',
  )

  // 设置页签（issue #383）：注册「设置 → 插件 → 思考增强」（part 视图与注册
  // 逻辑在 src/client/settings.ts，构建期由 build.mjs 注入同一 factory 作用域）。
  attachSettingsTab(ctx)
}
