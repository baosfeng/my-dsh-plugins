// ── 统一 MarkdownView（对外公共 API 面）──────────────────────────────
// 对外承诺（README「公共 API 契约」）：require('dsh-md-render').MarkdownView
// 存在且为 React 组件，props 为 { text: string }（额外 props 忽略，非字符串
// 降级为文本）；bundle id 为 dsh-md-render。
//
// 实现 = **本插件自己的 markdown 渲染器**（own-markdown.ts：marked 词法树 →
// React vdom，解析层走 assets 懒加载）+ 非标准表格容错（table-normalize.ts）
// + 「整段复制」按钮（copy.ts 的 MdrCopyButton）。**不调用官方 MarkdownText**。
// 解析层还没加载好 → 先落 <pre> 原文兜底（内容一字不丢），就绪通知触发重渲染。
// 根容器类名与自研渲染器同源（.mdr-root.mdr-md）：整段复制的 hover 浮现
// （.mdr-md:hover .mdr-md-copy）与 markdown 排版样式都挂在这个作用域上。

/** 统一 MarkdownView：{ text } → div.mdr-root.mdr-md（自研渲染 + 整段复制按钮）。 */
function MarkdownView({ text }: { text: string }): unknown {
  const source = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text)
  const [ready, setReady] = useState(false)
  const nodes = markdownNodes(source)
  // 解析层未就绪：订阅一次就绪通知，避免整段停在兜底形态（依赖数组只看 source / 就绪态）。
  useEffect(() => {
    if (nodes !== null) return undefined
    return installRenderAssetReady(() => setReady(true))
  }, [source, ready])
  return createElement(
    'div',
    { className: 'mdr-root mdr-md' },
    // 解析层未就绪 → <pre> 兜底（原文不丢、渲染期不抛错）；就绪后换成自研渲染结果。
    ...(nodes === null ? [createElement('pre', { key: 'md-fallback', className: 'mdr-md-plain' }, source)] : nodes),
    // 整段复制按钮（copyButton 关闭 → 不渲染）；官方只有代码块复制。
    renderOptions.markdown.copyButton
      ? createElement(MdrCopyButton, { text: '', tip: '复制整段 markdown', className: 'mdr-md-copy' })
      : null,
  )
}

exports.MarkdownView = MarkdownView
