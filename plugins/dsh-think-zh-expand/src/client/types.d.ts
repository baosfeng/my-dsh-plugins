/**
 * dsh-think-zh-expand — client 端类型声明。
 *
 * 声明 client 端使用的外部模块类型（编译期擦除，不影响运行时）。
 */

/** dsh-md-render 提供的 MarkdownView 组件。 */
export type MarkdownViewComponent = (props: { text: string }) => unknown
