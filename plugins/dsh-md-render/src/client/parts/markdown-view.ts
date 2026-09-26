// ── 统一 MarkdownView（对外公共 API 面）──────────────────────────────
// 对外承诺（README「公共 API 契约」）：require('dsh-md-render').MarkdownView
// 存在且为 React 组件，props 为 { text: string }（额外 props 忽略，非字符串
// 降级为文本）；bundle id 为 dsh-md-render。
//
// 实现 = 官方 MarkdownText（平台 seed 模块，表格 / 公式 / 代码块全部由
// 官方渲染）+ 非标准表格容错预处理（table-normalize.ts） + 「整段复制」
// 按钮（官方只有代码块复制，整段复制是本插件保留的增量）。官方组件不可用
// → <pre> 兜底。本文件不含任何自实现的 markdown 渲染。

/** 统一 MarkdownView：{ text } → div.tzx-md（官方渲染 + 整段复制按钮）。 */
function MarkdownView({ text }: { text: string }): unknown {
  const source = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text)
  return createElement(
    'div',
    { className: 'tzx-md' },
    officialMarkdownNode(source),
    // 整段复制按钮（copyButton 关闭 → 不渲染）；官方只有代码块复制。
    renderOptions.copyButton ? createElement(CopyButton, { kind: 'content' }) : null,
  )
}

exports.MarkdownView = MarkdownView
