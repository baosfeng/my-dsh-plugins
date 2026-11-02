/**
 * dsh-my-notify 设置面板 v2 的 client 侧契约（task-4 冻结验收 ③）。
 *
 * 覆盖：
 *  - 分区导航渲染（呈现 / 触发与时机 / 文案与变量 / 渠道推送 / 高级与安全）；
 *  - 变量库插入函数（在给定光标处插入 {{name}}，越界收敛）；
 *  - 飞书卡片预览 HTML（给定 card JSON → header 配色 / 标题 / 字段 / 按钮）；
 *  - preview 请求构造（kind + 标题/正文模板 + 卡片）与 300ms 去抖（只发最后一次）；
 *  - toast 位置 / 时长 / 堆叠配置读取（坏值回退默认）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { sleepFor } from '../../dsh-shared/test-kit/wait.mjs'

const read = (name) => fs.readFileSync(new URL(`../lib/parts/${name}.js`, import.meta.url), 'utf8')

function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

/** hooks 桩：多次「渲染」共用状态（与 test/client-contract.mjs 同款语义）。 */
const TEST_PARTS = [
  'prefs',
  'runtime-config',
  'render',
  'audio',
  'toast',
  'card-preview',
  'copy-model',
  'template-editor',
  'var-tree',
  'copy-events',
  'preview-band',
  'copy-editor',
  'card-designer',
  'webhook-editor',
  'webhook-settings',
  'settings-rows',
  'present-pane',
  'secure-pane',
  'panel-styles',
  'panel-compose',
  'panel-preview',
  'panel-drawer',
  'panel',
  'settings-styles',
  'settings',
]

function createHookHarness() {
  const states = []
  let cursor = 0
  const useState = (initial) => {
    const index = cursor
    cursor += 1
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
    return [
      states[index],
      (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      },
    ]
  }
  return {
    useState,
    render(component, props) {
      cursor = 0
      return component(props)
    },
  }
}

/** 展开元素树（调用函数式组件），返回扁平节点列表。 */
function collect(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  const el = typeof node.type === 'function' ? node.type(node.props) : node
  if (el === null || el === undefined) return out
  out.push(el)
  collect(el.props?.children, out)
  return out
}

function textOf(el) {
  const kids = Array.isArray(el.props?.children) ? el.props.children : [el.props?.children]
  return kids.filter((k) => typeof k === 'string').join('')
}

function byClass(tree, className) {
  return collect(tree).find((el) => el.props?.className === className)
}

/** 按 build.mjs 顺序 eval 片段，返回内部符号。 */
function loadParts(names, harness, extra, windowObj, fetchImpl) {
  const sources = [...new Set(['i18n'].concat(TEST_PARTS, names))].map(read)
  const factory = new Function(
    'createElement',
    'useState',
    'useEffect',
    'document',
    'navigator',
    'window',
    'fetch',
    `${sources.join('\n')}\nreturn ${extra}`,
  )
  const documentStub = { documentElement: { lang: 'zh' }, head: { appendChild() {}, removeChild() {} } }
  const win = windowObj !== undefined ? windowObj : {}
  return factory(
    createElement,
    harness.useState,
    () => {},
    documentStub,
    { language: 'zh-CN' },
    win,
    fetchImpl !== undefined
      ? fetchImpl
      : () => {
          throw new Error('unexpected fetch')
        },
  )
}

// ── 1. 分区导航 ────────────────────────────────────────────────────────

test('简版面板 1：标题 + 五事件 tabs + 保存/恢复默认', () => {
  const harness = createHookHarness()
  const { NotifyPanel, defaultConfig } = loadParts([], harness, '{ NotifyPanel, defaultConfig }')
  const tree = harness.render(NotifyPanel, {
    draft: defaultConfig(),
    patch: () => {},
    save: () => {},
    saved: false,
    error: false,
    dirty: true,
    volume: 0.6,
    onVolumeChange: () => {},
    apiToken: '',
    feishuCard: defaultConfig().webhooks?.[0]?.card,
    hasFeishuCard: false,
    onPatchFeishuCard: () => {},
    onTest: () => {},
    onReset: () => {},
  })
  const head = byClass(tree, 'dsh-my-notify-p-head')
  assert.ok(head !== undefined, '新面板顶栏渲染')
  assert.equal(
    collect(head)
      .filter((el) => el.type === 'h1')
      .map(textOf)[0],
    '通知',
    '标题',
  )
  const tabs = collect(byClass(tree, 'dsh-my-notify-p-tabs')).filter((el) => el.type === 'button')
  assert.deepEqual(
    tabs.map(textOf),
    ['需要你回答', '等待你的批准', '会话结束', '子会话结束', '远程提示'],
    '五事件 tabs',
  )
  assert.deepEqual(
    tabs.map((el) => el.props['aria-selected']),
    ['true', 'false', 'false', 'false', 'false'],
  )
  const buttons = collect(byClass(tree, 'dsh-my-notify-p-actions'))
    .filter((el) => el.type === 'button')
    .map(textOf)
  assert.deepEqual(buttons, ['恢复默认文案', '保存更改'], '底栏主操作')
  assert.ok(
    collect(tree).some((el) => el.props?.className === 'dsh-my-notify-p-status' && textOf(el) === '未保存'),
    '未保存状态',
  )
  assert.ok(byClass(tree, 'dsh-my-notify-p-compose') !== undefined, '编辑区渲染')
  assert.ok(byClass(tree, 'dsh-my-notify-p-preview') !== undefined, '卡片预览区渲染')
})

