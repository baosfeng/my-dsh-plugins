/**
 * dsh-think-zh-expand — client 端入口（TypeScript 源码，单文件）。
 *
 * 构建流程：`tsc -p tsconfig.client.json` 把本文件编译为 CommonJS 单文件
 * （lib/.client-build/index.js），scripts/build.mjs 再注入
 * lib/client.src.js 模板的 __CLIENT_BUNDLE__ 占位符，写出
 * lib/client.js（DSH 实际服务的 __ModuleLoader__ bundle）。
 *
 * 约束：client 端 TS 源码为单文件（无运行时相对 import——编译产物内联进
 * factory 作用域后，require 只认识 DSH 运行时注入的模块，如 react）。
 *
 * 功能 2：思考（reasoning）内容默认展开显示。
 * 功能 3：界面标签中文化。
 */
import { createElement, useState, type ReactNode } from 'react'

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

// ── MarkdownView（dsh-md-render 跨插件提供）────────────────────────
// dsh-md-render 在 __ModuleLoader__ factory 运行前已加载，
// factory 内通过 require('dsh-md-render') 获取。
// 此处声明模块级变量，赋值由 factory 作用域的 require 完成。
// 注意：模板（client.src.js）中已有 `const MarkdownView = require('dsh-md-render').MarkdownView`，
// 所以此处不重复赋值，只声明类型让 tsc 知道其存在。
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
  const [expanded, setExpanded] = useState(true)
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
    // 思考内容走统一 Markdown 渲染（dsh-md-render 的 MarkdownView）
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

// ── 界面中文化词表 ─────────────────────────────────────────────────

const ZH_TABLE: Record<string, string> = {
  Thinking: '思考',
  'Tool Call': '工具调用',
  'Tool calls': '工具调用',
  'Tool call': '工具调用',
  'Tool call only': '仅工具调用',
  Tools: '工具',
  'No content': '无内容',
  'Tools Updated': '工具已更新',
  Duration: '用时',
  'Use actual duration': '使用实际耗时',
  'Use equal-width operations': '使用等宽操作',
  Turns: '轮次',
  'Expand turns': '展开轮次',
  'Collapse turns': '收起轮次',
  Calls: '调用',
  'Expand calls': '展开调用',
  'Collapse calls': '收起调用',
  'Load earlier history': '加载更早历史',
  'Loading earlier history…': '正在加载更早历史…',
  'Loading earlier history': '正在加载更早历史',
  ASSISTANT: '助手',
  TOOL: '工具',
  USER: '用户',
  'Session log': '会话日志',
  'Cordis Plugin': 'Cordis 插件',
  'System prompt': '系统提示',
  Messages: '消息',
  Files: '文件',
  'Full access': '完全访问',
  'Enable Full access': '启用完全访问',
  Cancel: '取消',
}

const ZH_PATTERNS: Array<[RegExp, string]> = [
  [/^Turn (\d+)$/, '第 $1 轮'],
  [/^Tool call (.+)$/, '工具调用 $1'],
  [/^Input ([\d.]+) tok · Output ([\d.]+) tok$/, '输入 $1 tok · 输出 $2 tok'],
  [/^LLM (.+)$/, '模型调用 $1'],
]

const ZH_SKIP_TAGS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'KBD', 'SAMP'])

const CARD_TITLE_ZH: Record<string, string> = {
  Search: '搜索',
  Read: '读取',
  Bash: '命令行',
  Write: '写入',
  Edit: '编辑',
  Code: '代码',
  Inspect: '检查',
  'Run Cordis Plugin': '运行 Cordis 插件',
  'Stop Cordis Plugin': '停止 Cordis 插件',
  'Remove Cordis Plugin': '移除 Cordis 插件',
}

