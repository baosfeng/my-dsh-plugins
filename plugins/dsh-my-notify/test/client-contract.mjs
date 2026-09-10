/**
 * 构建契约 + client 行为契约（TS 迁移防回归，issue: client 端迁移 TypeScript）。
 *
 * 覆盖两类此前无测试锁定的契约：
 *
 * 1. 构建契约（源码与产物同步，TS升级规范 6.2）：
 *    - 提交进仓库的 `lib/client.js` 必须**逐字节**等于 `lib/client.src.js` 模板
 *      拼接 `lib/parts/*.js` 片段的结果 —— 只改产物不改模板/片段（或反之）
 *      立即失败（历史上出现过「只改产物，下次构建即丢失」）；
 *    - 产物零未解析 `__PART_*__` 占位符；
 *    - 每个已发布片段都对应 `src/client/parts/<name>.ts` 源码，且二者的顶层
 *      声明（function/const 名）一致 —— 只改 `lib/parts/*.js` 不改 TS 源码
 *      会被这条抓住（产物是 tsc 输出，源码才是唯一真相）；
 *    - TS 片段不得出现 import/export（DSH ModuleLoader 不支持 factory 内相对
 *      路径 require，必须拼成单 bundle）。
 *
 * 2. 出站 webhook 设置面板（issue #92）行为契约：空模板默认值、渠道/事件/
 *    消息类型标签、添加流程（编辑 → 保存 → onPatchWebhooks 追加）、删除/启用
 *    切换、失败记录渲染 —— 此前无任何测试覆盖（设置面板是纯 client 逻辑）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 已发布片段（build.mjs 的 pieces 顺序：i18n 先于 render，webhook 先于 settings）。 */
const PIECES = [
  ['/*__PART_I18N__*/', 'lib/parts/i18n.js'],
  ['/*__PART_ICONS__*/', '../dsh-shared/client-parts/icons.part.js'],
  ['/*__PART_NOTIFY_RENDER__*/', 'lib/parts/render.js'],
  ['/*__PART_STREAM__*/', 'lib/parts/stream.js'],
  ['/*__PART_WEBHOOK_SETTINGS__*/', 'lib/parts/webhook-settings.js'],
  ['/*__PART_SETTINGS__*/', 'lib/parts/settings.js'],
]

/** 本插件自己的片段（icons 为 dsh-shared 共享片段，无 TS 源码）。 */
const OWN_PARTS = PIECES.filter(([, file]) => file.startsWith('lib/parts/')).map(([, file]) =>
  file.replace('lib/parts/', '').replace('.js', ''),
)

/** 片段顶层声明名（function foo / const foo），用于锁定「产物来自 TS 源码」。 */
function topLevelDecls(src) {
  return [...src.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*))/gm)]
    .map((m) => m[1] ?? m[2])
    .sort()
}

// ── React / DOM 桩（与 test/client-parts.mjs 同款语义）──────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

/** 最小 hooks 桩：支持多次「渲染」（每次渲染重置 hook 游标）。 */
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

/** 展开 React 元素树（调用函数式组件），返回扁平节点列表。 */
function collect(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  const el = typeof node.type === 'function' ? node.type(node.props) : node
  out.push(el)
  collect(el.props?.children, out)
  return out
}

/** 元素文本（直接字符串子节点拼接）。 */
function textOf(el) {
  const kids = Array.isArray(el.props?.children) ? el.props.children : [el.props?.children]
  return kids.filter((k) => typeof k === 'string').join('')
}

/** 按 className 找元素。 */
function byClass(tree, className) {
  return collect(tree).find((el) => el.props?.className === className)
}

/** 按文本找按钮。 */
function buttonByText(tree, label) {
  return collect(tree).find((el) => el.type === 'button' && textOf(el) === label)
}

/** Eval i18n + webhook-settings 片段并返回内部符号（工厂作用域模拟）。 */
function loadWebhookPanel(navigatorMock) {
  const harness = createHookHarness()
  const factory = new Function(
    'createElement',
    'useState',
    'navigator',
    'window',
    `${read('../lib/parts/i18n.js')}\n${read('../lib/parts/webhook-settings.js')}\n` +
      'return { emptyWebhook, channelLabel, eventsLabel, msgTypeOptions, WebhookSection, WebhookEditor, FailureRow, CHANNEL_OPTIONS, EVENT_OPTIONS, strings }',
  )
  const api = factory(createElement, harness.useState, navigatorMock, { localStorage: {} })
  return { ...api, harness }
}