test('工作台 2：文案视图三列结构（事件列表 / 编辑器 / 变量树）+ 底部预览带', () => {
  const harness = createHookHarness()
  const { CopyEditorPane, defaultConfig } = loadParts([], harness, '{ CopyEditorPane, defaultConfig }')
  const pane = harness.render(CopyEditorPane, {
    messages: defaultConfig().messages,
    card: undefined,
    enabledOf: () => true,
    onToggleEvent: () => {},
    saveError: false,
    onRetrySave: () => {},
    onPatchMessage: () => {},
  })
  const cols = byClass(pane, 'dsh-my-notify-cols')
  assert.ok(cols !== undefined, '三列容器渲染')
  const children = (Array.isArray(cols.props.children) ? cols.props.children : [cols.props.children]).filter(
    (c) => c !== null,
  )
  assert.equal(children.length, 3, '三列：事件列表 / 编辑器 / 变量树')
  const evs = collect(pane).filter((el) => el.props?.className === 'dsh-my-notify-evbtn')
  assert.equal(evs.length, 5, '五类事件')
  assert.deepEqual(
    collect(pane)
      .filter((el) => el.props?.className === 'dsh-my-notify-evname')
      .map(textOf),
    ['会话结束', '询问', '审批', '子代理结束', '远程触发'],
    '事件名称',
  )
  assert.equal(evs[0].props['aria-current'], 'true', '默认选中会话结束')
  assert.ok(
    collect(pane).some((el) => String(el.props?.className ?? '').includes('dsh-my-notify-col-vars')),
    '变量树列',
  )
  assert.ok(byClass(pane, 'dsh-my-notify-band') !== undefined, '底部五形态预览带')
  const bandCols = byClass(pane, 'dsh-my-notify-band-cols')
  assert.equal((Array.isArray(bandCols.props.children) ? bandCols.props.children : []).length, 5, '预览带五列')
})

// ── 2. 变量插入 ────────────────────────────────────────────────────────

test('变量库插入：在光标处插入 {{name}} 并返回新光标位', () => {
  const harness = createHookHarness()
  const { insertVar, varToken } = loadParts(['card-preview', 'copy-editor'], harness, '{ insertVar, varToken }')
  assert.equal(varToken('session.title'), '{{session.title}}', '模板语法与服务端一致')
  assert.deepEqual(insertVar('完成', 0, 'session.title'), { value: '{{session.title}}完成', caret: 17 })
  assert.deepEqual(insertVar('完成', 2, 'event.note'), { value: '完成{{event.note}}', caret: 16 }, '插入到末尾')
  // 越界 / 非法光标收敛到末尾
  assert.equal(insertVar('ab', 99, 'tokens.text').value, 'ab{{tokens.text}}')
  assert.equal(insertVar('ab', -5, 'tokens.text').value, '{{tokens.text}}ab')
  assert.equal(insertVar('ab', Number.NaN, 'tokens.text').value, 'ab{{tokens.text}}')
})

test('变量库插入：变量目录规整（分组 / 说明 / 示例，兼容两种外壳）', () => {
  const harness = createHookHarness()
  const { normalizeVarGroups, varCountOf } = loadParts(
    ['card-preview', 'copy-editor'],
    harness,
    '{ normalizeVarGroups, varCountOf }',
  )
  const flat = normalizeVarGroups([
    { group: 'session', label: '会话', items: [{ name: 'session.title', description: '标题', example: '演示' }] },
    { group: 'event', label: '事件', items: [{ name: 'event.note', description: '摘要', example: '' }] },
    { group: '', label: '', items: [] },
  ])
  assert.equal(flat.length, 2, '空分组被丢弃')
  assert.equal(flat[0].label, '会话')
  assert.equal(varCountOf(flat), 2)
  const nested = normalizeVarGroups({
    groups: [{ name: 'g', label: 'G', vars: [{ name: 'a.b', desc: 'D', sample: 'S' }] }],
  })
  assert.deepEqual(nested[0].items, [{ name: 'a.b', description: 'D', example: 'S' }], '兼容 vars/desc/sample 外壳')
  assert.deepEqual(normalizeVarGroups(null), [], '非法输入回退空数组')
})

// ── 3. 飞书卡片预览 ────────────────────────────────────────────────────

const SAMPLE_CARD = {
  schema: '2.0',
  header: { title: { tag: 'plain_text', content: '演示项目' }, template: 'green' },
  body: {
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '会话已结束 · **3m12s**' } },
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: '**Token 消耗**：2,000' } },
          { is_short: true, text: { tag: 'lark_md', content: '**会话耗时**：3m12s' } },
        ],
      },
      {
        tag: 'action',
        actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看会话' }, type: 'primary' }],
      },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '会话已结束 · 22:06' }] },
    ],
  },
}

