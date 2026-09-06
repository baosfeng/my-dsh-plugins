/**
 * Audit view helpers tests for dsh-my-observability (issue #89):
 *  - 搜索过滤逻辑（关键词匹配工具名/参数摘要/错误信息 + 组合条件 type/时间范围/成功失败）
 *  - 导出格式断言（JSON 完整结构 / CSV 摘要列表头与转义）
 *  - 统计视图（工具调用频次 Top N + 失败率）
 *  - 命中关键词高亮分段
 *
 * 这些纯函数位于 lib/audit-view.js（无 React/cordis 依赖），可被 vitest
 * 直接导入；client 端 scripts/build.mjs 把同一文件剥离 export 拼接进
 * lib/client.js，保证单测与面板逻辑同源。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  searchableText,
  matchesKeyword,
  applyAuditFilter,
  auditToJson,
  auditToCsv,
  csvCell,
  toolNameOf,
  resultTextOf,
  computeToolStats,
  highlightSegments,
  formatTime,
} from '../lib/audit-view.js'

/** 构造事件（默认工具调用）。 */
function ev(overrides) {
  return { id: 1, time: 1000, sessionId: 's1', type: 'tool_call', data: {}, ...overrides }
}

/** 过滤/搜索使用的基准数据集（四类事件 + 成败/错误）。 */
const EVENTS = [
  { id: 1, time: 1000, sessionId: 's1', type: 'agent_status', data: { status: 'running', agentType: 'top' } },
  { id: 2, time: 2000, sessionId: 's1', type: 'llm_stream', data: { phase: 'end', chunks: 3, chars: 10, ms: 5 } },
  {
    id: 3,
    time: 3000,
    sessionId: 's1',
    type: 'tool_call',
    data: { name: 'bash', args: { keys: ['command'], summary: 'ls -la' } },
  },
  { id: 4, time: 4000, sessionId: 's1', type: 'tool_result', data: { name: 'bash', ok: true, ms: 7 } },
  {
    id: 5,
    time: 5000,
    sessionId: 's1',
    type: 'tool_call',
    data: { name: 'read_file', args: { keys: ['path'], summary: '/tmp/a.txt' } },
  },
  { id: 6, time: 6000, sessionId: 's1', type: 'tool_result', data: { name: 'read_file', ok: false, ms: 9 } },
  {
    id: 7,
    time: 7000,
    sessionId: 's1',
    type: 'llm_stream',
    data: { phase: 'error', message: 'boom', chunks: 1, chars: 1, ms: 3 },
  },
]

test('searchableText: 工具名/参数摘要/错误信息/状态/阶段纳入搜索文本', () => {
  assert.equal(searchableText(EVENTS[2]).includes('bash'), true, 'tool name searchable')
  assert.equal(searchableText(EVENTS[2]).includes('ls -la'), true, 'args summary searchable')
  assert.equal(searchableText(EVENTS[6]).includes('boom'), true, 'llm error message searchable')
  assert.equal(searchableText(EVENTS[0]).includes('running'), true, 'agent status searchable')
  assert.equal(searchableText(EVENTS[6]).includes('error'), true, 'llm phase searchable')
  assert.equal(searchableText(ev({ type: 'tool_result', data: { name: 'x', ok: false } })).includes('失败'), true)
})

test('matchesKeyword: 大小写不敏感 + 空关键词全部命中', () => {
  const bash = EVENTS[2]
  assert.equal(matchesKeyword(bash, 'BASH'), true, 'case-insensitive')
  assert.equal(matchesKeyword(bash, 'ls'), true, 'substring match')
  assert.equal(matchesKeyword(bash, 'definitely-nope'), false, 'no match')
  assert.equal(matchesKeyword(bash, ''), true, 'empty keyword matches all')
  assert.equal(matchesKeyword(bash, '   '), true, 'whitespace-only keyword matches all')
  assert.equal(matchesKeyword(EVENTS[6], 'boom'), true, 'error keyword hit')
})

test('applyAuditFilter: 类型过滤（含 tool 合并 tc+tr）', () => {
  assert.equal(applyAuditFilter(EVENTS, { type: 'tool_call' }).length, 2, 'tool_call only')
  assert.equal(applyAuditFilter(EVENTS, { type: 'tool' }).length, 4, 'tool = call + result')
  assert.equal(applyAuditFilter(EVENTS, { type: 'llm_stream' }).length, 2, 'llm only')
  assert.equal(applyAuditFilter(EVENTS, { type: '' }).length, 7, 'empty type = all')
})