const TOOL_NAME_ZH: Record<string, string> = {
  web_search: '网络搜索',
  bash: '命令行',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  glob: '搜索文件',
  grep: '搜索内容',
  read_image: '读取图片',
  skill: '技能',
  workflow: '工作流',
  subagent: '子代理',
  subagent_fork: '子代理（继承）',
  todo_write: '任务清单',
  ask_user_question: '询问用户',
  exit_plan_mode: '退出计划模式',
  create_goal: '创建目标',
  get_goal: '查看目标',
  update_goal: '更新目标',
  job_list: '任务列表',
  job_output: '任务输出',
  job_kill: '终止任务',
  list_agents: '代理列表',
  send_message: '发送消息',
  interrupt_agent: '中断代理',
  cordis_define: '定义插件',
  cordis_run: '运行插件',
  cordis_stop: '停止插件',
  cordis_undefine: '删除插件',
  cordis_inspect_list: '查看提供者',
  cordis_inspect_query: '查询提供者',
  cordis_inspect_self: '查看自身',
  'mcp__codebase-memory__check_index_coverage': '检查索引覆盖',
  'mcp__codebase-memory__delete_project': '删除项目',
  'mcp__codebase-memory__detect_changes': '变更影响分析',
  'mcp__codebase-memory__get_architecture': '架构总览',
  'mcp__codebase-memory__get_code_snippet': '代码片段',
  'mcp__codebase-memory__get_graph_schema': '图结构',
  'mcp__codebase-memory__index_repository': '索引仓库',
  'mcp__codebase-memory__index_status': '索引状态',
  'mcp__codebase-memory__ingest_traces': '导入运行时轨迹',
  'mcp__codebase-memory__list_projects': '项目列表',
  'mcp__codebase-memory__manage_adr': '架构决策记录',
  'mcp__codebase-memory__query_graph': '图查询',
  'mcp__codebase-memory__search_code': '代码搜索',
  'mcp__codebase-memory__search_graph': '图搜索',
  'mcp__codebase-memory__trace_path': '调用路径追踪',
  agent_teams_add_member: '添加成员',
  agent_teams_claim_task: '认领任务',
  agent_teams_create: '创建团队',
  agent_teams_create_task: '创建任务',
  agent_teams_delete: '删除团队',
  agent_teams_reassign_task: '重新指派任务',
  agent_teams_remove_member: '移除成员',
  agent_teams_send_message: '团队消息',
  agent_teams_status: '团队状态',
  agent_teams_update_task: '更新任务',
  vision_toolkit_activate: '激活视觉工具',
}

const TOOL_DESC_ZH: Record<string, string> = {
  web_search: '搜索网络获取最新信息。',
  bash: '执行命令并返回输出（可设置工作目录、超时）。',
  read: '读取 UTF-8 文本文件并返回带行号的内容。',
  write: '创建或完整替换一个 UTF-8 文本文件。',
  edit: '对现有文本文件做精确的局部替换修改。',
  glob: '按路径模式查找文件，包含隐藏与忽略文件。',
  grep: '用正则搜索文件内容并返回匹配行。',
  read_image: '读取图片文件并返回图片本身。',
  skill: '加载指定技能（skill）的完整指令。',
  workflow: '编写脚本编排多个子代理，并行扇出执行。',
  subagent: '把独立任务委托给后台子代理。',
  subagent_fork: '把任务委托给继承当前对话上下文的子代理。',
  todo_write: '记录并更新当前工作的结构化任务清单。',
  ask_user_question: '需要确认、选择或补充信息时向用户提问。',
  exit_plan_mode: '呈现完整计划并退出计划模式。',
  create_goal: '创建持久化的同会话完成目标。',
  get_goal: '读取当前目标的准确 id 与状态。',
  update_goal: '更新目标的执行状态、暂停或恢复。',
  job_list: '列出当前启动的后台任务。',
  job_output: '读取后台任务的输出。',
  job_kill: '请求终止运行中的后台任务。',
  list_agents: '按持久 id 列出可续接的后台子代理。',
  send_message: '向后台子代理发送消息，继续其同一对话。',
  interrupt_agent: '请求中断后台代理的当前轮次。',
  cordis_define: '定义新的不可变 Cordis 插件包（不运行）。',
  cordis_run: '启动或更新 Cordis 插件包。',
  cordis_stop: '停止当前 Cordis 插件并保留定义。',
  cordis_undefine: '永久删除 Cordis 插件及其所有包。',
  cordis_inspect_list: '列出当前已知的检查提供者。',
  cordis_inspect_query: '执行检查提供者的只读查询。',
  cordis_inspect_self: '查看当前会话的插件、包与诊断。',
  'mcp__codebase-memory__check_index_coverage': '检查文件的索引覆盖情况。',
  'mcp__codebase-memory__delete_project': '把项目从索引中删除。',
  'mcp__codebase-memory__detect_changes': '把 git 变更映射为影响半径。',
  'mcp__codebase-memory__get_architecture': '获取项目高层架构总览。',
  'mcp__codebase-memory__get_code_snippet': '读取函数或类的源码。',
  'mcp__codebase-memory__get_graph_schema': '获取知识图谱的节点与边类型。',
  'mcp__codebase-memory__index_repository': '把仓库索引进知识图谱。',
  'mcp__codebase-memory__index_status': '查看项目索引状态与覆盖报告。',
  'mcp__codebase-memory__ingest_traces': '导入运行时调用轨迹。',
  'mcp__codebase-memory__list_projects': '列出已索引的项目。',
  'mcp__codebase-memory__manage_adr': '创建或更新架构决策记录。',
  'mcp__codebase-memory__query_graph': '执行 Cypher 图查询。',
  'mcp__codebase-memory__search_code': '图增强的代码搜索。',
  'mcp__codebase-memory__search_graph': '按关键词、正则或语义搜索代码图谱。',
  'mcp__codebase-memory__trace_path': '追踪调用链、数据流与跨服务路径。',
  agent_teams_add_member: '向团队添加可续命的成员。',
  agent_teams_claim_task: '为团队成员认领一个就绪任务。',
  agent_teams_create: '创建多代理团队，你成为队长。',
  agent_teams_create_task: '在团队创建任务并关联依赖。',
  agent_teams_delete: '删除团队：中断成员并移除状态。',
  agent_teams_reassign_task: '重试、重新指派任务或由队长接管。',
  agent_teams_remove_member: '安全移除成员并回收任务。',
  agent_teams_send_message: '给队长或团队成员发送消息。',
  agent_teams_status: '查看团队快照：成员与任务状态。',
  agent_teams_update_task: '更新任务状态或产出摘要。',
  vision_toolkit_activate: '激活视觉工具集。',
}

