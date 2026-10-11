/**
 * 围栏语言索引（host half，issue #466）—— 解析 / 有界索引 / 事件提取 / 路由契约。
 *
 * 背景：真实宿主 banner 只在 shiki **认识**该语言时才写语言名（`i8(lang) ? lang :
 * labels.codeLabel`，CodeBlock.tsx:195），非空代码块的 `<code>` 又没有 `language-*`
 * class —— text / mermaid / 无语言三种块的 DOM 逐字段完全相同，纯 DOM 无法区分。
 * 本套件钉住「换语言来源」这条链路的**host 侧**：markdown 原文 → 围栏解析 → 哈希 →
 * 有界索引 → `GET /md-render/api/langs`；client 侧见 test/lang-probe.mjs。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import {
  UNINDEXED_FENCE_LANGS,
  LANG_INDEX_MAX_SIZE,
  MAX_INDEXED_MARKDOWN_CHARS,
  createLangIndex,
  fenceHash,
  fenceHashKeys,
  normalizeFenceContent,
  parseFences,
} from '../lib/lang-index.js'
import { recordMessage, recordSessionEvent } from '../lib/session-text.js'
import { CONFIG_API_PREFIX, LANGS_API_URL, LANGS_HASH_PARAM } from '../lib/routes/paths.js'
import { LANGS_MAX_HASHES, createLangsHandler, hashesOfRequest } from '../lib/routes/langs.js'
import { createPage, createReactStub, installGlobals, loadBundle } from './support/fake-dom.mjs'

/** 拼一段围栏（避免测试源码里出现裸反引号串）。 */
const fence = (lang, body, marker = '```') => [marker + lang, ...body, marker].join('\n')

// ── ① markdown 原文 → 围栏块 ──────────────────────────────────────────────

test('parseFences：语言标记 / 内容 / 缩进；info 属性与 ~ 围栏都认', () => {
  const md = [
    '前言',
    fence('text', ['## 标题', '正文']),
    '',
    fence('mermaid', ['flowchart TD', '  A --> B']),
    '',
    fence('txt', ['  缩进内容'], '~~~~'),
    '',
    '  ' + fence('', ['缩进围栏'], '```'),
    '',
    fence('text title="示例"', ['带属性']),
    '',
    fence('{.plaintext}', ['花括号写法']),
    '',
    fence('js', ['const a = 1']),
  ].join('\n')
  assert.deepEqual(
    parseFences(md).map((f) => ({ lang: f.lang, indent: f.indent })),
    [
      { lang: 'text', indent: 0 },
      { lang: 'mermaid', indent: 0 },
      { lang: 'txt', indent: 0 },
      { lang: '', indent: 2 },
      { lang: 'text', indent: 0 },
      { lang: 'plaintext', indent: 0 },
      { lang: 'js', indent: 0 },
    ],
    '逐块的语言标记与缩进',
  )
  assert.equal(parseFences(md)[0].content, '## 标题\n正文', '块内容为围栏之间的原文')
  assert.equal(parseFences(md)[3].content, '缩进围栏', '缩进围栏的内容照抄（缩进由 indent 表达）')
})

test('parseFences：未闭合围栏按「一直到文末」处理（流式 / 截断消息）', () => {
  const md = 'x\n' + '```text\n没写完的标题'
  const blocks = parseFences(md)
  assert.equal(blocks.length, 1, '未闭合也算一个块')
  assert.equal(blocks[0].content, '没写完的标题', '内容到文末')
})

test('parseFences：反引号围栏的 info string 含反引号 → 不是围栏（CommonMark）', () => {
  const md = '```foo`bar\n内容'
  assert.equal(parseFences(md).length, 0, '不当作围栏块（内容不会被误认成围栏正文）')
})

test('parseFences：闭围栏必须同字符且不短于开围栏', () => {
  const md = ['````text', '内层 ```', '还在块里', '````'].join('\n')
  const blocks = parseFences(md)
  assert.equal(blocks.length, 1, '四个反引号的块被三个反引号的行不算闭合')
  assert.equal(blocks[0].content, '内层 ```\n还在块里', '内容包含三个反引号那行')
})