test('applyAuditFilter: 插件事件过滤（issue #154）', () => {
  const pluginEvents = [
    {
      id: 8,
      time: 8000,
      sessionId: 's1',
      type: 'plugin_event',
      data: {
        plugin: 'dsh-task-reliability',
        event: 'intervention',
        action: 'repeat-break',
        reason: 'reason',
        params: { count: 1 },
      },
    },
    {
      id: 9,
      time: 9000,
      sessionId: 's1',
      type: 'plugin_event',
      data: {
        plugin: 'dsh-task-reliability',
        event: 'ask-decision',
        action: 'ask-timeout',
        reason: 'ask-timeout',
        params: { question: 'A 还是 B？' },
      },
    },
  ]
  const all = [...EVENTS, ...pluginEvents]
  assert.equal(applyAuditFilter(all, { type: 'plugin' }).length, 2, 'plugin filter keeps plugin_event only')
  assert.equal(applyAuditFilter(all, { type: 'plugin' })[0].type, 'plugin_event')
  assert.equal(applyAuditFilter(all, { type: 'tool' }).length, 4, 'tool filter unaffected by plugin events')
  assert.equal(applyAuditFilter(all, { type: '' }).length, 9, 'empty type includes plugin events')
})

test('searchableText: 插件事件纳入搜索（插件名/事件名/动作/原因/参数）', () => {
  const plugin = {
    id: 8,
    time: 8000,
    sessionId: 's1',
    type: 'plugin_event',
    data: {
      plugin: 'dsh-task-reliability',
      event: 'intervention',
      action: 'repeat-break',
      reason: 'reason',
      params: { count: 1, question: '选哪个方案' },
    },
  }
  const text = searchableText(plugin)
  assert.equal(text.includes('dsh-task-reliability'), true, 'plugin name searchable')
  assert.equal(text.includes('intervention'), true, 'event name searchable')
  assert.equal(text.includes('repeat-break'), true, 'action searchable')
  assert.equal(text.includes('reason'), true, 'reason searchable')
  assert.equal(text.includes('选哪个方案'), true, 'param value searchable')
  assert.equal(matchesKeyword(plugin, 'repeat-break'), true, 'keyword hits action')
  assert.equal(matchesKeyword(plugin, '选哪个方案'), true, 'keyword hits param value')
})

test('applyAuditFilter: 时间范围闭区间', () => {
  const ranged = applyAuditFilter(EVENTS, { timeStart: 2000, timeEnd: 5000 })
  assert.deepEqual(
    ranged.map((e) => e.id),
    [2, 3, 4, 5],
    'inclusive range keeps ids 2..5',
  )
  const afterStart = applyAuditFilter(EVENTS, { timeStart: 6000 })
  assert.deepEqual(
    afterStart.map((e) => e.id),
    [6, 7],
    'from start onward',
  )
  const beforeEnd = applyAuditFilter(EVENTS, { timeEnd: 3000 })
  assert.deepEqual(
    beforeEnd.map((e) => e.id),
    [1, 2, 3],
    'up to end inclusive',
  )
  assert.equal(applyAuditFilter(EVENTS, { timeStart: 9000 }).length, 0, 'beyond all -> empty')
})

test('applyAuditFilter: 成功/失败过滤', () => {
  const success = applyAuditFilter(EVENTS, { result: 'success' })
  assert.ok(
    success.some((e) => e.id === 4),
    'bash ok kept',
  )
  assert.ok(
    success.some((e) => e.id === 3),
    'tool_call kept under success',
  )
  assert.ok(!success.some((e) => e.id === 6), 'read_file fail excluded')
  assert.ok(!success.some((e) => e.id === 7), 'llm error excluded')

  const fail = applyAuditFilter(EVENTS, { result: 'fail' })
  assert.deepEqual(
    fail.map((e) => e.id),
    [6, 7],
    'only fail semantics kept',
  )
})

test('applyAuditFilter: 关键词 + 组合条件', () => {
  const hit = applyAuditFilter(EVENTS, { keyword: 'bash' })
  assert.deepEqual(
    hit.map((e) => e.id),
    [3, 4],
    'bash tool call + result',
  )

  const combined = applyAuditFilter(EVENTS, {
    type: 'tool',
    keyword: 'read_file',
    result: 'fail',
    timeStart: 5000,
    timeEnd: 6000,
  })
  assert.deepEqual(
    combined.map((e) => e.id),
    [6],
    'combined tool+keyword+fail+range',
  )
})

