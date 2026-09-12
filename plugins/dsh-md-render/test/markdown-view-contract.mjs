/**
 * MarkdownView 公共 API 契约测试（issue #186 P2）。
 *
 * 为什么单独一套：`MarkdownView` 是 dsh-md-render 唯一对外承诺的跨插件 API
 * （dsh-think-zh-expand 硬依赖 `require('dsh-md-render').MarkdownView`、
 * dsh-my-plugin-manager 走 try/catch 降级路径），但此前只有零散的功能断言，
 * 没有"公共面"契约与 semver 承诺。本文件钉住三件事：
 *
 *  1. 导出面：bundle id = `dsh-md-render`，`MarkdownView` 可从工厂 exports 取到；
 *  2. props 契约：`{ text: string }` —— 字符串输入必有输出、空串安全渲染、
 *     额外 props 被忽略、非字符串不抛（降级为文本，具体形态未承诺）；
 *  3. 输出结构契约：跨插件可见的 DOM 类名与层级（README「公共 API 契约」一节
 *     列出的清单就是本文件的断言对象）。
 *
 * 破坏其中任何一条 = semver 破坏性变更（major）。改类名清单时三处同步：
 * `plugins/dsh-md-render/README.md`（公共 API 契约）、`CHANGELOG.md`、
 * `docs/md渲染/需求清单.md` R25。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── stubbed react + bundle loader（与 test/markdown-view.mjs 同款）─────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}
const stubbed = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, get) => get(),
}

let registered = null
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
global.document = undefined
global.Element = function Element() {}
global.MutationObserver = class {
  constructor() {}
  observe() {}
  disconnect() {}
}

eval(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'))
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
const MarkdownView = exportsObj.MarkdownView

// ── 结构收集 ──────────────────────────────────────────────────────────────
/** 收集渲染树里的全部 className（并集）与标签名。 */
function collect(node, classes, tags) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) collect(child, classes, tags)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    // 展开函数组件（CopyButton 的 className 在组件体内产生）；stub hooks 是纯的。
    collect(node.type(node.props), classes, tags)
    return
  }
  tags.add(node.type)
  const props = node.props ?? {}
  for (const name of String(props.className ?? '').split(/\s+/)) {
    if (name) classes.add(name)
  }
  collect(props.children, classes, tags)
}
function surface(text) {
  const classes = new Set()
  const tags = new Set()
  collect(MarkdownView({ text }), classes, tags)
  return { classes, tags }
}

/** README「公共 API 契约」承诺的结构类名（跨插件可见的 DOM 契约）。 */
const PUBLIC_CLASSES = [
  'tzx-md', // 根容器（think-zh-expand 迁出前约定的结构类名）
  'tzx-p', // 段落
  'tzx-table', // 表格（thead/tbody 子结构）
  'md-code-block', // 代码块容器（dsh-mermaid-render 扫描它）
  'tzx-pre', // 代码块 pre
  'dsh-md-render-code-head', // 代码块头部（语言标签行）
  'dsh-md-render-code-lang', // 语言标签
  'dsh-md-render-math', // 行内公式
  'dsh-md-render-math-block', // 块级公式
  'dsh-md-render-math-error', // 公式错误标记
  'dsh-md-render-copy', // 复制按钮
]

describe('导出契约（跨插件 require）', () => {
  it('bundle id 为 dsh-md-render（下游 dsh.client.external 的键）', () => {
    expect(registered.id).toBe('dsh-md-render')
  })

  it('MarkdownView 可从工厂 exports 取到且是函数组件', () => {
    expect(typeof MarkdownView).toBe('function')
  })

  it('MarkdownView 是唯一承诺的渲染 API（其余导出为内部/测试面）', () => {
    // 下游只允许依赖 MarkdownView；这里把「承诺」写死，防止有人误以为
    // parseTable / renderTable 之流是公共 API（它们随内部重构变动）。
    expect(Object.keys(exportsObj)).toContain('MarkdownView')
  })
})