// ── ② 哈希 + 有界索引 ────────────────────────────────────────────────────

test('fenceHash：稳定、同内容同值、不同内容不同值', () => {
  assert.equal(fenceHash('abc'), fenceHash('abc'), '同内容同哈希')
  assert.notEqual(fenceHash('abc'), fenceHash('abd'), '不同内容不同哈希')
  assert.match(fenceHash(''), /^[0-9a-z]+$/, '空串也返回合法哈希')
  assert.match(fenceHash('测试'.repeat(1000)), /^[0-9a-z]+$/, 'base36 形态')
})

test('normalizeFenceContent：CRLF/CR 归一 + 去掉尾部空白', () => {
  assert.equal(normalizeFenceContent('a\r\nb'), 'a\nb', 'CRLF → LF')
  assert.equal(normalizeFenceContent('a\rb'), 'a\nb', '裸 CR → LF')
  assert.equal(normalizeFenceContent('a\r\n\r\n'), 'a', 'CRLF + 尾部空白')
  assert.equal(normalizeFenceContent('a\n'), 'a', '尾部换行')
  assert.equal(normalizeFenceContent('a\n\n  '), 'a', '尾部空白与空行')
  assert.equal(normalizeFenceContent('  a'), '  a', '前导空白不动')
  assert.equal(normalizeFenceContent(undefined), '', 'undefined 安全')
})

test('createLangIndex：登记所有围栏语言（无语言不登记），查不到就是查不到', () => {
  const index = createLangIndex()
  const md = [
    fence('text', ['## 标题']),
    fence('plaintext', ['# 另一种']),
    fence('txt', ['1. 有序']),
    fence('mermaid', ['flowchart TD']),
    fence('mmd', ['graph LR']),
    fence('js', ['const a = 1']),
    fence('python', ['print(1)']),
    fence('', ['没有语言']),
  ].join('\n')
  assert.equal(index.record(md), 7, '登记 7 个有语言的围栏块（无语言的那块不登记）')
  assert.deepEqual(UNINDEXED_FENCE_LANGS, [''], '只有「无语言」不登记')
  assert.equal(index.lookup([fenceHash('## 标题')])[fenceHash('## 标题')], 'text', '命中 text')
  assert.equal(index.lookup([fenceHash('flowchart TD')])[fenceHash('flowchart TD')], 'mermaid', '命中 mermaid')
  assert.equal(
    index.lookup([fenceHash('const a = 1')])[fenceHash('const a = 1')],
    'js',
    'js 也登记（自研代码块要画真实语言名 banner）',
  )
  assert.equal(index.lookup([fenceHash('print(1)')])[fenceHash('print(1)')], 'python', 'python 同样登记')
  assert.deepEqual(index.lookup([fenceHash('没有语言')]), {}, '无语言块不登记（「命中空串」与「没命中」无法区分）')
  assert.deepEqual(index.lookup(['zzzz']), {}, '未知哈希查不到')
  assert.equal(index.stats().fences, 7, '登记块数可观测')
})

test('createLangIndex：缩进围栏用「去缩进后的内容」也能匹配（DOM 里是去缩进版）', () => {
  const index = createLangIndex()
  index.record('  ' + fence('text', ['  ## 缩进标题', '  第二行']))
  assert.equal(
    index.lookup([fenceHash('## 缩进标题\n第二行')])[fenceHash('## 缩进标题\n第二行')],
    'text',
    '去缩进版命中',
  )
})

test('LANG_INDEX_MAX_SIZE：索引上限是显式预算（默认 2000 条）', () => {
  assert.equal(LANG_INDEX_MAX_SIZE, 2000, '上限写在源码常量里（资源预算可审计）')
  assert.equal(createLangIndex().stats().maxSize, LANG_INDEX_MAX_SIZE, '默认按该上限建表')
})