/** Eval i18n 片段（语言切换契约）。 */
function loadI18n(navigatorMock) {
  const factory = new Function('navigator', `${read('../lib/parts/i18n.js')}\nreturn { strings, isZh }`)
  return factory(navigatorMock)
}

// ── 1. 构建契约 ────────────────────────────────────────────────────────

test('构建契约：lib/client.js 必须等于 lib/client.src.js 模板 + lib/parts/*.js 片段拼接结果', () => {
  let expected = read('../lib/client.src.js')
  for (const [placeholder, file] of PIECES) {
    assert.ok(expected.includes(placeholder), `lib/client.src.js 缺少 ${placeholder} 占位符`)
    const part = read(`../${file}`)
    // 函数式替换：片段里的 $&/$1 不作特殊解释（与 scripts/build.mjs 一致）
    expected = expected.replaceAll(placeholder, () => part)
  }
  const actual = read('../lib/client.js')
  assert.equal(actual, expected, 'lib/client.js 与「模板 + 片段」不一致：源码/产物不同步，请 npm run build 并提交产物')
})

test('构建契约：产物零未解析占位符，且每个片段都有对应 TS 源码（迁移口径）', () => {
  const bundle = read('../lib/client.js')
  assert.ok(!bundle.includes('/*__PART_'), 'lib/client.js 里仍有未解析的 __PART_*__ 占位符')
  for (const name of OWN_PARTS) {
    const ts = read(`../src/client/parts/${name}.ts`)
    const js = read(`../lib/parts/${name}.js`)
    assert.deepEqual(
      topLevelDecls(ts),
      topLevelDecls(js),
      `${name}: src/client/parts/${name}.ts 与产物 lib/parts/${name}.js 的顶层声明必须一致（只改产物会被下次构建覆盖）`,
    )
    assert.ok(
      !/^\s*(?:import|export)\s/m.test(ts),
      `${name}.ts 不得有 import/export：片段共享 factory 作用域，DSH ModuleLoader 不支持相对路径 require`,
    )
    assert.ok(ts.includes('function') || ts.includes('const'), `${name}.ts 应为纯声明片段`)
  }
  assert.deepEqual(OWN_PARTS.slice().sort(), ['i18n', 'render', 'settings', 'stream', 'webhook-settings'].sort())
})

// ── 2. i18n 文案契约 ──────────────────────────────────────────────────

test('i18n 契约：中文/英文两套文案 + 未知语言回退英文', () => {
  const zh = loadI18n({ language: 'zh-CN' })
  assert.equal(zh.strings.openSession(), '打开会话')
  assert.equal(zh.strings.closeToast(), '关闭通知')
  assert.equal(zh.strings.settingsTitle(), '通知提醒')
  assert.equal(zh.strings.webhookAdd(), '添加 Webhook')
  assert.equal(zh.strings.untitled('abc12345'), '会话 abc12345')
  assert.equal(zh.strings.untitled(''), '会话')

  const en = loadI18n({ language: 'en-US' })
  assert.equal(en.strings.openSession(), 'Open session')
  assert.equal(en.strings.closeToast(), 'Dismiss notification')
  assert.equal(en.strings.settingsTitle(), 'Notifications')
  assert.equal(en.strings.webhookAdd(), 'Add webhook')
  assert.equal(en.strings.untitled('abc12345'), 'Session abc12345')
  assert.equal(en.strings.untitled(''), 'Session')

  // 无 navigator / 语言缺失 → 回退英文（不抛异常）
  const none = loadI18n(undefined)
  assert.equal(none.isZh(), false)
  assert.equal(none.strings.openSession(), 'Open session')
})

// ── 3. 出站 webhook 设置面板契约（issue #92）────────────────────────────