// ── 界面中文化 DOM 精准替换逻辑 ────────────────────────────────────

function inSkipped(element: Element): boolean {
  let node: Element | null = element
  while (node && node.nodeType === 1) {
    if (ZH_SKIP_TAGS.has(node.nodeName)) return true
    node = node.parentElement
  }
  return false
}

function inToolCallRow(element: Element): boolean {
  let node: Element | null = element
  while (node && node.nodeType === 1) {
    if (node.hasAttribute && node.hasAttribute('data-chat-call-id')) return true
    node = node.parentElement
  }
  return false
}

function inToolCatalog(element: Element): boolean {
  let node: Element | null = element
  while (node && node.nodeType === 1) {
    const cls = (node as HTMLElement).className
    if (typeof cls === 'string' && cls.indexOf('toolCatalog') !== -1) return true
    node = node.parentElement
  }
  return false
}

function catalogItemOf(element: Element): Element | null {
  let node: Element | null = element
  while (node && node.nodeType === 1) {
    const cls = (node as HTMLElement).className
    if (typeof cls === 'string' && cls.indexOf('toolCatalogItem') !== -1) return node
    node = node.parentElement
  }
  return null
}

function localizeCatalogDesc(item: Element, zhDesc: string): void {
  const descEls = item.querySelectorAll('[class*="toolCatalogDescription"], [class*="toolCatalogFullDescription"]')
  for (const el of descEls) {
    if (el.firstChild && el.firstChild.nodeType === 3) {
      ;(el.firstChild as Text).nodeValue = zhDesc
    }
  }
}

function localizeParamsJsonLabel(item: Element): void {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
  let t: Text | null
  while ((t = walker.nextNode() as Text | null) !== null) {
    const v = String(t.nodeValue)
    if (v.indexOf(' parameters JSON') !== -1) {
      t.nodeValue = v.replace(' parameters JSON', ' 参数 JSON')
    }
  }
}

function localizeCatalogItem(item: Element, localizedItems: WeakSet<Element>): void {
  if (localizedItems.has(item)) return
  localizedItems.add(item)
  const nameEl = item.querySelector('[class*="toolCatalogName"]')
  if (!nameEl || !nameEl.firstChild || nameEl.firstChild.nodeType !== 3) return
  const nameNode = nameEl.firstChild as Text
  const en = String(nameNode.nodeValue).trim()
  const zhName = TOOL_NAME_ZH[en]
  if (zhName === undefined) return
  nameNode.nodeValue = String(nameNode.nodeValue).replace(en, zhName)
  const zhDesc = TOOL_DESC_ZH[en]
  if (zhDesc !== undefined) localizeCatalogDesc(item, zhDesc)
  localizeParamsJsonLabel(item)
}

function tryCardTitle(textNode: Text, trimmed: string): boolean {
  const cardTitle = CARD_TITLE_ZH[trimmed]
  if (cardTitle === undefined) return false
  const nv = textNode.nodeValue
  if (nv !== null) textNode.nodeValue = nv.replace(trimmed, cardTitle)
  return true
}

