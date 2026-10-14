/**
 * 合并后的硬约束静态断言（issue #463，机器可校验）。
 *
 * 用户硬约束（最高优先级）：「合并后**只做 markdown 内容的渲染**……其他一律保持
 * 官方默认样式」。本文件把可机器校验的部分钉死，防止后续改动悄悄越界：
 *
 *  1. **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  2. **不读 React fiber 私有属性**（__reactFiber$ / memoizedProps）；
 *  3. **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  4. **单 MutationObserver**（合并前 md-render 与 mermaid 各装一个）；
 *  5. 不出现自绘助手节点 / 自绘思考块（ThinkBlock / AssistantStepView）。
 *
 * 断言对象是**构建产物** lib/client.js：注释先剔除（避免「注释里写了禁令」被误判），
 * 剩余文本同时覆盖代码与字符串字面量 —— 本文件的断言正是靠字面量命中。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** 剔除块注释与行注释后的产物文本。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const CODE = stripComments(RAW)

test('client bundle：不注册任何 conversation.chat.node 节点级 seat', () => {
  assert.equal(CODE.includes('conversation.chat.node'), false, 'must not register node-level seats')
  assert.equal(CODE.includes('assistant-step'), false, 'must not shadow the assistant-step renderer')
  // slots 扩展点只允许这两个加法型 seat：
  //  · settings.plugins.tab（list / replaceRisk none，旧宿主与「设置 → 内置插件」）；
  //  · plugins.bundle.config（keyed / replaceRisk shadows-shipped-ui，仅 key = 本包名）。
  const injected = [...CODE.matchAll(/inject\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(
    [...injected].sort(),
    ['plugins.bundle.config', 'settings.plugins.tab'],
    'only the two additive settings seats are injected',
  )
})

test('client bundle：不读 React fiber 私有属性', () => {
  assert.equal(CODE.includes('__reactFiber'), false, 'no React fiber private property reads')
  assert.equal(CODE.includes('memoizedProps'), false, 'no memoizedProps reads')
  assert.equal(CODE.includes('fiberKeys'), false, 'no fiber walking helpers')
})

test('client bundle：不对官方元素写 style / class / aria', () => {
  // style 写入只允许插件自建的 textarea（复制兜底）
  const styleWrites = [...CODE.matchAll(/\b([A-Za-z_$][\w$]*)\.style\./g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(styleWrites)],
    ['ta'],
    'the only inline style target is the plugin-owned fallback textarea',
  )
  assert.equal(CODE.includes('cssText'), false, 'no cssText writes (offscreen host uses a class)')
  assert.equal(/classList\.(add|remove|toggle)/.test(CODE), false, 'no classList mutation anywhere')
  // setAttribute 目标白名单：插件自有 data-* 标记 + 自有组件属性
  const attrs = [...CODE.matchAll(/\.setAttribute\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  const allowed = new Set([
    'data-context-text',
    'data-dsh-md-render-context',
    'data-dsh-md-render-context-body',
    'data-signature',
    'data-dsh-md-render-text-view',
    'data-dsh-md-render-text-sig',
    'data-dsh-md-render-mermaid',
    'data-dsh-md-render-mermaid-state',
    'data-dsh-md-render-mermaid-view',
    'data-dsh-md-render-offscreen',
    'data-dsh-md-render-settings',
    // 悬停浮层文字（控件只显示图标，文案收进浮层）。**必须带插件前缀**：
    // 宿主自己也用了裸 data-tip（ui-agent-preset），撞名会在同一页面上语义混淆。
    'data-dsh-md-render-tip',
    'data-dsh-md-render',
    'aria-pressed',
    'aria-label',
    'aria-checked',
    'aria-hidden',
    'role',
    'readonly',
  ])
  for (const name of attrs) assert.ok(allowed.has(name), 'unexpected setAttribute target: ' + name)
  // 官方 pre 的隐藏改由自有 CSS 规则完成（类选择器），不再写 el.style.display
  assert.equal(CODE.includes('style.display'), false, 'official <pre> is hidden by plugin CSS, not inline style')
  // 防回归：接管态必须隐藏**官方全部直接子元素**（banner 容器 + 内容容器），只留自有 DOM。
  // 两处历史坑：
  //  ① `>pre` 直接子选择器永远匹配不到（pre 在 [data-code-block-content] 内）→ 代码块与图表叠加；
  //  ② 只隐藏内容容器、漏了 banner 容器 → 卡片上方残留 42px 的「代码块」标签行。
  // 视图值限定保证：切回「查看原文 / 源码」时规则不再匹配，官方原样恢复。
  for (const view of [
    'data-dsh-md-render-mermaid-view',
    'data-dsh-md-render-text-view="markdown"',
    'data-dsh-md-render-text-view="code"',
  ]) {
    assert.ok(
      CODE.includes(`.md-code-block[${view}]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}`),
      `${view}: hides every official child (banner + content), keeping only plugin-owned nodes`,
    )
    assert.equal(
      CODE.includes(`[${view}]>pre`),
      false,
      `${view}: must not target a direct-child <pre> (pre lives inside [data-code-block-content])`,
    )
  }
  // 防回归：缩放锚点必须与**图中心**对齐。mermaid 的 <svg> 自带 max-width = 图表自然宽度，
  // 在普通块级变换层里会**左对齐**；而 panzoom 以变换层几何中心为缩放锚点 —— 两者中心可差
  // 270+px，放大近 2 倍后图被推到容器外侧，用户看到的是「点放大没反应」（真机实测 svg 跑到
  // 容器左外侧）。变换层改 flex 居中后实测中心偏移 277px → 0.5px。
  // **垂直方向是同一个坑的另一半**：flex 居中只在「内容小于变换层」时有效，而变换层高度 =
  // 内容固有高度（竖向长图 svg 可达数千 px，远大于容器 max-height:70vh）→ 缩放锚点
  // （变换层几何中心）落在容器可视区**之外** → 「适应」后图跑到容器下方（用户真机现象）。
  // 解法是 zoom-math.ts 的 zoomCenterInFrame：程序性缩放后**显式平移**让内容中心对齐容器中心。
  assert.ok(
    CODE.includes('.dsh-md-render-mermaid-canvas{display:flex;align-items:center;justify-content:center}'),
    'the zoom transform layer must center the svg so the panzoom anchor matches the diagram center',
  )
  assert.ok(
    CODE.includes('function zoomCenterInFrame(') &&
      CODE.includes('state.pz.pan(0, ((m.bh - m.sh) / 2) * k, { relative: false })'),
    '程序性缩放后必须显式把内容中心平移到容器中心（两个引擎的锚点都是变换层中心）',
  )
  // 补偿系数**随引擎而变**（真机实测踩过）：panzoom 的 transform 是 scale(s) translate(t)，
  // 平移量落在缩放坐标系里 ⇒ 传值要 ÷ scale；降级引擎是 translate(t) scale(s) ⇒ 1:1。
  assert.ok(
    CODE.includes('translateInScaledSpace') && CODE.includes('const k = state.translateInScaledSpace'),
    '居中补偿必须按引擎的 transform 顺序取系数（写死一个，另一个引擎就会偏）',
  )
  // ⚠️ 反面教训：别改用「让变换层绝对定位填满容器」来对齐锚点 —— 变换层脱离文档流后
  // 容器高度塌回 min-height(160px)，高度自适应没了、fit 又按 160px 算，图表被压到 20%
  // （用户真机反馈「所有都是固定高度」）。变换层必须留在流里。
  assert.equal(
    /data-dsh-md-render-zoom\]>\.dsh-md-render-mermaid-canvas\{position:absolute/.test(CODE),
    false,
    'transform layer must stay in flow (absolute fill collapses the container to min-height)',
  )
  // 变换层不写 transform-origin：两个引擎都会内联覆盖成 50% 50%（panzoom 构造时写元素 style；
  // 降级引擎 paint() 同），CSS 里再写一条只会让后来者以为锚点在别处。
  assert.equal(
    CODE.includes('.dsh-md-render-mermaid-canvas{transform-origin'),
    false,
    'no transform-origin on the transform layer (both engines set 50% 50% inline)',
  )
  // 防回归：缩放工具条必须渲染在**图表之前**（卡片头部之下）。
  // 宿主消息区底部被输入框浮层覆盖（实测占 y=449~577，而卡片高 408 + 浮层 128 > 可视 501），
  // 工具条排在卡片底部会变成「看得见、点不到」的幽灵按钮 —— hit-test 实测 5 个按钮中心点
  // 全部命中 composer 而非按钮自身。锚点取两个调用表达式的相对下标，避免被折行拆散。
  const zoomCallAt = CODE.indexOf('createElement(ZoomSeg,')
  const bodyCallAt = CODE.lastIndexOf('createElement(CardBody,')
  assert.ok(
    zoomCallAt !== -1 && bodyCallAt !== -1 && zoomCallAt < bodyCallAt,
    'the zoom bar must render before the diagram body (bottom edge is covered by the composer overlay)',
  )
})

test('client bundle：单 MutationObserver（合并前两路观察收敛为一路）', () => {
  assert.equal((RAW.match(/new MutationObserver/g) ?? []).length, 1, 'exactly one MutationObserver')
  assert.equal((CODE.match(/function installDomScanner\(/g) ?? []).length, 1, 'exactly one scanner skeleton')
  assert.equal((CODE.match(/function installScanner\(/g) ?? []).length, 1, 'exactly one scanner assembly')
})

test('client bundle：不含自绘助手节点 / 自绘思考块 / 旧包名', () => {
  for (const banned of ['ThinkBlock', 'AssistantStepView', 'stripControlTags', 'renderBlocks', 'dsh-think-zh-expand']) {
    assert.equal(CODE.includes(banned), false, 'must not contain ' + banned)
  }
  assert.equal(CODE.includes('applyThinkExpand'), true, 'think expand is present')
  assert.ok(CODE.includes('.click'), 'think expand dispatches a real click')
  assert.equal(CODE.includes('applyThinkExpand(el)'), true, 'the scanner calls the think expander')
})

test('client bundle：不内联 mermaid 引擎（走 assets 静态路由）', () => {
  assert.equal(CODE.includes('/md-render/assets/mermaid-10.9.3.min.js'), true, 'engine served from the assets route')
})

test('client bundle：内容渲染完全用插件自己的实现（不碰官方 MarkdownText / CodeBlock）', () => {
  assert.equal(
    CODE.includes('@deepseek-ai/dsh-client-ui-primitives'),
    false,
    '官方 UI 组件库不再被 require（内容渲染 100% 自研）',
  )
  for (const needed of ['function markdownNodes(', 'function CodeBlockView(', 'function ensureRenderAsset(']) {
    assert.ok(CODE.includes(needed), needed + ' 必须在产物里（片段静默丢失是这类构建最典型的故障模式）')
  }
  // 自研渲染器的两个懒加载依赖走 assets 静态路由，**不内联**（用户口径：只控启动速度）。
  assert.equal(CODE.includes('/md-render/assets/marked-18.1.0.umd.js'), true, 'marked 走 assets 懒加载')
  assert.equal(CODE.includes('/md-render/assets/highlightjs-11.12.0.min.js'), true, 'highlight.js 走 assets 懒加载')
  assert.equal(CODE.includes('marked-18.1.0.umd'), true, '构建期注入的 URL 是单一真源的字面量')
})

test('自研 markdown / 代码渲染器不用 innerHTML（模型输出永不被当 HTML 执行）', () => {
  for (const part of ['own-markdown.ts', 'own-code.ts']) {
    const src = stripComments(readFileSync(join(here, '..', 'src', 'client', 'parts', part), 'utf8'))
    assert.equal(src.includes('innerHTML'), false, part + ': 不得出现任何 innerHTML 路径（注释不算）')
  }
  // 产物里唯一允许的 HTML 字符串消费点是 mermaid 引擎产出的 SVG（与官方 CodeBlock 消费 shiki HTML
  // 同款、同为引擎自产）；markdown 与代码路径全部是 vdom，转义交给 React。
  assert.equal((CODE.match(/dangerouslySetInnerHTML/g) ?? []).length, 1, 'only the mermaid svg card')
  assert.equal(CODE.includes('__html: svg'), true, 'the single consumer is the mermaid svg card')
})
