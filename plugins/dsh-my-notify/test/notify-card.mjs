import { test } from 'vitest'
/**
 * dsh-my-notify — 飞书 interactive 卡片构建单测。
 *
 * 覆盖契约：schema 2.0 / 1.0 双结构、按事件配色（含子代理）、显式配色优先、
 * 字段裁剪（≤10 项）、20KB UTF-8 字节截断 + 续行提示、@ 空项剥离、
 * 跳转按钮（open_url）、元素上限。
 */
import assert from 'node:assert/strict'
import {
  CARD_BYTES_LIMIT,
  CARD_COLORS,
  CARD_ELEMENT_LIMIT,
  buildFeishuCard,
  jsonBytes,
  kindColor,
  mentionLine,
  truncateUtf8,
} from '../lib/notify/card.js'

/** 主内容元素（lark_md 正文）。 */
function mainContent(card) {
  const elements = card.body?.elements ?? card.elements
  return elements.find((el) => el.tag === 'div' && el.text?.content !== undefined)
}

test('notify feishu card suite', () => {
  // ── 1. schema 2.0：元素在 body.elements，header 带配色 ────────────────
  {
    const card = buildFeishuCard({ kind: 'end', title: '会话已结束', content: '已完成' })
    assert.equal(card.schema, '2.0')
    assert.deepEqual(card.header, {
      title: { tag: 'plain_text', content: '会话已结束' },
      template: 'green',
    })
    assert.ok(Array.isArray(card.body.elements), '2.0 elements live under body')
    assert.equal(card.elements, undefined, 'no top-level elements in 2.0')
    assert.equal(mainContent(card).text.content, '已完成')
  }

  // ── 2. schema 1.0：顶层 elements + config ────────────────────────────
  {
    const card = buildFeishuCard({ kind: 'ask', title: '回答问题', content: '请选择', schemaVersion: '1.0' })
    assert.equal(card.schema, undefined, '1.0 has no schema field')
    assert.deepEqual(card.config, { wide_screen_mode: true })
    assert.ok(Array.isArray(card.elements), '1.0 elements live at top level')
    assert.equal(card.body, undefined)
  }

  // ── 3. 按事件配色 + 子代理独立配色 + 显式配色优先 ──────────────────────
  {
    assert.equal(kindColor('end'), 'green')
    assert.equal(kindColor('ask'), 'blue')
    assert.equal(kindColor('approval'), 'orange')
    assert.equal(kindColor('remote'), 'grey')
    assert.equal(kindColor('end', 'subagent'), 'violet')
    assert.equal(kindColor('subagentEnd'), 'violet', 'subagentEnd event gets its own color')
    assert.equal(kindColor('bogus'), 'default')

    assert.equal(buildFeishuCard({ kind: 'approval', title: 't', content: 'c' }).header.template, 'orange')
    assert.equal(
      buildFeishuCard({ kind: 'approval', title: 't', content: 'c', template: 'red' }).header.template,
      'red',
      'explicit color wins',
    )
    assert.equal(
      buildFeishuCard({ kind: 'approval', title: 't', content: 'c', template: 'pink' }).header.template,
      'orange',
      'illegal color falls back to kind color',
    )
    assert.equal(
      buildFeishuCard({ kind: 'end', title: 't', content: 'c', accentByKind: false }).header.template,
      'default',
      'accentByKind=false disables automatic color',
    )
    for (const color of CARD_COLORS) {
      assert.equal(buildFeishuCard({ kind: 'end', title: 't', content: 'c', template: color }).header.template, color)
    }
  }

  // ── 4. 字段裁剪：最多 10 项，空值 / 空标签跳过 ─────────────────────────
  {
    const fields = Array.from({ length: 12 }, (_, i) => ({ label: `字段${i}`, value: `值${i}` }))
    fields.push({ label: '', value: '' })
    const card = buildFeishuCard({ kind: 'end', title: 't', content: 'c', fields })
    const fieldLines = card.body.elements.filter(
      (el) => typeof el.text?.content === 'string' && el.text.content.startsWith('**'),
    )
    assert.equal(fieldLines.length, 10, 'fields capped at ten')
    assert.ok(fieldLines[0].text.content.includes('字段0'), 'first field rendered')
    assert.ok(!fieldLines.some((el) => el.text.content.includes('字段10')), '11th field trimmed')
    assert.ok(card.body.elements.length <= CARD_ELEMENT_LIMIT)
  }

  // ── 5. 请求体上限：官方 20KB 按 20000 字节计，实卡留余量 ≤19600 ──────────
  {
    const card = buildFeishuCard({ kind: 'end', title: 't', content: '内容'.repeat(8000) })
    const bytes = jsonBytes(card)
    assert.equal(CARD_BYTES_LIMIT, 19_600, 'limit keeps a margin below the official 20000-byte cap')
    assert.ok(bytes <= 19_600, `card must stay under the 19600-byte cap (got ${bytes})`)
    assert.ok(bytes <= 20_000, `never above the official 20KB=20000 bytes (got ${bytes})`)
    assert.ok(bytes > 19_000, `truncation still uses the budget (got ${bytes})`)
    assert.ok(mainContent(card).text.content.includes('截断'), 'truncation hint appended')
    // 多字节字符不被切成半个
    const truncated = truncateUtf8('中文测试', 4)
    assert.equal(truncated, '中', 'utf8 truncation keeps whole characters')
    assert.equal(truncateUtf8('abc', 0), '')
  }

  // ── 6. @ 提醒：空项 / 非法项剥离，mentionAll 追加 @all ─────────────────
  {
    assert.equal(mentionLine(['ou_a', '', '  ', 'bad id', 'ou_b'], false), '<at id=ou_a></at> <at id=ou_b></at>')
    assert.equal(mentionLine([], false), '')
    assert.equal(mentionLine(['', ' '], false), '', 'all-empty mentions are dropped')
    assert.equal(mentionLine(['ou_a'], true), '<at id=ou_a></at> <at id=all></at>')
    const card = buildFeishuCard({ kind: 'ask', title: 't', content: 'c', mentionOpenIds: ['', 'ou_a'] })
    const atLine = card.body.elements.find(
      (el) => typeof el.text?.content === 'string' && el.text.content.includes('<at'),
    )
    assert.ok(atLine.text.content.includes('ou_a'))
    assert.ok(!atLine.text.content.includes('id=>'), 'empty ids never rendered')
    const noMention = buildFeishuCard({ kind: 'ask', title: 't', content: 'c', mentionOpenIds: [''] })
    assert.ok(
      !noMention.body.elements.some((el) => typeof el.text?.content === 'string' && el.text.content.includes('<at')),
    )
  }

  // ── 7. 跳转按钮：open_url + 文案；缺链接 / 缺文案不渲染 ────────────────
  {
    const card = buildFeishuCard({
      kind: 'end',
      title: 't',
      content: 'c',
      buttonText: '查看会话',
      sessionUrl: 'https://dsh.local/sessions/s1',
    })
    const action = card.body.elements.find((el) => el.tag === 'action')
    assert.equal(action.actions[0].behaviors[0].type, 'open_url')
    assert.equal(action.actions[0].behaviors[0].default_url, 'https://dsh.local/sessions/s1')
    assert.equal(action.actions[0].text.content, '查看会话')
    const noButton = buildFeishuCard({ kind: 'end', title: 't', content: 'c', buttonText: '' })
    assert.ok(!noButton.body.elements.some((el) => el.tag === 'action'))
  }

  // ── 8. 空正文兜底 + 标题兜底（构建路径不抛错） ─────────────────────────
  {
    const card = buildFeishuCard({ kind: 'end', title: '', content: '' })
    assert.equal(card.header.title.content, 'DSH 通知')
    assert.equal(mainContent(card).text.content, '（无正文）')
  }

  console.log('ALL NOTIFY CARD TESTS PASSED')
})
