/**
 * 自研 markdown 渲染 —— 行为断言（真实源码 + 假 marked 词法树，不跑构建）。
 *
 * 做法：用 typescript 把两个脚本模式片段（own-markdown.ts / table-normalize.ts）
 * 转成 JS，在 `new Function` 里以显式参数提供 factory 作用域的全局
 * （createElement / ensureRenderAsset / MARKED_ASSET / normalizeTables）后求值。
 * 这样测的是**真实实现**：vdom 结构、任务项只读、表格先归一、raw HTML 当字面文本。
 *
 * 静态断言：禁 innerHTML / dangerouslySetInnerHTML；marked 未就绪时真降级。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const source = (name) => readFileSync(new URL(`../src/client/parts/${name}`, import.meta.url), 'utf8')
/** 自研 markdown 渲染器 = inline 层（own-markdown.ts）+ 块级层（own-markdown-blocks.ts）。 */
const OWN_FILES = ['own-markdown.ts', 'own-markdown-blocks.ts']
const ownSource = () => OWN_FILES.map((name) => source(name)).join('\n')
/** 只取代码本体（去掉注释，注释里允许写「禁 innerHTML」这类规范说明）。 */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/** TS 脚本模式片段 → 可求值 JS（Node 原生剥类型，无需 typescript 编译器）。 */
function transpile(text) {
  return stripTypeScriptTypes(text)
}

/** 极简 vdom 桩：{ type, props, children }。 */
function createElement(type, props, ...children) {
  return { type, props: props || {}, children }
}

// 真实表格归一逻辑（同一份源码）
const tableExports = {}
new Function('exports', transpile(source('table-normalize.ts')))(tableExports)
const { normalizeTables } = tableExports

// 真实 markdown 渲染逻辑
let markedStub = null
let lexerInput = ''
const ownExports = {}
new Function(
  'exports',
  'createElement',
  'ensureRenderAsset',
  'normalizeTables',
  'MARKED_ASSET',
  transpile(ownSource()),
)(ownExports, createElement, () => markedStub, normalizeTables, 'marked')
const { MdrMarkdown, markdownNodes } = ownExports

/** marked 桩：记录 lexer 实际收到的文本，返回给定词法树。 */
function stubMarked(tokens) {
  markedStub = {
    lexer(input) {
      lexerInput = input
      return tokens
    },
  }
}

const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node === 'string') return
  visit(node)
  for (const child of node.children || []) walk(child, visit)
}
const textOf = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  return (node.children || []).map(textOf).join('')
}

test('标题阶梯：h1–h6 逐级收敛，7+ 的畸形层级钳到 h6', () => {
  stubMarked(
    [1, 2, 3, 4, 5, 6, 7].map((depth) => ({
      type: 'heading',
      depth,
      tokens: [{ type: 'text', text: 'H' + String(depth) }],
    })),
  )
  const nodes = markdownNodes('x')
  assert.deepEqual(
    nodes.map((node) => node.type),
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h6'],
  )
})

test('任务列表：只读复选框（disabled + readOnly + checked），完成项带 is-done', () => {
  stubMarked([
    {
      type: 'list',
      ordered: false,
      items: [
        {
          type: 'list_item',
          task: true,
          checked: true,
          tokens: [{ type: 'text', text: '已完成', tokens: [{ type: 'text', text: '已完成' }] }],
        },
        { type: 'list_item', task: true, checked: false, tokens: [{ type: 'text', text: '未完成' }] },
      ],
    },
  ])
  const [ul] = markdownNodes('x')
  assert.equal(ul.type, 'ul')
  assert.match(ul.props.className, /mdr-md-task-list/)
  const [done, todo] = ul.children
  const doneBox = done.children[0]
  assert.equal(doneBox.type, 'input')
  assert.equal(doneBox.props.type, 'checkbox')
  assert.equal(doneBox.props.checked, true)
  assert.equal(doneBox.props.disabled, true)
  assert.equal(doneBox.props.readOnly, true)
  assert.match(done.props.className, /is-done/)
  const todoBox = todo.children[0]
  assert.equal(todoBox.props.checked, false)
  assert.doesNotMatch(todo.props.className, /is-done/)
})