test('auditToJson: 完整 JSON 结构可回解析且含全部字段', () => {
  const json = auditToJson(EVENTS)
  const parsed = JSON.parse(json)
  assert.equal(parsed.length, 7, 'all events')
  assert.deepEqual(parsed[2], EVENTS[2], 'event carries full data object')
  assert.ok(json.split('\n').length > 1, 'pretty-printed multi-line (2-space)')
  assert.ok(json.includes('"sessionId"'), 'contains full event fields')
  assert.equal(auditToJson([], 0), '[]', 'empty array')
})

test('auditToCsv: 摘要列表头 + 数据行 + 转义', () => {
  const csv = auditToCsv(EVENTS)
  const lines = csv.split('\n')
  assert.equal(lines[0], '时间,类型,工具,结果', 'header matches summary columns')
  // 表头 4 列，正文每行 4 列
  assert.equal(lines[1].split(',').length, 4, 'agent_status row 4 cols')
  assert.equal(lines[3], `${formatTime(3000)},工具调用,bash,`, 'tool_call row: time,type, tool=bash, result empty')
  assert.equal(lines[4], `${formatTime(4000)},工具结果,bash,成功`, 'tool_result ok row')
  assert.equal(lines[6], `${formatTime(6000)},工具结果,read_file,失败`, 'tool_result fail row')
  assert.equal(lines[7], `${formatTime(7000)},模型流,,错误`, 'llm error row')
  // 时间格式为 YYYY-MM-DD HH:MM:SS
  assert.match(lines[1].split(',')[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'time formatted ISO-ish')
})

test('auditToCsv: 含逗号/引号的工具名单元格被正确转义', () => {
  const tricky = ev({
    id: 1,
    time: 1000,
    type: 'tool_call',
    data: { name: 'run,"weird"', args: { keys: ['x'] } },
  })
  const csv = auditToCsv([tricky])
  assert.ok(csv.includes('"run,""weird"""'), 'tool name quoted + escaped quotes cell')
})

test('csvCell: 逗号/引号/换行转义，其余原样', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell('a\nb'), '"a\nb"')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(null), '')
})

test('toolNameOf / resultTextOf: 摘要列取值', () => {
  assert.equal(toolNameOf(EVENTS[2]), 'bash')
  assert.equal(toolNameOf(EVENTS[3]), 'bash')
  assert.equal(toolNameOf(EVENTS[0]), '', 'non-tool → empty')
  assert.equal(resultTextOf(EVENTS[3]), '成功', 'tool result ok')
  assert.equal(resultTextOf(EVENTS[5]), '失败', 'tool result fail')
  assert.equal(resultTextOf(EVENTS[6]), '错误', 'llm error')
  assert.equal(resultTextOf(EVENTS[0]), '', 'non-result → empty')
})

test('computeToolStats: 调用频次 Top N + 失败率', () => {
  const stats = computeToolStats(EVENTS, 5)
  const bash = stats.find((s) => s.tool === 'bash')
  const read = stats.find((s) => s.tool === 'read_file')
  assert.equal(bash.calls, 1)
  assert.equal(bash.failRate, 0)
  assert.equal(read.calls, 1)
  assert.equal(read.failRate, 1, 'call + one fail result → 100% fail rate')
  assert.equal(stats.length, 2)
  // 空输入
  assert.deepEqual(computeToolStats([], 5), [])
  // TopN 截断
  assert.equal(computeToolStats(EVENTS, 1).length, 1)
})

test('highlightSegments: 命中分段与空关键词', () => {
  const segs = highlightSegments('bash - ls -la', 'bash')
  assert.deepEqual(segs, [
    { text: 'bash', hit: true },
    { text: ' - ls -la', hit: false },
  ])
  assert.deepEqual(highlightSegments('anything', ''), [{ text: 'anything', hit: false }])
  assert.deepEqual(highlightSegments('', 'x'), [{ text: '', hit: false }])
  // 多次命中
  const multi = highlightSegments('foo bar foo', 'foo')
  assert.deepEqual(
    multi.filter((s) => s.hit).map((s) => s.text),
    ['foo', 'foo'],
    'both occurrences marked',
  )
})

test('formatTime: 时间格式化与非法输入', () => {
  assert.match(formatTime(1000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'formats ms timestamp')
  assert.equal(formatTime(NaN), '')
  assert.equal(formatTime(undefined), '')
})

console.log('ALL AUDIT VIEW TESTS PASSED')