test('fenceHashKeys：原文去尾空白 + 去缩进两个查询键（空内容 → 无键）', () => {
  assert.deepEqual(
    fenceHashKeys({ lang: 'text', content: '## 标题\n', indent: 0 }),
    [fenceHash('## 标题')],
    '无缩进只有原文键',
  )
  const nested = fenceHashKeys({ lang: 'text', content: '  ## 缩进\n', indent: 2 })
  assert.equal(nested.length, 2, '带缩进时两个键都登记（DOM 里是去缩进版）')
  assert.equal(nested.includes(fenceHash('  ## 缩进')), true, '原文键在内')
  assert.equal(nested.includes(fenceHash('## 缩进')), true, '去缩进键在内')
  assert.deepEqual(fenceHashKeys({ lang: 'text', content: '   \n\n', indent: 0 }), [], '空内容没有可查的键')
})

test('createLangIndex：空内容围栏不登记（没有可哈希的内容）', () => {
  const index = createLangIndex()
  assert.equal(index.record(fence('text', [])), 1, '块被解析到')
  assert.equal(index.stats().size, 0, '空内容不占索引条目')
})

test('createLangIndex：索引**有界**（超出上限按插入序淘汰最旧）', () => {
  const index = createLangIndex({ maxSize: 2 })
  index.record([fence('text', ['一']), fence('text', ['二']), fence('text', ['三'])].join('\n'))
  assert.equal(index.stats().size, 2, '条目数受上限约束')
  assert.equal(index.stats().evicted, 1, '淘汰 1 条（可观测）')
  assert.deepEqual(index.lookup([fenceHash('一')]), {}, '最旧的一条被淘汰')
  assert.equal(index.lookup([fenceHash('三')])[fenceHash('三')], 'text', '最新的一条仍在')
})

test('createLangIndex：超长 markdown 截断处理（不抛错、不无界解析）', () => {
  const index = createLangIndex()
  const huge = 'x'.repeat(MAX_INDEXED_MARKDOWN_CHARS + 5000) + fence('text', ['## 标题'])
  assert.equal(index.record(huge), 0, '超出上限的部分不解析（围栏在截断点之后）')
  assert.equal(index.record(fence('text', ['## 标题']) + huge.slice(0, 10)), 1, '截断点之前的围栏照常登记')
})

// ── ③ host / client 哈希算法 parity（防两侧漂移）────────────────────────────

test('哈希 parity：host fenceHash === client fenceContentHash（同算法、同规范化）', () => {
  const page = installGlobals(createPage())
  const loaded = loadBundle({ page, react: createReactStub() })
  const corpus = [
    '## 标题',
    'a',
    '',
    'line1\nline2',
    'line1\nline2\n',
    '带中文与 emoji 🎉 的内容',
    '  前导空格',
    'x'.repeat(5000),
    'flowchart TD\n  A["带引号"] --> B',
    'crlf\r\n第二行',
    '只剩 CR\r回车',
  ]
  for (const text of corpus) {
    assert.equal(
      loaded.exports.fenceContentHash(text),
      fenceHash(text),
      'hash parity: ' + JSON.stringify(text.slice(0, 12)),
    )
    assert.equal(
      loaded.exports.normalizeFenceContent(text),
      normalizeFenceContent(text),
      'normalize parity: ' + JSON.stringify(text.slice(0, 12)),
    )
  }
  assert.equal(loaded.exports.normalizeFenceContent('a\n\n'), normalizeFenceContent('a\n\n'), '尾部空行一致')
})

// ── ④ session/event → 索引 ────────────────────────────────────────────────

test('recordSessionEvent：user/message 的 data 就是消息；assistant/message 取 data.message', () => {
  const index = createLangIndex()
  assert.equal(
    recordSessionEvent(index, {
      type: 'user/message',
      data: { content: [{ type: 'text', text: fence('text', ['A']) }] },
    }),
    1,
    'user/message',
  )
  assert.equal(
    recordSessionEvent(index, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: fence('mermaid', ['B']) }] } },
    }),
    1,
    'assistant/message',
  )
  assert.equal(index.lookup([fenceHash('A')])[fenceHash('A')], 'text', 'user 围栏进了索引')
  assert.equal(index.lookup([fenceHash('B')])[fenceHash('B')], 'mermaid', 'assistant 围栏进了索引')
})