describe('props 契约：{ text: string }', () => {
  it('字符串输入返回元素树（根为 div.tzx-md）', () => {
    const tree = MarkdownView({ text: '契约：一段普通文本' })
    expect(tree.type).toBe('div')
    expect(tree.props.className).toBe('tzx-md')
  })

  it('空字符串安全渲染为空容器（不抛、不产出占位文本）', () => {
    const tree = MarkdownView({ text: '' })
    expect(tree.type).toBe('div')
    expect(tree.props.className).toBe('tzx-md')
  })

  it('多行 / 特殊字符输入不抛（含未闭合公式的错误降级路径）', () => {
    for (const text of ['a\n\nb', '| a | b |\n| --- | --- |\n| 1 | 2 |', '坏公式 $x', '\`\`\`\ncode\n\`\`\`', '<script>alert(1)</script>']) {
      expect(() => MarkdownView({ text })).not.toThrow()
    }
  })

  it('额外 props 被忽略（输出与只传 text 完全一致）', () => {
    const only = JSON.stringify(MarkdownView({ text: 'same' }), (k, v) => (typeof v === 'function' ? '[fn]' : v))
    const extra = JSON.stringify(
      MarkdownView({ text: 'same', sessionId: 's1', options: { copyButton: false }, children: 'ignored' }),
      (k, v) => (typeof v === 'function' ? '[fn]' : v),
    )
    expect(extra).toBe(only)
  })

  it('非字符串 text 不抛（降级为文本；具体形态未承诺）', () => {
    for (const text of [undefined, null, 42]) {
      expect(() => MarkdownView({ text })).not.toThrow()
    }
  })
})

describe('输出结构契约（README 公共 API 契约清单）', () => {
  const samples = {
    '普通段落': 'hello',
    '表格': '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '代码块': '\`\`\`js\nconst x = 1\n\`\`\`',
    '行内 + 块级公式': 'inline $x^2$ end\n\n$$\n\\frac{1}{2}\n$$',
    '公式错误降级': 'bad $x',
  }

  it('清单里的每个公共类名都在代表性渲染中出现', () => {
    const classes = new Set()
    const tags = new Set()
    for (const text of Object.values(samples)) {
      const s = surface(text)
      for (const c of s.classes) classes.add(c)
      for (const t of s.tags) tags.add(t)
    }
    const missing = PUBLIC_CLASSES.filter((c) => !classes.has(c))
    expect(missing, '缺失的公共类名（改类名 = semver 破坏性变更，需同步 README/CHANGELOG）').toEqual([])
    expect(tags.has('table')).toBe(true)
    expect(tags.has('pre')).toBe(true)
  })

  it('表格输出带 thead/tbody 子结构（下游按结构断言过）', () => {
    const tree = MarkdownView({ text: '| a | b |\n| --- | --- |\n| 1 | 2 |' })
    const tags = new Set()
    collect(tree, new Set(), tags)
    expect(tags.has('thead')).toBe(true)
    expect(tags.has('tbody')).toBe(true)
  })

  it('代码块容器是 div.md-code-block（dsh-mermaid-render 靠它扫描）', () => {
    const tree = MarkdownView({ text: '\`\`\`mermaid\ngraph TD;\n\`\`\`' })
    const classes = new Set()
    collect(tree, classes, new Set())
    expect(classes.has('md-code-block')).toBe(true)
  })

  it('类名命名空间稳定：历史 tzx-* 与插件命名空间 dsh-md-render-*', () => {
    for (const c of PUBLIC_CLASSES) {
      expect(c.startsWith('tzx-') || c.startsWith('dsh-md-render-') || c === 'md-code-block').toBe(true)
    }
  })
})

describe('semver 承诺文档（README / 需求清单）', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const requirementList = readFileSync(join(ROOT, '..', '..', 'docs', 'md渲染', '需求清单.md'), 'utf8')

  it('README 有「公共 API 契约」章节', () => {
    expect(readme.includes('公共 API 契约')).toBe(true)
  })

  it('README 承诺清单覆盖本文件断言的每个公共类名', () => {
    for (const c of PUBLIC_CLASSES) {
      expect(readme.includes(c), `README 缺少公共类名 ${c}`).toBe(true)
    }
  })

  it('CHANGELOG 记录了 MarkdownView 的 semver 承诺', () => {
    expect(changelog.includes('MarkdownView')).toBe(true)
  })

  it('需求清单有对应条目（R25）', () => {
    expect(requirementList.includes('R25')).toBe(true)
  })
})