test('webhook 面板：空模板默认值与渠道/事件/消息类型标签', () => {
  const { emptyWebhook, channelLabel, eventsLabel, msgTypeOptions, CHANNEL_OPTIONS, EVENT_OPTIONS } = loadWebhookPanel({
    language: 'zh-CN',
  })

  assert.deepEqual(emptyWebhook(), {
    name: '',
    channel: 'wecom',
    url: '',
    secret: '',
    events: ['end', 'ask', 'approval'],
    enabled: true,
    msgType: 'text',
    template: '',
  })
  assert.deepEqual(
    CHANNEL_OPTIONS.map((o) => o.value),
    ['wecom', 'feishu', 'dingtalk', 'generic'],
  )
  assert.deepEqual(
    EVENT_OPTIONS.map((o) => o.value),
    ['end', 'ask', 'approval', 'remote'],
  )
  assert.equal(channelLabel('wecom'), '企业微信')
  assert.equal(channelLabel('feishu'), '飞书')
  assert.equal(channelLabel('dingtalk'), '钉钉')
  assert.equal(channelLabel('generic'), '通用')
  assert.equal(channelLabel('unknown-channel'), 'unknown-channel', '未知渠道原样回显')
  assert.equal(eventsLabel([]), '全部事件', '空数组 = 全部事件')
  assert.equal(eventsLabel(['end', 'ask']), '会话结束 / 询问')
  assert.equal(eventsLabel(['approval', 'nope']), '审批 / nope', '未知事件原样回显')
  assert.deepEqual(
    msgTypeOptions('feishu').map((o) => o.value),
    ['text', 'post'],
    '飞书支持 text/post',
  )
  assert.deepEqual(
    msgTypeOptions('wecom').map((o) => o.value),
    ['text', 'markdown'],
    '企微/钉钉支持 text/markdown',
  )
})

test('webhook 面板：列表渲染（名称 + 渠道·事件）与失败记录', () => {
  const { WebhookSection, harness } = loadWebhookPanel({ language: 'zh-CN' })
  const tree = harness.render(WebhookSection, {
    webhooks: [
      { name: '企微-工作群', channel: 'wecom', url: 'https://x', secret: '', events: ['end'], msgType: 'text' },
      { name: '飞书-私聊', channel: 'feishu', url: 'https://y', secret: '', events: [], msgType: 'post' },
    ],
    failures: [
      { time: 1_700_000_000_000, webhookName: '企微-工作群', channel: 'wecom', attempts: 3, error: 'ECONNREFUSED' },
    ],
    onPatchWebhooks: () => {},
  })

  const rows = collect(tree).filter((el) => el.props?.className === 'dsh-my-notify-webhook-row')
  assert.equal(rows.length, 2, '两条 webhook 各渲染一行')
  assert.ok(textOf(byClass(tree, 'dsh-my-notify-section-title')).includes('出站 Webhook'), '区块标题')
  const labels = collect(tree)
    .filter((el) => el.props?.className === 'dsh-my-notify-label')
    .map((el) => el.props.children)
  assert.deepEqual(labels, ['企微-工作群', '飞书-私聊'], '行内显示 webhook 名称')
  const hints = collect(tree)
    .filter((el) => el.props?.className === 'dsh-my-notify-hint')
    .map((el) => el.props.children)
  assert.equal(hints[0], '企业微信 · 会话结束', '行内显示「渠道 · 事件」')
  assert.equal(hints[1], '飞书 · 全部事件', '空事件数组显示「全部事件」')

  const failureMsg = byClass(tree, 'dsh-my-notify-webhook-failure-msg')
  assert.equal(failureMsg.props.children, 'ECONNREFUSED', '失败原因渲染')
  const failureTime = byClass(tree, 'dsh-my-notify-webhook-failure-time').props.children
  assert.ok(failureTime.includes('企微-工作群'), '失败记录含 webhook 名称')
  assert.ok(failureTime.includes('企业微信'), '失败记录含渠道中文标签')
  assert.ok(failureTime.includes('3 次尝试'), '失败记录含尝试次数')
})

test('webhook 面板：无失败记录时提示占位文案', () => {
  const { WebhookSection, harness } = loadWebhookPanel({ language: 'zh-CN' })
  const tree = harness.render(WebhookSection, { webhooks: [], failures: [], onPatchWebhooks: () => {} })
  const hints = collect(tree)
    .filter((el) => el.props?.className === 'dsh-my-notify-hint')
    .map((el) => el.props.children)
  assert.ok(hints.includes('暂无失败记录'), '无失败记录显示占位文案')
  assert.equal(buttonByText(tree, '添加 Webhook') !== undefined, true, '提供「添加 Webhook」按钮')
})