test('recordSessionEvent：reasoning（思考块）里的围栏同样登记', () => {
  const index = createLangIndex()
  const count = recordMessage(index, {
    content: [
      { type: 'reasoning', text: fence('text', ['思考里的标题']) },
      { type: 'tool-call', name: 'bash', arguments: '{}' },
    ],
  })
  assert.equal(count, 1, '思考块也扫')
  assert.equal(index.lookup([fenceHash('思考里的标题')])[fenceHash('思考里的标题')], 'text', '命中')
})

test('recordSessionEvent：其它事件类型 / 结构不符 / 异常输入一律忽略且不抛错', () => {
  const index = createLangIndex()
  const cases = [
    null,
    undefined,
    'x',
    { type: 'tool/result', data: { message: { content: [{ type: 'text', text: fence('text', ['C']) }] } } },
    { type: 'user/message', data: { content: 'not-an-array' } },
    { type: 'assistant/message', data: {} },
    { type: 'user/message', data: { content: [null, 3, { type: 'text' }] } },
  ]
  for (const event of cases) assert.equal(recordSessionEvent(index, event), 0, '忽略: ' + JSON.stringify(event))
  assert.equal(index.stats().size, 0, '没有任何条目被误建')
})

// ── ⑤ 路由契约（GET /md-render/api/langs）──────────────────────────────────

