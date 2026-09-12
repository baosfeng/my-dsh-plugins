/**
 * dsh-mermaid-render — host half（TypeScript 源码）。
 *
 * 插件由两半组成：
 *  1. **client 半**（\`lib/client.js\`，\`__ModuleLoader__\` bundle）：把对话里的
 *     mermaid/mmd 代码块渲染为图表卡片（预览/代码切换、导出、失败兜底）；
 *  2. **host 半**（本文件）：注册一条固定的 system-prompt section（issue #194），
 *     让模型知道「本环境原生支持 mermaid 图表渲染」——用户不写出 "mermaid"
 *     字样时也会主动输出 \`\`\`mermaid 代码块。文案与开关见 \`src/prompt.ts\`。
 *
 * 默认注入；\`config.injectPrompt = false\` 时不注册任何 section（client 渲染不受影响）。
 * 本文件编译为 lib/index.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { createPromptSection } from './prompt.js';
export const name = 'dsh-mermaid-render';
/** 硬依赖 systemPrompt 服务（与 dsh-think-zh-expand / dsh-my-memory 一致的写法）。 */
export const inject = ['systemPrompt'];
export function apply(ctx, config) {
    const section = createPromptSection(config);
    if (section === null) {
        ctx.logger?.info('[dsh-mermaid-render] 已挂载（client 端 mermaid 渲染；系统提示词注入已关闭）');
        return;
    }
    ctx.systemPrompt?.section(section);
    ctx.logger?.info('[dsh-mermaid-render] 已挂载（client 端 mermaid 渲染 + 系统提示词能力说明注入）');
}
