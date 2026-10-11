/**
 * 自研 markdown 渲染器（own-markdown.ts）：marked 词法树 → 本插件自己的 React vdom。
 *
 * 判据（真实 marked 18.1.0 + 假 DOM 落盘）：块级 / 行内 / GFM 表格 / 代码围栏 / 链接与图片的
 * 安全口径（raw HTML 当字面文本、javascript: 链接退化、来路不明图片只出 alt）。**不调用官方
 * MarkdownText** —— 断言的是我们自己产出的 class 与标签。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  vdomToDom,
} from './support/fake-dom.mjs'

/** 用 MarkdownView（公共 API，同一份自研渲染器）把 markdown 落成假 DOM。 */
function render(text, options = {}) {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = createRenderStack(page, react, options)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  return vdomToDom(loaded.exports.MarkdownView({ text }), page.document)
}

test('块级元素：标题 / 段落 / 引用 / 分隔线 / 加粗斜体删除线 / 行内代码', () => {
  const dom = render(
    [
      '# 一级',
      '## 二级',
      '### 三级',
      '#### 四级',
      '##### 五级',
      '',
      '段落 **粗** *斜* ~~删~~ `x = 1`',
      '',
      '> 引用',
      '',
      '---',
    ].join('\n'),
  )
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5']) assert.ok(dom.querySelector(tag), tag + ' 真标签')
  assert.equal(dom.querySelector('h1').textContent, '一级', 'h1 文本')
  assert.equal(dom.querySelector('h6'), null, '没有六级标题时不会瞎造')
  assert.equal(dom.querySelector('strong').textContent, '粗', 'strong 真标签')
  assert.equal(dom.querySelector('em').textContent, '斜', 'em 真标签')
  assert.equal(dom.querySelector('del').textContent, '删', 'del 真标签')
  assert.equal(dom.querySelector('code').textContent, 'x = 1', '行内代码')
  assert.ok(String(dom.querySelector('code').className).includes('dsh-md-render-md-code'), '行内代码带自有 class')
  assert.equal(dom.querySelector('blockquote').textContent, '引用', '引用块')
  assert.ok(dom.querySelector('hr'), '分隔线')
})

test('列表：有序 / 无序 / 嵌套 / 任务列表', () => {
  const dom = render(['- 一', '- 二', '  - 嵌套', '', '3. 第三', '4. 第四', '', '- [x] 做完', '- [ ] 没做'].join('\n'))
  assert.equal(dom.querySelectorAll('ul.dsh-md-render-md-list').length, 3, '三段无序列表（含嵌套与任务列表）')
  assert.equal(dom.querySelectorAll('li').length, 7, '七个列表项（含嵌套项）')
  assert.equal(dom.querySelector('ul li ul li').textContent, '嵌套', '嵌套列表')
  const ol = dom.querySelector('ol')
  assert.equal(ol.getAttribute('start'), '3', '有序列表还原起始序号')
  assert.equal(ol.querySelectorAll('li').length, 2, '有序列表两项')
  const tasks = dom.querySelectorAll('input.dsh-md-render-md-task')
  assert.equal(tasks.length, 2, '任务列表两个只读复选框')
  assert.equal(tasks[0].getAttribute('checked'), 'true', '已完成项勾选')
  assert.equal(tasks[1].getAttribute('checked'), null, '未完成项不勾选')
})

test('GFM 表格：外层横向滚动容器 + 对齐用自有 class（不写行内 style / align）', () => {
  const dom = render(['| 左 | 中 | 右 |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n'))
  assert.ok(dom.querySelector('div.dsh-md-render-md-table-wrap'), '宽表格外包横向滚动容器')
  assert.equal(dom.querySelectorAll('thead th').length, 3, '三个表头单元格')
  assert.equal(dom.querySelectorAll('tbody td').length, 3, '三个数据单元格')
  assert.ok(String(dom.querySelector('th').className).includes('dsh-md-render-md-left'), '左对齐 class')
  assert.ok(String(dom.querySelectorAll('th')[1].className).includes('dsh-md-render-md-center'), '居中 class')
  assert.ok(String(dom.querySelectorAll('th')[2].className).includes('dsh-md-render-md-right'), '右对齐 class')
})

test('markdown 里的围栏代码块走**自研**代码块渲染（真语言名 + hljs 高亮）', () => {
  const dom = render(['说明：', '', '```js', 'const a = 1', '```'].join('\n'))
  assert.ok(dom.querySelector('div.dsh-md-render-code'), '内部代码块也是自研卡片')
  assert.equal(dom.querySelector('span.dsh-md-render-code-lang').textContent, 'js', 'banner 显示真实语言名')
  assert.ok(dom.querySelectorAll('span[class*=hljs-]').length > 0, '高亮 span 存在')
  assert.equal(dom.querySelector('pre').textContent, 'const a = 1', '源码一字不少')
})

test('安全口径①：raw HTML 当字面文本（模型输出永远不被当 HTML 执行）', () => {
  const dom = render('<img src=x onerror=alert(1)>\n\n<div onclick="x">块级</div>')
  assert.equal(dom.querySelector('img'), null, '不产出 img 元素')
  assert.equal(dom.querySelector('div'), null, '不产出 raw div 元素')
  assert.ok(dom.textContent.includes('<img src=x onerror=alert(1)>'), '原文以文本形式保留')
})

test('安全口径②：javascript: 链接退化为纯文本；http / 同源相对路径放行', () => {
  const dom = render(['[a](javascript:alert(1))', '', '[b](https://example.com)'].join('\n'))
  const links = dom.querySelectorAll('a')
  assert.equal(links.length, 1, '只放行一个链接')
  assert.equal(links[0].getAttribute('href'), 'https://example.com', 'http(s) 链接保留')
  assert.equal(links[0].getAttribute('rel'), 'noreferrer noopener', '外链带安全 rel')
  assert.ok(dom.querySelector('.dsh-md-render-md-link-plain'), '危险协议的链接退化为纯文本')
})

test('安全口径③：来路不明的图片地址只出 alt 文本', () => {
  const dom = render('![图](javascript:alert(1)) ![好图](https://example.com/a.png)')
  const imgs = dom.querySelectorAll('img')
  assert.equal(imgs.length, 1, '只放行一个图片')
  assert.equal(imgs[0].getAttribute('src'), 'https://example.com/a.png', 'http(s) 图片保留')
  assert.equal(dom.querySelector('.dsh-md-render-md-img-alt').textContent, '图', '危险地址的图片退化为 alt 文本')
})

test('解析层未就绪 → <pre> 原文兜底（内容一字不丢，真降级）', () => {
  const dom = render('# 标题\n\n正文', { assets: false })
  const fallback = dom.querySelector('pre.dsh-md-render-fallback')
  assert.ok(fallback, '落 <pre> 兜底')
  assert.equal(fallback.textContent, '# 标题\n\n正文', '原文保留')
  assert.equal(dom.querySelector('h1'), null, '没有解析层时不产出真实标签（不假装渲染）')
})
