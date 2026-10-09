/**
 * dsh-md-render — system-prompt 注入（mermaid 能力声明）。
 *
 * issue #463 决策：合并后**只保留 mermaid 能力声明**这一条 section。
 * 中文思考指令（原 dsh-think-zh-expand 的 `dsh-think-zh` section）**不迁入**——
 * 它由 dsh-my-memory 的「全局提示词」提供（用户偏好类指令的正确归属）。
 * 因此本插件注册的 section 数恒为 0 或 1（`injectPrompt: false` → 0）。
 *
 * 设计约束：
 *  - **简短**：`PROMPT_TEXT` 有硬性长度上限 `PROMPT_MAX_CHARS`（单测断言），
 *    避免每轮都吃上下文预算；
 *  - **只增不改**：独立 section 名（`dsh-mermaid-render`，与旧包同名同 order，
 *    保证升级前后注入位置与去重语义完全一致），不覆盖也不改写用户自定义
 *    persona 与其它插件的 section；
 *  - **可关**：`injectPrompt: false` 时不注册任何 section（默认开）；
 *  - **无变量**：文案内不得出现 `{{变量}}`——宿主 `renderPrompt` 对变量引用是
 *    严格的，未注册的变量会抛错（单测断言）。
 *
 * 本文件编译为 lib/prompt.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
/** section 名：与合并前的 dsh-mermaid-render 完全一致（宿主按 name 去重）。 */
export const PROMPT_SECTION_NAME = 'dsh-mermaid-render';
/**
 * section 顺序：宿主按 order 升序拼接（部署 persona = 0，策略/工具段 ≥ 500）。
 * 取 100 —— 排在用户自定义 persona **之后**（不抢它的位置），又在策略与工具段之前。
 */
export const PROMPT_SECTION_ORDER = 100;
/** 注入文本长度上限（字符）。单测钉住，防止文案膨胀成上下文税。 */
export const PROMPT_MAX_CHARS = 500;
/** 注入到每次系统提示词组装的中文能力说明（默认注入）。 */
export const PROMPT_TEXT = `## Mermaid 图表（本环境原生支持）

本环境已内置 mermaid 渲染，无需工具或外部图片服务：需要画流程图、时序图、状态图、类图、ER 图、甘特图或饼图时，直接输出 \`\`\`mermaid 代码块。

写法要点：
- 围栏语言标识必须写 \`mermaid\`；用图类型关键字开头：flowchart TD / sequenceDiagram / stateDiagram-v2 / classDiagram / erDiagram / gantt / pie；
- 节点标签含空格或 ()[]{}:;,<> 等特殊字符时用双引号包裹，如 A["提交订单 (v2)"]；
- 不要在代码块内嵌套 markdown（不加粗、不放链接和列表）；
- 渲染失败时页面会原样显示代码块并给出错误提示，据此修正后重新输出即可。`;
/** 待注册的 section；开关关闭时返回 null（调用方据此跳过注册）。 */
export function createPromptSection(inject) {
    if (inject !== true)
        return null;
    return { name: PROMPT_SECTION_NAME, order: PROMPT_SECTION_ORDER, text: PROMPT_TEXT };
}