function trySummaryPrefix(textNode: Text, trimmed: string): boolean {
  const m = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_]*) · /)
  if (!m || TOOL_NAME_ZH[m[1]] === undefined) return false
  const nv = textNode.nodeValue
  if (nv !== null) textNode.nodeValue = nv.replace(m[1], TOOL_NAME_ZH[m[1]])
  return true
}

function tryExactText(textNode: Text, trimmed: string): boolean {
  const exact = ZH_TABLE[trimmed]
  if (exact === undefined) return false
  const nv = textNode.nodeValue
  if (nv !== null) textNode.nodeValue = nv.replace(trimmed, exact)
  return true
}

function tryPatternText(textNode: Text, trimmed: string): boolean {
  for (const [pattern, replacement] of ZH_PATTERNS) {
    if (pattern.test(trimmed)) {
      const nv = textNode.nodeValue
      if (nv !== null) textNode.nodeValue = nv.replace(pattern, replacement)
      return true
    }
  }
  return false
}

function translateToolCallText(textNode: Text, trimmed: string): boolean {
  if (tryCardTitle(textNode, trimmed)) return true
  return trySummaryPrefix(textNode, trimmed)
}

function translateTextNode(textNode: Text, localizedItems: WeakSet<Element>): void {
  const raw = textNode.nodeValue
  if (typeof raw !== 'string' || raw === '') return
  const trimmed = raw.trim()
  if (trimmed === '') return
  const parent = textNode.parentElement
  if (!parent || inSkipped(parent)) return
  if (inToolCallRow(parent)) {
    translateToolCallText(textNode, trimmed)
    return
  }
  if (inToolCatalog(parent)) {
    const item = catalogItemOf(parent)
    if (item) {
      localizeCatalogItem(item, localizedItems)
      return
    }
  }
  if (tryExactText(textNode, trimmed)) return
  tryPatternText(textNode, trimmed)
}

function installUiLocalize(): () => void {
  if (typeof document === 'undefined' || document === null || typeof MutationObserver === 'undefined') return () => {}

  const localizedItems = new WeakSet<Element>()

  const scan = (root: Element | Document) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const hits: Text[] = []
    let node: Text | null
    while ((node = walker.nextNode() as Text | null) !== null) hits.push(node)
    for (const hit of hits) translateTextNode(hit, localizedItems)
  }

  scan(document.body)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target.nodeType === 3) {
        translateTextNode(mutation.target as Text, localizedItems)
      } else if (mutation.type === 'childList') {
        for (const added of mutation.addedNodes) {
          if (added.nodeType === 1) scan(added as Element)
          else if (added.nodeType === 3) translateTextNode(added as Text, localizedItems)
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}

// ── 纯函数导出（供纯 Node 测试断言映射，不依赖 DOM）─────────────────

/** 工具名中文化映射。 */
export function zhToolName(name: string): string | null {
  return TOOL_NAME_ZH[name] ?? null
}

/** 工具描述中文化映射。 */
export function zhToolDesc(name: string): string | null {
  return TOOL_DESC_ZH[name] ?? null
}

/** 卡片标题中文化映射。 */
export function zhCardTitle(title: string): string | null {
  return CARD_TITLE_ZH[title] ?? null
}

/** others 卡片摘要 `工具名 · …` 的工具名前缀替换。 */
export function zhCardSummary(text: string): string | null {
  const m = String(text).match(/^([a-zA-Z][a-zA-Z0-9_]*) · /)
  if (m && TOOL_NAME_ZH[m[1]] !== undefined) return String(text).replace(m[1], TOOL_NAME_ZH[m[1]])
  return null
}

// ── 共享图标声明（构建时由 build.mjs 从 dsh-shared 注入到 factory 作用域）──
declare const icon: Record<string, (size?: number) => unknown>
declare const fileIconByExt: (ext: string, size?: number) => unknown

// ── Factory 作用域变量声明 ─────────────────────────────────────────
// client 端编译产物将内联进 __ModuleLoader__ factory 作用域，该作用域
// 由模板（lib/client.src.js）声明了 var module / var exports / require。
// 此处声明同名变量让 tsc 不报错。
declare const module: { exports: Record<string, unknown> }

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
  // Inject the shared stylesheet once (torn down with the fiber).
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof (document as Document).head === 'undefined')
      return () => {}
    const style = (document as Document).createElement('style')
    style.setAttribute('data-dsh-think-zh-expand', 'styles')
    style.textContent = STYLES
    ;(document as Document).head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-think-zh-expand: styles')

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

  // UI 标签中文化
  ctx.effect(() => installUiLocalize(), 'dsh-think-zh-expand: ui localization')
}