test('webhook 面板：添加流程（编辑空模板 → 保存 → onPatchWebhooks 追加）', () => {
  const { WebhookSection, harness } = loadWebhookPanel({ language: 'zh-CN' })
  const existing = {
    name: '企微-工作群',
    channel: 'wecom',
    url: 'https://x',
    secret: '',
    events: ['end'],
    msgType: 'text',
  }
  let patched = null
  const render = () =>
    harness.render(WebhookSection, {
      webhooks: [existing],
      failures: [],
      onPatchWebhooks: (next) => {
        patched = next
      },
    })

  // 初始：无编辑器
  assert.equal(byClass(render(), 'dsh-my-notify-webhook-editor'), undefined, '初始不渲染编辑器')

  // 点「添加 Webhook」→ 编辑器出现，草稿为空模板
  buttonByText(render(), '添加 Webhook').props.onClick()
  const editor = byClass(render(), 'dsh-my-notify-webhook-editor')
  assert.ok(editor !== undefined, '点击后渲染编辑器')
  const inputs = collect(editor).filter((el) => el.props?.className === 'dsh-my-notify-webhook-input')
  assert.equal(inputs[0].props.value, '', '新草稿名称为空')
  assert.equal(inputs[0].props.placeholder, '如：企微-工作群', '名称占位文案')
  assert.deepEqual(
    collect(editor)
      .filter((el) => el.props?.className === 'dsh-my-notify-webhook-event')
      .map((el) => textOf(el)),
    ['会话结束', '询问', '审批', '远程触发'],
    '事件多选四项',
  )
  assert.deepEqual(
    collect(editor)
      .filter((el) => el.props?.type === 'checkbox')
      .map((el) => el.props.checked),
    [true, true, true, false],
    '默认勾选 end/ask/approval（与 emptyWebhook 一致）',
  )

  // 输入名称 → 保存 → 追加到列表末尾
  inputs[0].props.onChange({ target: { value: '企微-工作群2' } })
  const afterTyping = byClass(render(), 'dsh-my-notify-webhook-editor')
  const nameInput = collect(afterTyping).filter((el) => el.props?.className === 'dsh-my-notify-webhook-input')[0]
  assert.equal(nameInput.props.value, '企微-工作群2', '名称输入写回草稿')
  assert.ok(buttonByText(afterTyping, '取消') !== undefined, '编辑器提供「取消」')

  buttonByText(render(), '保存').props.onClick()
  assert.ok(Array.isArray(patched), '保存调用 onPatchWebhooks')
  assert.equal(patched.length, 2, '新 webhook 追加到列表末尾')
  assert.equal(patched[0], existing, '已有项不被修改')
  assert.equal(patched[1].name, '企微-工作群2')
  assert.equal(patched[1].channel, 'wecom', '沿用空模板默认渠道')
  assert.deepEqual(patched[1].events, ['end', 'ask', 'approval'])

  // 保存后编辑器关闭（setEditing(-1)）
  assert.equal(byClass(render(), 'dsh-my-notify-webhook-editor'), undefined, '保存后关闭编辑器')
})

test('webhook 面板：删除与启用开关（onPatchWebhooks 收到更新后的列表）', () => {
  const { WebhookSection, harness } = loadWebhookPanel({ language: 'zh-CN' })
  const a = { name: 'A', channel: 'wecom', url: 'https://a', secret: '', events: ['end'], msgType: 'text' }
  const b = { name: 'B', channel: 'feishu', url: 'https://b', secret: '', events: ['ask'], msgType: 'text' }
  let patched = null
  const render = () =>
    harness.render(WebhookSection, {
      webhooks: [a, b],
      failures: [],
      onPatchWebhooks: (next) => {
        patched = next
      },
    })

  // 删除第一条
  collect(render())
    .filter((el) => el.type === 'button' && textOf(el) === '删除')[0]
    .props.onClick()
  assert.deepEqual(
    patched.map((w) => w.name),
    ['B'],
    '删除第一条后只剩 B',
  )

  // 切换第一条启用状态（默认 enabled 未显式给出 → 视为启用）
  patched = null
  const toggles = collect(render()).filter((el) => el.props?.className === 'dsh-my-notify-toggle')
  assert.equal(toggles.length, 2, '每行一个启用开关')
  assert.equal(toggles[0].props['aria-checked'], 'true', '未显式 enabled 时视为启用')
  assert.equal(toggles[0].props.role, 'switch', '开关具备 switch 语义')
  toggles[1].props.onClick()
  assert.equal(patched[1].enabled, false, '点击开关把该项置为关闭')
  assert.deepEqual(patched[0], a, '其他项保持不变')
})
