/**
 * dsh-mermaid-render — system-prompt 注入文案与开关（TypeScript 源码，issue #194）。
 *
 * 诉求：安装即让模型知道「本环境原生支持 mermaid 图表渲染」——用户不写出
 * "mermaid" 字样（例如只说「画一个登录流程图」）时，模型也应主动输出
 * \`\`\`mermaid 代码块，而不是用 ASCII 图或建议用户自己画。
 *
 * 设计约束：
 *  - **简短**：整段 \`PROMPT_TEXT\` 有硬性长度上限 \`PROMPT_MAX_CHARS\`（单测断言），
 *    避免每轮都吃上下文预算；
 *  - **只增不改**：以独立 section 名注册（\`dsh-mermaid-render\`），不覆盖也不改写
 *    用户自定义系统提示词与其它插件的 section（宿主按 name 去重、按 order 拼接）；
 *  - **可关**：\`injectPrompt: false\` 时不注册任何 section（默认开）；
 *  - **无变量**：文案内不得出现 \`{{变量}}\`——宿主 \`renderPrompt\` 对变量引用是严格的，
 *    未注册的变量会抛错（单测断言）。
 *
 * 本文件编译为 lib/prompt.js（产物必须提交，CI 只跑产物、不跑构建）。
 */

/** 插件配置（issue #194 开关；与 src/index.ts 的 MermaidRenderConfig 一致）。 */
export interface PromptConfig {
  /**
   * 是否注入 mermaid 能力说明（默认 **开**）。
   * 仅显式 \`false\` 关闭；非布尔值按默认（开）处理，避免配错就静默丢掉能力。
   */
  injectPrompt?: boolean
}

/** section 名：全局唯一，避开 dsh-think-zh / dsh-my-memory / 宿主保留名。 */
export const PROMPT_SECTION_NAME = 'dsh-mermaid-render'

/**
 * section 顺序：宿主按 order 升序拼接（部署 persona = 0，策略/工具段 ≥ 500）。
 * 取 100 —— 排在用户自定义 persona **之后**（不抢它的位置），又在策略与工具段之前，
 * 保证模型在决定「怎么表达」时已经读到这条能力说明。
 */
export const PROMPT_SECTION_ORDER = 100

/** 注入文本长度上限（字符）。单测钉住，防止文案膨胀成上下文税。 */
export const PROMPT_MAX_CHARS = 500

/** 注入到每次系统提示词组装的中文能力说明（默认注入）。 */
export const PROMPT_TEXT = `## Mermaid 图表（本环境原生支持）

本环境已内置 mermaid 渲染，无需工具或外部图片服务：需要画流程图、时序图、状态图、类图、ER 图、甘特图或饼图时，直接输出 \`\`\`mermaid 代码块。

写法要点：
- 围栏语言标识必须写 \`mermaid\`；用图类型关键字开头：flowchart TD / sequenceDiagram / stateDiagram-v2 / classDiagram / erDiagram / gantt / pie；
- 节点标签含空格或 ()[]{}:;,<> 等特殊字符时用双引号包裹，如 A["提交订单 (v2)"]；
- 不要在代码块内嵌套 markdown（不加粗、不放链接和列表）；
- 渲染失败时页面会原样显示代码块并给出错误提示，据此修正后重新输出即可。`

/** 开关判定：仅显式 false 关闭（默认开；非法值按默认开）。 */
export function shouldInjectPrompt(config: PromptConfig | undefined): boolean {
  return config?.injectPrompt !== false
}

/** 待注册的 section；开关关闭时返回 null（调用方据此跳过注册）。 */
export function createPromptSection(
  config: PromptConfig | undefined,
): { name: string; order: number; text: string } | null {
  if (!shouldInjectPrompt(config)) return null
  return { name: PROMPT_SECTION_NAME, order: PROMPT_SECTION_ORDER, text: PROMPT_TEXT }
}