test('飞书卡片预览：给定 card JSON 输出 header / 标题 / 字段 / 按钮 / 注脚', () => {
  const harness = createHookHarness()
  const { renderFeishuCardHtml, cardAccentOf, cardMetaOf } = loadParts(
    ['card-preview'],
    harness,
    '{ renderFeishuCardHtml, cardAccentOf, cardMetaOf }',
  )
  const html = renderFeishuCardHtml(SAMPLE_CARD)
  assert.ok(html.includes('class="dsh-my-notify-fcard"'), '卡片容器')
  assert.ok(html.includes('data-accent="green"'), 'header 配色来自 card.header.template')
  assert.ok(html.includes('dsh-my-notify-fcard-hd'), '头部彩色条')
  assert.ok(html.includes('dsh-my-notify-fcard-title'), '标题')
  assert.ok(html.includes('演示项目'), '标题文本')
  assert.ok(html.includes('<strong>3m12s</strong>'), '正文 markdown 简化渲染')
  assert.equal(html.match(/dsh-my-notify-fcard-field"/g).length, 2, '两列字段')
  assert.ok(html.includes('Token 消耗') && html.includes('2,000'), '字段标签与值')
  assert.ok(html.includes('data-primary="true"'), '主按钮')
  assert.ok(html.includes('查看会话'), '按钮文案')
  assert.ok(html.includes('dsh-my-notify-fcard-note'), '注脚')
  assert.equal(cardAccentOf({ header: { template: 'red' } }), 'red', '官方 13 色照实渲染')
  assert.equal(cardAccentOf({ header: { template: 'not-a-color' } }), 'grey', '非法配色回退 grey')
  assert.ok(cardMetaOf(SAMPLE_CARD).includes('2 个字段'), '设计器页脚统计字段数')
})

test('飞书卡片预览：文本全量转义（不注入 HTML）', () => {
  const harness = createHookHarness()
  const { renderFeishuCardHtml } = loadParts(['card-preview'], harness, '{ renderFeishuCardHtml }')
  const html = renderFeishuCardHtml({
    header: { title: { content: '<img src=x onerror=alert(1)>' }, template: 'blue' },
    body: { elements: [{ tag: 'div', text: { content: '<script>bad()</script>' } }] },
  })
  assert.ok(!html.includes('<script>'), '脚本标签被转义')
  assert.ok(!html.includes('<img'), '标签被转义')
  assert.ok(html.includes('&lt;script&gt;'), '保留转义后的可见文本')
  const empty = renderFeishuCardHtml(null)
  assert.ok(empty.includes('data-accent="grey"'), '空卡片仍渲染外壳（回退 grey）')
  assert.ok(empty.includes('dsh-my-notify-fcard-bd'), '空卡片保留正文容器')
})

// ── 4. preview 请求构造 + 去抖 ─────────────────────────────────────────

test('preview 请求构造：kind + 标题/正文模板 + 卡片配置', () => {
  const harness = createHookHarness()
  const { previewPayload } = loadParts(['card-preview', 'copy-editor'], harness, '{ previewPayload }')
  const messages = {
    end: { title: '完成 {{session.title}}', body: '用时 {{session.durationText}}' },
    ask: { title: '问', body: '正文' },
  }
  const payload = previewPayload('end', messages, { schemaVersion: '2.0', template: 'green' })
  assert.deepEqual(payload, {
    kind: 'end',
    channel: 'feishu',
    titleTemplate: '完成 {{session.title}}',
    bodyTemplate: '用时 {{session.durationText}}',
    card: { schemaVersion: '2.0', template: 'green' },
  })
  // 缺失事件回退默认模板；渠道可覆盖
  const fallback = previewPayload('approval', undefined, undefined, 'wecom')
  assert.equal(fallback.channel, 'wecom')
  assert.equal(fallback.titleTemplate, '{{session.title}}', '默认标题模板')
  assert.equal(fallback.bodyTemplate, '{{approval.reason}}', '默认正文模板')
  assert.equal(fallback.card, undefined, '无卡片配置时不带 card')
})

test('preview 去抖：300ms 内连续改动只发最后一次请求', async () => {
  const harness = createHookHarness()
  const { createPreviewScheduler } = loadParts(['card-preview', 'copy-editor'], harness, '{ createPreviewScheduler }')
  const sent = []
  const scheduler = createPreviewScheduler((payload) => sent.push(payload), 300)
  scheduler.schedule({ id: 1 })
  scheduler.schedule({ id: 2 })
  scheduler.schedule({ id: 3 })
  assert.equal(sent.length, 0, '去抖窗口内不发请求')
  await sleepFor('300ms 去抖窗口（真实时间语义）', 340)
  assert.deepEqual(sent, [{ id: 3 }], '只发最后一次')
  // cancel 取消挂起请求
  scheduler.schedule({ id: 4 })
  scheduler.cancel()
  await sleepFor('断言 cancel 之后不再发送（负向窗口）', 320)
  assert.equal(sent.length, 1, 'cancel 后不再发送')
  // 默认延迟 300ms（不传参）
  const auto = createPreviewScheduler(() => sent.push({ id: 'auto' }))
  auto.schedule({ id: 'auto' })
  await sleepFor('默认 300ms 去抖窗口（真实时间语义）', 340)
  assert.equal(sent.length, 2, '默认 300ms 生效')
})

// ── 5. toast 位置配置读取 ──────────────────────────────────────────────

test('toast 配置读取：位置 / 时长 / 堆叠 + 坏值回退默认', () => {
  const harness = createHookHarness()
  const { toastConfigOf } = loadParts(['render'], harness, '{ toastConfigOf }')
  assert.deepEqual(
    toastConfigOf({ toast: { enabled: true, durationMs: 8000, position: 'top-left', maxStack: 5 } }),
    { enabled: true, durationMs: 8000, position: 'top-left', maxStack: 5 },
    '读取服务端配置',
  )
  assert.deepEqual(
    toastConfigOf({ toast: { position: 'middle', durationMs: 10, maxStack: 99 } }),
    { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 10 },
    '非法枚举 / 越界回退默认',
  )
  assert.deepEqual(
    toastConfigOf({}),
    { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 },
    '缺失配置用默认值',
  )
  assert.equal(toastConfigOf(null).position, 'bottom-right', 'null 配置不抛错')
  assert.equal(toastConfigOf({ toast: { enabled: false } }).enabled, false, '关闭态可读')
})

test('音色合成：三种音色的振荡器参数（chime 单音 / drop 双音 / deep 低音）', () => {
  const harness = createHookHarness()
  const { toneSpecs } = loadParts(['render'], harness, '{ toneSpecs }')
  assert.deepEqual(toneSpecs('chime'), { wave: 'sine', notes: [880], gap: 0, length: 0.22 })
  assert.deepEqual(toneSpecs('drop'), { wave: 'sine', notes: [1040, 780], gap: 0.11, length: 0.2 })
  assert.deepEqual(toneSpecs('deep'), { wave: 'triangle', notes: [320], gap: 0, length: 0.36 })
  assert.deepEqual(toneSpecs('unknown'), toneSpecs('chime'), '未知音色回退 chime')
})

// ── 6. 开关与运行时语义（必修 2）──────────────────────────────────────

/** 内存 localStorage 桩（记录写入的本地开关）。 */
function createStorageStub(initial) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

/** 渲染呈现分区（含 window.localStorage 桩），返回 { tree, patched }。 */
function renderPresent(storage) {
  const harness = createHookHarness()
  const { renderPresentPane, defaultConfig } = loadParts(
    ['card-preview', 'copy-editor', 'webhook-settings', 'settings'],
    harness,
    '{ renderPresentPane, defaultConfig }',
    { localStorage: storage },
  )
  const patched = []
  const tree = renderPresentPane(
    defaultConfig(),
    (key, value) => patched.push([key, value]),
    0.6,
    () => {},
  )
  const toggles = collect(tree).filter((el) => el.props?.className === 'dsh-my-notify-toggle')
  return { tree, patched, toggles, byLabel: (label) => toggles.find((el) => el.props['aria-label'] === label) }
}

test('必修 2a：桌面通知开关同时写 config.system.enabled 与 localStorage（运行时 gate）', () => {
  const storage = createStorageStub()
  const view = renderPresent(storage)
  const desk = view.byLabel('桌面通知')
  assert.ok(desk !== undefined, '桌面通知开关存在')
  assert.equal(desk.props['aria-checked'], 'true', '默认开')
  desk.props.onClick()
  assert.deepEqual(view.patched[0], ['system', { enabled: false, requireInteraction: false }], '写 config.system')
  assert.equal(storage.map.get('dsh-notify:notify'), '0', '同时写 localStorage 运行时 gate')
})

test('必修 2a：进面板时以 localStorage 为准回显（避免面板显示开、实际不弹）', () => {
  const storage = createStorageStub({ 'dsh-notify:notify': '0' })
  const view = renderPresent(storage)
  assert.equal(view.byLabel('桌面通知').props['aria-checked'], 'false', 'LS 关闭时回显关')
})

test('必修 2c：提示音开关同时写 config.sound.enabled 与 localStorage', () => {
  const storage = createStorageStub()
  const view = renderPresent(storage)
  const sound = view.byLabel('启用提示音')
  assert.ok(sound !== undefined, '提示音开关存在')
  sound.props.onClick()
  assert.deepEqual(view.patched[0], ['sound', { enabled: false, preset: 'chime', volume: 0.6 }], '写 config.sound')
  assert.equal(storage.map.get('dsh-notify:sound'), '0', '同时写 localStorage（否则永久静音）')
  // LS 关闭时回显关
  const off = renderPresent(createStorageStub({ 'dsh-notify:sound': '0' }))
  assert.equal(off.byLabel('启用提示音').props['aria-checked'], 'false')
})

test('必修 2b/2d：张冠李戴的「点击跳转」与假控件「鼠标悬停」已移除', () => {
  const view = renderPresent(createStorageStub())
  const labels = collect(view.tree)
    .map((el) => el.props && el.props['aria-label'])
    .filter((label) => typeof label === 'string')
  assert.ok(labels.includes('桌面通知') && labels.includes('启用提示音'), '真实开关仍在')
  assert.ok(!labels.includes('点击跳转'), '「点击跳转」不再以 LS.notify 冒充')
  assert.ok(!labels.includes('鼠标悬停'), '「鼠标悬停」假控件已删')
  const texts = collect(view.tree)
    .map((el) => el.props && el.props.children)
    .flat()
    .filter((item) => typeof item === 'string')
  assert.ok(!texts.includes('鼠标悬停'), '鼠标悬停文案也不残留')
})

test('开关键盘可达：role=switch 支持 Enter / Space', () => {
  const storage = createStorageStub()
  const view = renderPresent(storage)
  const desk = view.byLabel('桌面通知')
  let prevented = 0
  desk.props.onKeyDown({ key: 'Enter', preventDefault: () => (prevented += 1) })
  assert.equal(prevented, 1, 'Enter 触发并阻止默认行为')
  assert.equal(view.patched.length, 1, 'Enter 切换一次')
  desk.props.onKeyDown({ key: 'a' })
  assert.equal(view.patched.length, 1, '其他按键不触发')
})

// ── 7. 预览失败态（必修 4）──────────────────────────────────────────────

test('必修 4：预览状态机（idle / loading / error + 重试）', () => {
  const harness = createHookHarness()
  const { previewNoticeOf } = loadParts(['card-preview', 'copy-editor'], harness, '{ previewNoticeOf }')
  const failed = previewNoticeOf('error')
  assert.equal(failed.retry, true, '失败态给重试')
  assert.equal(failed.kind, 'error')
  assert.ok(failed.text.includes('预览生成失败'), '失败文案可见，不静默空白')
  const loading = previewNoticeOf('loading')
  assert.equal(loading.retry, false)
  assert.ok(loading.text.includes('预览生成中'), '加载态文案')
  assert.equal(previewNoticeOf('ready').text, '', '就绪态不显示提示')
  assert.ok(previewNoticeOf('idle').text.length > 0, '未请求时给引导文案（不是空白）')
})

test('工作台 3：预览带未就绪时给提示（不是空白舞台）', () => {
  const harness = createHookHarness()
  const { CopyEditorPane, defaultConfig } = loadParts([], harness, '{ CopyEditorPane, defaultConfig }')
  const pane = harness.render(CopyEditorPane, {
    messages: defaultConfig().messages,
    card: undefined,
    enabledOf: () => true,
    onToggleEvent: () => {},
    saveError: false,
    onRetrySave: () => {},
    onPatchMessage: () => {},
  })
  const band = byClass(pane, 'dsh-my-notify-band')
  assert.equal(band.props['data-open'], 'true', '预览带默认展开')
  const toggle = collect(band).find((el) => el.props?.['aria-expanded'] !== undefined)
  assert.ok(toggle !== undefined, '提供折叠按钮')
  assert.ok(
    collect(pane).some((el) => el.props?.className === 'dsh-my-notify-status'),
    '未就绪时显示状态文案',
  )
})

test('必修 2：进面板播种本地开关（缺失时写，已有值不被覆盖）', () => {
  const harness = createHookHarness()
  const empty = createStorageStub()
  const api = loadParts(
    ['render', 'card-preview', 'copy-editor', 'webhook-settings', 'settings'],
    harness,
    '{ syncPrefsFromConfig }',
    {
      localStorage: empty,
    },
  )
  api.syncPrefsFromConfig({
    system: { enabled: true, requireInteraction: false },
    sound: { enabled: false, preset: 'chime', volume: 0.6 },
    toast: { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 },
  })
  assert.equal(empty.map.get('dsh-notify:notify'), '1', '播种系统通知开关')
  assert.equal(empty.map.get('dsh-notify:sound'), '0', '播种提示音开关（跟随 config）')
  assert.equal(empty.map.get('dsh-notify:toast'), '1', '播种 toast 开关')

  // 已有本地选择不被覆盖
  const kept = createStorageStub({ 'dsh-notify:sound': '1' })
  const api2 = loadParts(
    ['render', 'card-preview', 'copy-editor', 'webhook-settings', 'settings'],
    harness,
    '{ syncPrefsFromConfig }',
    {
      localStorage: kept,
    },
  )
  api2.syncPrefsFromConfig({ sound: { enabled: false, preset: 'chime', volume: 0.6 } })
  assert.equal(kept.map.get('dsh-notify:sound'), '1', '用户现场选择优先')
})

// ── 8. C1 音量：双写 + 回退 ─────────────────────────────────────────────

test('C1 音量回退：prefNum 本地键优先，缺失 / 非法回退服务端配置', () => {
  const harness = createHookHarness()
  const api = loadParts(['render'], harness, '{ prefNum }', {
    localStorage: createStorageStub({ 'dsh-notify:volume': '0.35' }),
  })
  assert.equal(api.prefNum('dsh-notify:volume', 0.6), 0.35, '本地键优先')
  const empty = loadParts(['render'], harness, '{ prefNum }', { localStorage: createStorageStub() })
  assert.equal(empty.prefNum('dsh-notify:volume', 0.25), 0.25, '缺失时回退服务端音量')
  const bad = loadParts(['render'], harness, '{ prefNum }', {
    localStorage: createStorageStub({ 'dsh-notify:volume': 'x' }),
  })
  assert.equal(bad.prefNum('dsh-notify:volume', 0.4), 0.4, '非法值回退')
  const over = loadParts(['render'], harness, '{ prefNum }', {
    localStorage: createStorageStub({ 'dsh-notify:volume': '2' }),
  })
  assert.equal(over.prefNum('dsh-notify:volume', 0.4), 0.4, '越界回退')
  assert.equal(empty.prefNum('dsh-notify:volume', 9), 0.6, 'fallback 本身非法时回退 0.6')
})

test('C1 音量滑杆：onChange 双写 config.sound.volume 与 localStorage', () => {
  const storage = createStorageStub()
  const view = renderPresent(storage)
  const slider = collect(view.tree).find((el) => el.type === 'input' && el.props?.type === 'range')
  assert.ok(slider !== undefined, '音量滑杆渲染')
  assert.equal(slider.props.value, '0.6', '默认回显 config.sound.volume')
  assert.ok(slider.props['aria-label'].includes('音量'), '滑杆可读名')
  slider.props.onChange({ target: { value: '0.3' } })
  assert.deepEqual(
    view.patched[0],
    ['sound', { enabled: true, preset: 'chime', volume: 0.3 }],
    '写 config.sound.volume',
  )
  assert.equal(storage.map.get('dsh-notify:volume'), '0.3', '同时写 localStorage（beep 实际取值）')
})

test('C1 音量回显：本地键优先于 config.sound.volume', () => {
  const view = renderPresent(createStorageStub({ 'dsh-notify:volume': '0.2' }))
  const slider = collect(view.tree).find((el) => el.type === 'input' && el.props?.type === 'range')
  assert.equal(slider.props.value, '0.2', '本地键优先回显')
})

// ── 9. C2 常驻通知真正透传 ─────────────────────────────────────────────

test('C2 requireInteraction：配置解析 + 真正传给 Notification 构造', () => {
  const harness = createHookHarness()
  const api = loadParts(['render'], harness, '{ systemConfigOf, applyRuntimeConfig, fireSystemNotification }', {
    localStorage: createStorageStub(),
  })
  assert.deepEqual(api.systemConfigOf({ system: { requireInteraction: true } }), {
    enabled: true,
    requireInteraction: true,
  })
  assert.equal(
    api.systemConfigOf({ system: { requireInteraction: 'yes' } }).requireInteraction,
    false,
    '坏值回退 false',
  )
  assert.equal(api.systemConfigOf({}).requireInteraction, false, '缺失回退 false')

  const captured = []
  const original = global.Notification
  global.Notification = class {
    constructor(title, options) {
      captured.push({ title, options })
    }
    close() {}
  }
  try {
    api.applyRuntimeConfig({ system: { enabled: true, requireInteraction: true } })
    api.fireSystemNotification({ kind: 'end', sessionId: 's1', title: '会话结束', note: '完成' }, 's1', () => {})
    assert.equal(captured.length, 1, '构造一条系统通知')
    assert.equal(captured[0].options.requireInteraction, true, '常驻选项真正传入')
    // 配置为 false 时不常驻
    api.applyRuntimeConfig({ system: { enabled: true, requireInteraction: false } })
    api.fireSystemNotification({ kind: 'end', sessionId: 's2', title: 'T', note: 'n' }, 's2', () => {})
    assert.equal(captured[1].options.requireInteraction, false)
  } finally {
    if (original === undefined) delete global.Notification
    else global.Notification = original
  }
})

// ── 10. C3 启动播种（gate 统一读本地键）────────────────────────────────

test('C3 启动播种：缺失键按服务端配置写入（system / sound / toast / volume）', () => {
  const harness = createHookHarness()
  const storage = createStorageStub()
  const api = loadParts(['render'], harness, '{ applyRuntimeConfig }', { localStorage: storage })
  api.applyRuntimeConfig({
    system: { enabled: false, requireInteraction: false },
    sound: { enabled: false, preset: 'deep', volume: 0.25 },
    toast: { enabled: false, durationMs: 5000, position: 'top-left', maxStack: 2 },
  })
  assert.equal(storage.map.get('dsh-notify:notify'), '0', 'system.enabled=false 播种为关')
  assert.equal(storage.map.get('dsh-notify:sound'), '0', 'sound.enabled=false 播种为关')
  assert.equal(storage.map.get('dsh-notify:toast'), '0', 'toast.enabled=false 播种为关')
  assert.equal(storage.map.get('dsh-notify:volume'), '0.25', '音量播种为 config.sound.volume')
})

test('C3 启动播种：已有本地键不被覆盖', () => {
  const harness = createHookHarness()
  const storage = createStorageStub({ 'dsh-notify:sound': '1', 'dsh-notify:volume': '0.9' })
  const api = loadParts(['render'], harness, '{ applyRuntimeConfig }', { localStorage: storage })
  api.applyRuntimeConfig({ sound: { enabled: false, preset: 'chime', volume: 0.2 }, system: { enabled: false } })
  assert.equal(storage.map.get('dsh-notify:sound'), '1', '用户现场选择优先')
  assert.equal(storage.map.get('dsh-notify:volume'), '0.9', '已有音量不被覆盖')
  assert.equal(storage.map.get('dsh-notify:notify'), '0', '缺失键仍然播种')
})

test('C3 gate 统一：播种为关后 beep 不响（新浏览器 + 服务端关闭）', async () => {
  const harness = createHookHarness()
  const ramps = []
  const audio = {
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
    createGain: () => ({
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime(v) {
          ramps.push(v)
        },
      },
    }),
  }
  const storage = createStorageStub()
  const api = loadParts(['render'], harness, '{ applyRuntimeConfig, beep }', {
    localStorage: storage,
    AudioContext: function () {
      return audio
    },
  })
  api.applyRuntimeConfig({ sound: { enabled: false, preset: 'chime', volume: 0.6 } })
  api.beep()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(ramps.length, 0, '播种为关后不产生任何增益包络（不响）')
})

// ── 11. 界面评审：字段集一致性 / 远程测试终态 / 触达 / 色彩 / 字号 ────────

test('一致性 1：默认卡片 5 个字段，勾选 / 导出 / 预览共用同一有序数组', () => {
  const harness = createHookHarness()
  const { cardFieldsOf, defaultCard } = loadParts(
    ['card-preview', 'card-designer'],
    harness,
    '{ cardFieldsOf, defaultCard }',
  )
  const blank = defaultCard()
  assert.equal(blank.fields.length, 5, '默认勾选 5 项')
  assert.ok(blank.fields.includes('ask.question'), '含「问题」字段')
  assert.deepEqual(cardFieldsOf(blank), blank.fields, '勾选状态与导出 card.fields 完全一致')
  // 按勾选顺序生成：先取消「问题」再勾回，顺序变成末位
  const reordered = { ...blank, fields: ['session.url', 'tokens.text', 'ask.question'] }
  assert.deepEqual(cardFieldsOf(reordered), ['session.url', 'tokens.text', 'ask.question'], '保持勾选顺序')
  // 未知字段被丢弃，重复项去重
  assert.deepEqual(cardFieldsOf({ fields: ['ask.question', 'ask.question', 'nope'] }), ['ask.question'])
  assert.deepEqual(cardFieldsOf(undefined), [], '无配置时为空（不静默塞默认）')
})

test('一致性 1：设计器渲染 5 个勾选框且全部勾选', () => {
  const harness = createHookHarness()
  const { WebhookDesigner, defaultCard, emptyWebhook } = loadParts(
    ['card-preview', 'card-designer'],
    harness,
    '{ WebhookDesigner, defaultCard, emptyWebhook }',
  )
  const draft = { ...emptyWebhook(), channel: 'feishu', msgType: 'interactive', card: defaultCard() }
  const tree = harness.render(WebhookDesigner, { draft, onChange: () => {} })
  const boxes = collect(tree).filter((el) => el.type === 'input' && el.props?.type === 'checkbox')
  // 6 个候选字段（含未勾选的「时间」）+ 「按事件自动」+ 「@所有人」= 8 个复选框
  assert.equal(boxes.length, 8, '6 候选字段 + 自适应配色 + @所有人')
  assert.equal(boxes.filter((el) => el.props.checked === true).length, 6, '默认勾选 5 字段 + 自适应配色')
  assert.equal(boxes.filter((el) => el.props.checked === false).length, 2, '「时间」与「@所有人」默认未勾选')
})

test('事实 2：远程测试四态（未发送 → 发送中 → 成功 / 失败原因 / 8s 超时）', () => {
  const harness = createHookHarness()
  const { testLineOf } = loadParts(['secure-pane'], harness, '{ testLineOf }')
  assert.equal(testLineOf('unsent', ''), '未发送')
  assert.equal(testLineOf('sending', ''), '发送中…')
  assert.equal(testLineOf('ok', ''), '已发送')
  assert.ok(testLineOf('fail', 'ECONNREFUSED').startsWith('发送失败'), '失败终态')
  assert.ok(testLineOf('fail', 'ECONNREFUSED').includes('ECONNREFUSED'), '失败带原因')
  assert.equal(testLineOf('timeout', ''), '发送超时（8s）')
})

test('触达 4：窄容器降级（容器查询 <860）+ 触达 44', () => {
  const harness = createHookHarness()
  const { SETTINGS_STYLES } = loadParts(['settings-styles'], harness, '{ SETTINGS_STYLES }')
  assert.ok(SETTINGS_STYLES.includes('container-type:inline-size'), '根节点开启容器查询')
  assert.ok(SETTINGS_STYLES.includes('@container (max-width: 859px)'), '窄容器断点 859')
  const narrow = SETTINGS_STYLES.slice(SETTINGS_STYLES.indexOf('@container (max-width: 859px)'))
  assert.ok(/\.dsh-my-notify-cols\{[^}]*grid-template-columns:minmax\(0,1fr\)/.test(narrow), '三列降为单列')
  assert.ok(/\.dsh-my-notify-col-evlist[^{]*\{[^}]*display:none/.test(narrow), '事件列表收起')
  assert.ok(/\.dsh-my-notify-band-cols\{[^}]*repeat\(3/.test(narrow), '预览带 3 列 + 横向滚动')
  assert.ok(SETTINGS_STYLES.includes('@media (max-width: 900px)'), '窄视口触达规则')
  assert.ok(/\.dsh-my-notify-toggle\{min-height:44px\}/.test(SETTINGS_STYLES), '开关 44 高')
})

test('色彩 5：卡片文字/按钮对比度 ≥ 4.5:1（品牌色自定义属性）', () => {
  const harness = createHookHarness()
  const { CARD_PALETTE } = loadParts(['card-preview'], harness, '{ CARD_PALETTE }')
  const lum = (hex) => {
    const c = hex
      .replace('#', '')
      .match(/../g)
      .map((h) => {
        const v = parseInt(h, 16) / 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => {
    const l1 = lum(a)
    const l2 = lum(b)
    const hi = Math.max(l1, l2)
    const lo = Math.min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
  }
  const bg = CARD_PALETTE['--fcard-bg']
  for (const key of ['--fcard-fg', '--fcard-fg2', '--fcard-btn']) {
    assert.ok(ratio(CARD_PALETTE[key], bg) >= 4.5, key + ' 与卡片底色对比度不足 4.5:1')
  }
  assert.ok(ratio('#ffffff', CARD_PALETTE['--fcard-btn']) >= 4.5, '按钮白字压品牌蓝底 ≥ 4.5:1')
})

test('字号 6：样式只用 --dsw-font-* token（无字面字号，正文 ≥12px）', () => {
  const harness = createHookHarness()
  const { SETTINGS_STYLES, CARD_PREVIEW_STYLES } = loadParts(
    ['card-preview', 'settings-styles'],
    harness,
    '{ SETTINGS_STYLES, CARD_PREVIEW_STYLES }',
  )
  const css = SETTINGS_STYLES + CARD_PREVIEW_STYLES
  assert.equal(/font-size:/.test(css), false, '不写字面 font-size')
  const fonts = [...css.matchAll(/font:var\((--[\w-]+)\)/g)].map((m) => m[1])
  assert.ok(
    fonts.every((token) => token.startsWith('--dsw-font-')),
    '字号全部来自宿主 token',
  )
})

// ── 12. askMode 回退补齐 + 一致性核对 ──────────────────────────────────

test('必修：询问事件编辑器带 askMode 分段控件，切换写回 draft.askMode', () => {
  const harness = createHookHarness()
  const { CopyEditorPane, defaultConfig } = loadParts([], harness, '{ CopyEditorPane, defaultConfig }')
  const patched = []
  let askMode = 'full'
  const render = () =>
    harness.render(CopyEditorPane, {
      messages: defaultConfig().messages,
      card: undefined,
      enabledOf: () => true,
      onToggleEvent: () => {},
      askMode,
      onAskMode: (mode) => {
        askMode = mode
        patched.push(['askMode', mode])
      },
      onPatchMessage: () => {},
    })
  // 默认 end 事件不显示分段控件
  assert.equal(
    collect(render()).filter((el) => el.props?.['data-role'] === 'ask-mode').length,
    0,
    'end 无 askMode 控件',
  )
  // 切到「询问」
  collect(render())
    .find((el) => el.props?.className === 'dsh-my-notify-evbtn' && textOf(el) === '')
    .props.onClick()
  const askBtn = collect(render()).filter((el) => el.props?.className === 'dsh-my-notify-evbtn')[1]
  askBtn.props.onClick()
  const control = byClass(render(), 'dsh-my-notify-ed')
  assert.ok(control !== undefined, '编辑器渲染')
  const segs = collect(render()).filter((el) => el.props?.['data-role'] === 'ask-mode')
  assert.equal(segs.length, 1, '询问事件显示 askMode 分段控件')
  const tabs = collect(segs[0]).filter((el) => el.props?.className === 'dsh-my-notify-seg')
  assert.deepEqual(tabs.map(textOf), ['完整问题 + 选项', '仅摘要'], '两种模式')
  assert.equal(tabs[0].props['aria-selected'], 'true', '默认完整问题')
  tabs[1].props.onClick()
  assert.deepEqual(patched[0], ['askMode', 'summary'], '切换到摘要写回 config.askMode')
})

test('必修：保存 PUT 载荷带 askMode 字段', async () => {
  const harness = createHookHarness()
  const captured = []
  const fetchStub = (url, init) => {
    captured.push({ url, body: init.body })
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
  }
  const { saveConfig, defaultConfig } = loadParts(
    ['settings-rows'],
    harness,
    '{ saveConfig, defaultConfig }',
    undefined,
    fetchStub,
  )
  const draft = { ...defaultConfig(), askMode: 'summary' }
  saveConfig(
    draft,
    () => {},
    () => {},
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(captured[0].url, '/notify/api/config')
  const payload = JSON.parse(captured[0].body)
  assert.equal(payload.askMode, 'summary', 'PUT 载荷含 askMode=summary')
})

test('核对 1/3：预览带正文 ≥12px、变量名 12 / 说明 11（层级不倒挂）', () => {
  const harness = createHookHarness()
  const { SETTINGS_STYLES } = loadParts(['settings-styles'], harness, '{ SETTINGS_STYLES }')
  const css = SETTINGS_STYLES
  const body = css.slice(css.indexOf('.dsh-my-notify-pv-sys-body{'), css.indexOf('.dsh-my-notify-pv-sys-time{'))
  assert.ok(body.includes('var(--dsw-font-xxs-12)'), '预览带正文 12px token（>11.5）')
  assert.ok(body.includes('-webkit-line-clamp'), '正文截断用 line-clamp 带省略号')
  assert.ok(body.includes('text-overflow:ellipsis'), '省略号')
  const name = css.slice(css.indexOf('.dsh-my-notify-vname{'), css.indexOf('.dsh-my-notify-vdesc{'))
  const desc = css.slice(css.indexOf('.dsh-my-notify-vdesc{'), css.indexOf('.dsh-my-notify-vdesc{') + 180)
  assert.ok(name.includes('var(--dsw-font-xxs-strong-12)'), '变量名 12px')
  assert.ok(desc.includes('var(--dsw-font-xxxs-11)'), '说明 11px（低于变量名）')
})

test('核对 2：长变量名 nowrap + 省略号 + title 全名', () => {
  const harness = createHookHarness()
  const { VariableTree, SETTINGS_STYLES } = loadParts(
    ['var-tree', 'settings-styles'],
    harness,
    '{ VariableTree, SETTINGS_STYLES }',
  )
  const tree = harness.render(VariableTree, {
    groups: [
      {
        group: 'approval',
        label: '审批',
        items: [{ name: 'approval.reasonLocalized', description: '审批原因', example: '等待批准' }],
      },
    ],
    onInsert: () => {},
  })
  const chip = collect(tree).find((el) => el.props?.className === 'dsh-my-notify-vchip')
  assert.ok(chip.props.title.includes('approval.reasonLocalized'), 'title 带变量全名（不截断）')
  assert.equal(
    textOf(collect(chip).find((el) => el.props?.className === 'dsh-my-notify-vname')),
    'approval.reasonLocalized',
  )
  const rule = SETTINGS_STYLES.slice(
    SETTINGS_STYLES.indexOf('.dsh-my-notify-vname{'),
    SETTINGS_STYLES.indexOf('.dsh-my-notify-vdesc{'),
  )
  assert.ok(rule.includes('white-space:nowrap') && rule.includes('text-overflow:ellipsis'), 'nowrap + 省略号')
})

test('核对 4：预览带 hint 说明标题只进四处（企微无标题）', () => {
  const harness = createHookHarness()
  const { CopyEditorPane, defaultConfig } = loadParts([], harness, '{ CopyEditorPane, defaultConfig }')
  const pane = harness.render(CopyEditorPane, {
    messages: defaultConfig().messages,
    card: undefined,
    enabledOf: () => true,
    onToggleEvent: () => {},
    onPatchMessage: () => {},
  })
  const hint = collect(pane)
    .filter((el) => el.props?.className === 'dsh-my-notify-hint')
    .map(textOf)
    .join(' ')
  assert.ok(hint.includes('正文五处联动'), '正文 5/5')
  assert.ok(hint.includes('标题'), '标题口径单独说明')
  assert.equal(hint.includes('五处同时变'), false, '不再写「五处同时变」')
})

test('核对 5：变量搜索框 宽容器 ≥28 / 窄容器（<860）≥44', () => {
  const harness = createHookHarness()
  const { SETTINGS_STYLES } = loadParts(['settings-styles'], harness, '{ SETTINGS_STYLES }')
  const base = SETTINGS_STYLES.slice(
    SETTINGS_STYLES.indexOf('.dsh-my-notify-varq{'),
    SETTINGS_STYLES.indexOf('.dsh-my-notify-varq{') + 200,
  )
  assert.ok(/height:28px|min-height:28px/.test(base), '宽容器 28')
  const narrow = SETTINGS_STYLES.slice(SETTINGS_STYLES.indexOf('@container (max-width: 859px){'))
  assert.ok(/\.dsh-my-notify-varq\{min-height:44px\}/.test(narrow), '窄容器 44')
})