test('表格：先过 normalizeTables（非标准分隔行）→ 圆角滚动容器 + thead/tbody', () => {
  lexerInput = ''
  stubMarked([
    {
      type: 'table',
      header: ['a', 'b', 'c'].map((text) => ({ type: 'text', tokens: [{ type: 'text', text }] })),
      align: ['left', 'center', 'right'],
      rows: [
        [
          { type: 'text', tokens: [{ type: 'text', text: '1' }] },
          { type: 'text', tokens: [] },
        ],
      ],
    },
  ])
  const [wrap] = markdownNodes('a | b | c\n--- | ---\n1 | 2')
  // lexer 收到的是**归一后**的文本（分隔行补齐到表头列数）
  assert.equal(lexerInput, 'a | b | c\n--- | --- | ---\n1 | 2')
  assert.equal(wrap.type, 'div')
  assert.match(wrap.props.className, /mdr-scroll/)
  assert.match(wrap.props.className, /mdr-md-table-wrap/)
  const [table] = wrap.children
  assert.equal(table.type, 'table')
  assert.equal(table.props.className, 'mdr-md-table')
  const [thead, tbody] = table.children
  assert.equal(thead.children[0].children.length, 3)
  assert.equal(tbody.children[0].children.length, 2)
  assert.equal(thead.children[0].children[1].props.className, 'mdr-md-cell mdr-md-cell-center')
})

test('raw HTML 当字面文本（不产生任何 HTML 注入面）', () => {
  const src = codeOf(ownSource())
  assert.doesNotMatch(src, /innerHTML|dangerouslySetInnerHTML/)
  stubMarked([{ type: 'html', text: '<img src=x onerror=alert(1)>' }])
  const [paragraph] = markdownNodes('x')
  assert.equal(paragraph.type, 'p')
  assert.equal(textOf(paragraph), '<img src=x onerror=alert(1)>')
  walk(paragraph, (node) => {
    assert.ok(!('dangerouslySetInnerHTML' in node.props), '不得出现 dangerouslySetInnerHTML')
  })
})

test('链接：只放行 http/https/mailto 与同源相对路径，其余降级纯文本', () => {
  stubMarked([
    {
      type: 'paragraph',
      tokens: [
        { type: 'link', href: 'javascript:alert(1)', tokens: [{ type: 'text', text: '坏链' }] },
        { type: 'link', href: 'https://example.com/a', tokens: [{ type: 'text', text: '好链' }] },
        { type: 'link', href: '/relative/path', tokens: [{ type: 'text', text: '相对' }] },
      ],
    },
  ])
  const [paragraph] = markdownNodes('x')
  const [bad, good, relative] = paragraph.children
  assert.equal(bad.type, 'span')
  assert.equal(bad.props.className, 'mdr-md-link-plain')
  assert.equal(good.type, 'a')
  assert.equal(good.props.href, 'https://example.com/a')
  assert.equal(good.props.target, '_blank')
  assert.match(good.props.rel, /noopener/)
  assert.equal(relative.type, 'a')
})

test('图片：不安全地址只出 alt 文本；安全地址可键盘放大', () => {
  stubMarked([
    {
      type: 'paragraph',
      tokens: [
        { type: 'image', href: 'data:image/png;base64,AAA', text: '图注' },
        { type: 'image', href: 'https://example.com/a.png', text: '配图', title: '标题' },
      ],
    },
  ])
  const [paragraph] = markdownNodes('x')
  const [bad, good] = paragraph.children
  assert.equal(bad.type, 'span')
  assert.equal(bad.props.className, 'mdr-md-img-alt')
  assert.equal(good.type, 'img')
  assert.equal(good.props.src, 'https://example.com/a.png')
  assert.equal(good.props.alt, '配图')
  assert.equal(good.props.tabIndex, 0)
  assert.equal(good.props['data-mdr-zoom'], 'true')
  assert.equal(good.props.loading, 'lazy')
})

