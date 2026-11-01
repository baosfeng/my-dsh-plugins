import { test } from 'vitest'
/**
 * dsh-my-notify — 统一模板变量引擎单测（server 端渲染）。
 *
 * 覆盖契约：新语法 {{ns.var}} / 旧语法 {var} 同值、未知占位符原样保留、
 * 缺值策略（空串参与渲染）、单次扫描不二次解析、五类事件默认文案、
 * subagentEnd 模板选择、变量目录完整性。
 */
import assert from 'node:assert/strict'
import { VAR_GROUPS, LEGACY_ALIASES, buildVars, channelName, kindLabel } from '../lib/notify/vars.js'
import { render } from '../lib/notify/template.js'
import { DEFAULT_MESSAGES, messageKeyOf, renderNoticeMessages, resolveMessages } from '../lib/notify/defaults.js'

const notice = {
  kind: 'end',
  sessionId: 's1',
  title: '标题',
  note: '摘要',
  agentType: 'top',
  time: 1700000000000,
  tokens: { input: 100, output: 50, total: 150, cacheRead: 20, cacheWrite: 10, reasoning: 5, requests: 3 },
  duration: 83,
  sessionUrl: 'https://dsh.local/sessions/s1',
  cwd: '/w/p',
  model: 'model-x',
  provider: 'prov',
  preset: 'default',
  parentId: 'ps',
}

test('notify template & vars suite', () => {
  const vars = buildVars({ ...notice, channel: 'feishu' })

  // ── 1. 新语法：{{ns.var}} ──────────────────────────────────────────────
  assert.equal(
    render('{{session.title}}|{{event.name}}|{{tokens.total}}|{{session.durationText}}', vars),
    '标题|会话已结束|150|1 分 23 秒',
  )

  // ── 2. 旧语法与新变量同值（7 个别名逐个比对） ──────────────────────────
  for (const [legacy, modern] of Object.entries(LEGACY_ALIASES)) {
    assert.ok(vars[modern] !== undefined, `catalog must define ${modern}`)
    assert.equal(render(`{${legacy}}`, vars), vars[modern], `legacy {${legacy}} equals ${modern}`)
  }

  // ── 3. 未知占位符原样保留（含拼写错误 / 嵌套花括号） ──────────────────
  assert.equal(render('{unknown}|{{nope.x}}|{a{b}', vars), '{unknown}|{{nope.x}}|{a{b}')

  // ── 4. 缺值策略：变量存在但为空 → 渲染为空串（不保留占位符） ──────────
  assert.equal(render('x{{session.title}}y', buildVars({})), 'xy')
  assert.equal(render('', vars), '')
  assert.equal(render(undefined, vars), '')

  // ── 5. 单次扫描：变量值里的占位符不会被二次解析 ────────────────────────
  assert.equal(render('{{event.note}}', buildVars({ note: '{{session.title}}' })), '{{session.title}}')

  // ── 6. 多字节 / 长度不改变语义 ────────────────────────────────────────
  assert.equal(
    render('{{ask.count}} 个问题', buildVars({ kind: 'ask', question: '问', questions: ['问'] })),
    '1 个问题',
  )
  assert.equal(
    render('{{ask.question}}', buildVars({ kind: 'ask', note: '摘要' })),
    '摘要',
    'question falls back to note',
  )

  // ── 7. 变量目录：7 组 / 32 个变量，全部可在空变量表里解析 ───────────────
  {
    const all = VAR_GROUPS.flatMap((group) => group.items.map((item) => item.name))
    assert.equal(VAR_GROUPS.length, 7, 'seven namespaces')
    assert.equal(all.length, 32, '32 catalogued variables')
    const empty = buildVars({})
    for (const name of all) assert.ok(empty[name] !== undefined, `${name} resolvable`)
    for (const group of VAR_GROUPS) assert.ok(group.items.length > 0, 'every group has items')
  }

  // ── 8. 枚举文案：kind / channel ───────────────────────────────────────
  assert.equal(kindLabel('approval'), '等待你的批准')
  assert.equal(kindLabel('unknown'), '提示')
  assert.equal(channelName('feishu'), '飞书群机器人')
  assert.equal(channelName('unknown-channel'), 'unknown-channel')

  // ── 9. 默认文案：缺省 / 空串 / 非法结构都回退默认值（fail-open） ────────
  {
    assert.deepEqual(resolveMessages(undefined), DEFAULT_MESSAGES)
    assert.deepEqual(resolveMessages('oops'), DEFAULT_MESSAGES)
    const partial = resolveMessages({ end: { title: '', body: '正文' }, ask: 'oops' })
    assert.equal(partial.end.title, DEFAULT_MESSAGES.end.title, 'empty title keeps default')
    assert.equal(partial.end.body, '正文')
    assert.deepEqual(partial.ask, DEFAULT_MESSAGES.ask, 'invalid ask keeps default')
    assert.deepEqual(resolveMessages({ end: { title: 123 } }).end, DEFAULT_MESSAGES.end, 'non-string keeps default')
  }

  // ── 10. 文案键：end + subagent → subagentEnd ──────────────────────────
  assert.equal(messageKeyOf('end', 'subagent'), 'subagentEnd')
  assert.equal(messageKeyOf('end', 'top'), 'end')
  assert.equal(messageKeyOf('bogus'), 'remote')

  // ── 11. 广播前渲染：默认文案 = 原字段（升级不改变历史显示） ──────────────
  {
    const messages = resolveMessages(undefined)
    const out = renderNoticeMessages({ kind: 'ask', title: '标题', note: '确认部署' }, messages, { channel: 'browser' })
    assert.equal(out.title, '标题')
    assert.equal(out.note, '确认部署')
  }

  // ── 12. 自定义文案：变量渲染 + subagentEnd 独立模板 ─────────────────────
  {
    const messages = resolveMessages({
      end: { title: '结束：{{session.title}}', body: '{{event.name}} · {{tokens.text}}' },
      subagentEnd: { title: '子代理完成：{{session.title}}', body: '{{session.durationText}}' },
    })
    const end = renderNoticeMessages({ kind: 'end', title: '演示', tokens: notice.tokens, duration: 83 }, messages)
    assert.equal(end.title, '结束：演示')
    assert.equal(end.note, '会话已结束 · 输入 100 / 输出 50 / 总计 150')
    const sub = renderNoticeMessages({ kind: 'end', agentType: 'subagent', title: '子代理 子', duration: 5 }, messages)
    assert.equal(sub.title, '子代理完成：子代理 子')
    assert.equal(sub.note, '5 秒')
  }

  // ── 13. preserve：显式 title / body 不被模板覆盖（远程触发契约） ────────
  {
    const messages = resolveMessages({ remote: { title: '模板标题', body: '模板正文' } })
    const out = renderNoticeMessages(
      { kind: 'remote', title: 'CI 完成', note: '构建成功', preserve: ['title', 'note'] },
      messages,
    )
    assert.equal(out.title, 'CI 完成')
    assert.equal(out.note, '构建成功')
    const rendered = renderNoticeMessages({ kind: 'remote', title: 'CI 完成', note: '构建成功' }, messages)
    assert.equal(rendered.title, '模板标题', 'without preserve the template wins')
  }

  console.log('ALL NOTIFY TEMPLATE TESTS PASSED')
})