function mockResponse() {
  const res = {
    status: 0,
    headers: {},
    written: [],
    writeHead(status, headers) {
      res.status = status
      if (headers) res.headers = headers
    },
    end(chunk) {
      if (chunk !== undefined) res.written.push(String(chunk))
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080' } = {}) {
  return {
    url,
    method,
    headers: { host },
    async *[Symbol.asyncIterator]() {
      yield ''
    },
  }
}

async function call(handler, request) {
  const response = mockResponse()
  await handler(request, response)
  return { status: response.status, body: JSON.parse(response.written.join('')) }
}

test('hashesOfRequest：去重 / 形态校验 / 上限截断 / 无参数不报错', () => {
  const many = Array.from({ length: LANGS_MAX_HASHES + 10 }, (_v, i) => LANGS_HASH_PARAM + '=h' + String(i)).join('&')
  assert.deepEqual(hashesOfRequest(mockRequest({ url: LANGS_API_URL })), [], '无参数 → 空')
  assert.deepEqual(hashesOfRequest(mockRequest({ url: LANGS_API_URL + '?h=abc&h=abc' })), ['abc'], '重复去重')
  assert.deepEqual(
    hashesOfRequest(mockRequest({ url: LANGS_API_URL + '?h=ABC&h=a%20b&h=' + 'z'.repeat(20) + '&h=ok1' })),
    ['ok1'],
    '大写 / 空格 / 超长 / 空串一律忽略',
  )
  assert.equal(hashesOfRequest(mockRequest({ url: LANGS_API_URL + '?' + many })).length, LANGS_MAX_HASHES, '超上限截断')
})

test('createLangsHandler：GET → 200 {ok,value}；非 GET → 405；未命中不出现在 value 里', async () => {
  const index = createLangIndex()
  index.record(fence('text', ['## 标题']))
  const handler = createLangsHandler(index)
  const hit = fenceHash('## 标题')
  const ok = await call(handler, mockRequest({ url: LANGS_API_URL + '?h=' + hit + '&h=miss' }))
  assert.equal(ok.status, 200, 'GET 200')
  assert.deepEqual(ok.body, { ok: true, value: { [hit]: 'text' } }, '只返回命中的哈希')
  const empty = await call(handler, mockRequest({ url: LANGS_API_URL }))
  assert.deepEqual(empty.body.value, {}, '无参数 → 空表（不是错误）')
  const notAllowed = await call(handler, mockRequest({ url: LANGS_API_URL + '?h=' + hit, method: 'PUT' }))
  assert.equal(notAllowed.status, 405, '非 GET 405')
})

// ── ⑥ 端到端：apply 装配 → 会话事件建索引 → client 经路由取语言 ─────────────

/** 启动插件（含常驻 root + session/event 监听捕获），返回路由与事件入口。 */
function bootPlugin() {
  const routes = []
  const listeners = new Map()
  // 路由与监听都注册到**常驻 root**（profile fiber 会被回收），因此 root 必须带
  // webServer：host 半走 ctx.root ?? ctx。
  const root = {
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on(event, handler, options) {
      listeners.set(event, { handler, options })
      return () => listeners.delete(event)
    },
    webServer: {
      register(registration) {
        routes.push(registration)
        return () => {}
      },
    },
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    get() {
      return undefined
    },
    root,
    on: root.on,
    effect: root.effect,
    webServer: root.webServer,
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx, {})
  return { routes, listeners, ctx }
}

test('端到端：session/event 的围栏 → /md-render/api/langs 可查（且不新增路由前缀）', async () => {
  const booted = bootPlugin()
  assert.deepEqual(
    booted.routes.map((r) => r.path).sort(),
    [CONFIG_API_PREFIX, '/md-render/assets'],
    'langs 分派在既有 /md-render/api 前缀下，不新增第三条路由',
  )
  const event = booted.listeners.get('session/event')
  assert.ok(event, 'session/event 已订阅（注册到常驻 root）')
  assert.equal(event.options.global, true, '带 { global: true }（profile fiber 回收不失效）')
  assert.equal(booted.listeners.size, 1, 'apply 只注册一个 session/event 监听（重复 apply 先撤后注册，见下一条断言）')
  const api = booted.routes.find((r) => r.path === CONFIG_API_PREFIX)
  const response = mockResponse()
  const hash = fenceHash('## 端到端标题')
  await api.handler(mockRequest({ url: LANGS_API_URL + '?h=' + hash }), response)
  assert.deepEqual(JSON.parse(response.written.join('')), { ok: true, value: {} }, '索引为空时查不到')

  event.handler(
    { id: 's1' },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: fence('text', ['## 端到端标题']) }] } },
    },
  )
  const hit = mockResponse()
  await api.handler(mockRequest({ url: LANGS_API_URL + '?h=' + hash }), hit)
  assert.deepEqual(JSON.parse(hit.written.join('')), { ok: true, value: { [hash]: 'text' } }, '事件建索引后可查')

  const denied = mockResponse()
  await api.handler(mockRequest({ url: LANGS_API_URL + '?h=' + hash, host: 'evil.example.com' }), denied)
  assert.equal(denied.status, 403, '非本机来源被围栏拦住')
})

test('apply 重复调用：session/event 监听不叠加（先撤后注册，单例索引不丢）', () => {
  const booted = bootPlugin()
  const event = booted.listeners.get('session/event')
  event.handler(
    { id: 's1' },
    { type: 'user/message', data: { content: [{ type: 'text', text: fence('text', ['## 保留']) }] } },
  )
  apply(booted.ctx, {})
  assert.equal(booted.listeners.size, 1, '仍然只有一个监听')
  const api = booted.routes[0]
  const response = mockResponse()
  return api.handler(mockRequest({ url: LANGS_API_URL + '?h=' + fenceHash('## 保留') }), response).then(() => {
    assert.deepEqual(
      JSON.parse(response.written.join('')),
      { ok: true, value: { [fenceHash('## 保留')]: 'text' } },
      '索引是进程内单例：re-apply 不丢已有条目',
    )
  })
})

// 注：语言索引是**进程内单例**（profile 热重载不丢），因此各用例一律用**唯一内容**
// 断言，不断言「全局空表」——避免用例间互相污染（顺序无关）。