test('代码块：优先交给 MdrCodeBlock，未就绪退化为自有 pre', () => {
  stubMarked([{ type: 'code', lang: 'ts', text: 'const a = 1' }])
  let [node] = markdownNodes('x')
  assert.equal(node.type, 'pre')
  assert.equal(node.props.className, 'mdr-md-pre')
  assert.equal(node.props['data-mdr-lang'], 'ts')
  assert.equal(textOf(node), 'const a = 1')

  function MdrCodeBlock() {}
  ownExports.MdrCodeBlock = MdrCodeBlock
  ;[node] = markdownNodes('x')
  assert.equal(node.type, MdrCodeBlock)
  assert.deepEqual(node.props, { key: node.props.key, lang: 'ts', code: 'const a = 1' })
  delete ownExports.MdrCodeBlock
})

test('MdrMarkdown：根节点契约（mdr-root/mdr-md、data-streaming、解析层未就绪降级）', () => {
  stubMarked([])
  const root = MdrMarkdown({ text: '## 标题', streaming: true })
  assert.equal(root.type, 'div')
  assert.match(root.props.className, /mdr-root/)
  assert.match(root.props.className, /mdr-md/)
  assert.match(root.props.className, /is-streaming/)
  assert.equal(root.props['data-mdr-root'], 'true')
  assert.equal(root.props['data-streaming'], 'true')
  assert.equal(MdrMarkdown({ text: 'hi' }).props['data-streaming'], undefined)

  markedStub = null
  assert.equal(markdownNodes('hi'), null)
  const fallback = MdrMarkdown({ text: '原始 **文本**' })
  const [plain] = fallback.children
  assert.equal(plain.type, 'pre')
  assert.equal(plain.props.className, 'mdr-md-plain')
  assert.equal(textOf(plain), '原始 **文本**')
})

test('静态断言：走 marked.lexer + normalizeTables，状态只走 setAttribute 白名单语义', () => {
  const src = ownSource()
  const code = codeOf(src)
  assert.match(code, /ensureRenderAsset\(MARKED_ASSET\)/)
  assert.match(code, /\.lexer/)
  assert.match(code, /normalizeTables\(source\)/)
  assert.match(code, /function MdrMarkdown\(props: \{ text: string; streaming\?: boolean \}\)/)
  assert.doesNotMatch(code, /classList|cssText|\.style\./)
})

test('table-normalize：合法 GFM 原样返回，两类非标准写法规范化', () => {
  const unchanged = [
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'a | b\n--- | ---\n1 | 2',
    'a | b\n---|---\n1 | 2',
    'a | b\n-|-\n1 | 2',
    '前缀 **文本**\na | b\n--- | ---\n1 | 2',
    'a | b\n--- | ---',
    'a | b\n--- | ---\n1\n2 | 3 | 4',
    '普通段落\n\n没有任何表格',
  ]
  for (const text of unchanged) assert.equal(normalizeTables(text), text, JSON.stringify(text))
  assert.equal(normalizeTables('a | b\n---\n1 | 2'), 'a | b\n--- | ---\n1 | 2')
  assert.equal(normalizeTables('a | b\n:---:\n1 | 2'), 'a | b\n:---: | ---\n1 | 2')
  assert.equal(normalizeTables('a | b | c\n--- | ---\n1 | 2'), 'a | b | c\n--- | --- | ---\n1 | 2')
  assert.equal(normalizeTables('a | b\n--- | --- | ---\n1 | 2'), 'a | b\n--- | ---\n1 | 2')
  assert.equal(normalizeTables('a | b | c\n:-- | :-:\n1 | 2 | 3'), 'a | b | c\n:--- | :---: | ---\n1 | 2 | 3')
})
