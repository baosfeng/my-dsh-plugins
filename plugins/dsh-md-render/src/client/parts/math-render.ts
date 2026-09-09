// ── 公式结构渲染（issue #82）：AST 节点 → React 元素 ────────────────
// 由 math.ts（解析）产出节点数组，本文件渲染为语义化嵌套结构：
//   frac → span.dsh-md-render-frac（num / den 上下 + 分数线）
//   sqrt → span.dsh-md-render-sqrt（√ 符号 + body 顶部根号线）
//   supsub → span.dsh-md-render-supsub（base + 上下标 scripts）
//   big → span.dsh-md-render-big（求和/积分符号 + 上下限）
//   seq → span.dsh-md-render-seq（组内联，无样式）
// 样式见 styles.ts（语义 token，深浅主题自适应；随 activation 注入）。
let __mathKey = 0
function mathNodesToReact(nodes: MathNode[]): unknown[] {
  return nodes.map(renderMathNode)
}

function renderMathNode(node: MathNode): unknown {
  const k = 'm' + __mathKey++
  if (node === null || node === undefined) return ''
  if (node.t === 'text') return node.v
  if (node.t === 'seq')
    return createElement('span', { key: k, className: 'dsh-md-render-seq' }, ...mathNodesToReact(node.kids!))
  if (node.t === 'frac') return renderFrac(node, k)
  if (node.t === 'sqrt') return renderSqrt(node, k)
  if (node.t === 'supsub') return renderSupsub(node, k)
  if (node.t === 'big') return renderBig(node, k)
  return ''
}

function renderFrac(node: MathNode, k: string): unknown {
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-frac' },
    createElement('span', { key: k + 'n', className: 'dsh-md-render-frac-num' }, ...mathNodesToReact([node.num!])),
    createElement('span', { key: k + 'd', className: 'dsh-md-render-frac-den' }, ...mathNodesToReact([node.den!])),
  )
}

function renderSqrt(node: MathNode, k: string): unknown {
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-sqrt' },
    createElement('span', { key: k + 's', className: 'dsh-md-render-sqrt-symbol' }, '√'),
    createElement('span', { key: k + 'b', className: 'dsh-md-render-sqrt-body' }, ...mathNodesToReact([node.body!])),
  )
}

function renderSupsub(node: MathNode, k: string): unknown {
  const scripts =
    node.sup !== null || node.sub !== null
      ? createElement(
          'span',
          { key: k + 's', className: 'dsh-md-render-supsub-scripts' },
          node.sup !== null
            ? createElement(
                'span',
                { key: k + 'u', className: 'dsh-md-render-supsub-sup' },
                ...mathNodesToReact([node.sup!]),
              )
            : null,
          node.sub !== null
            ? createElement(
                'span',
                { key: k + 'd', className: 'dsh-md-render-supsub-sub' },
                ...mathNodesToReact([node.sub!]),
              )
            : null,
        )
      : null
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-supsub' },
    createElement('span', { key: k + 'b', className: 'dsh-md-render-supsub-base' }, ...mathNodesToReact([node.base!])),
    scripts,
  )
}

function renderBig(node: MathNode, k: string): unknown {
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-big' },
    node.sup !== null || node.sub !== null
      ? createElement(
          'span',
          { key: k + 'l', className: 'dsh-md-render-big-limits' },
          node.sup !== null
            ? createElement(
                'span',
                { key: k + 'u', className: 'dsh-md-render-big-sup' },
                ...mathNodesToReact([node.sup!]),
              )
            : null,
          node.sub !== null
            ? createElement(
                'span',
                { key: k + 'd', className: 'dsh-md-render-big-sub' },
                ...mathNodesToReact([node.sub!]),
              )
            : null,
        )
      : null,
    createElement('span', { key: k + 'y', className: 'dsh-md-render-big-symbol' }, node.sym),
  )
}

exports.mathNodesToReact = mathNodesToReact
