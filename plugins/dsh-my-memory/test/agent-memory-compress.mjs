/**
 * dsh-my-memory — agent 记忆写入时的条目压缩（纯逻辑 + LLM 包装）。
 *
 * 覆盖：选行、原位拼回、格式校验、门面回退，以及 LLM 压缩器的
 * 正常 / 条数不符 / 抛错 / 无路由 / 超时回退。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  applyCompressedLines,
  compressContentForWrite,
  parseCompressedBlock,
  pickCompressibleLines,
} from '../lib/agent-memory/compress.js'
import { createLlmCompressor } from '../lib/agent-memory/compress-llm.js'

const LONG = '这条记忆写得非常长而且带一堆解释性内容（例如这个例子那个例子），压缩后应该只剩结论'
const SHORT = '短条目'

test('pickCompressibleLines 只选超阈值的条目行，标题与空行不动', () => {
  const lines = ['# 标题', '', '- ' + SHORT, '- ' + LONG, '正文段落']
  const picked = pickCompressibleLines(lines, 10)
  assert.equal(picked.length, 1, '只有超过阈值的条目被选中（短条目、正文段落、标题都不算）')
  assert.equal(picked[0].index, 3, '记录原位置（0-based 行号）')
  assert.equal(picked[0].text, LONG)
})

test('applyCompressedLines 原位替换，接受更短结果', () => {
  const lines = ['- ' + LONG, '- ' + SHORT]
  const candidates = pickCompressibleLines(lines, 10)
  const next = applyCompressedLines(lines, candidates, ['压缩后的结论'])
  assert.equal(next[0], '- 压缩后的结论')
  assert.equal(next[1], '- ' + SHORT, '未选中的行原样保留')
})

test('applyCompressedLines 拒绝条数不符 / 未变短 / 空条目', () => {
  const lines = ['- ' + LONG]
  const candidates = pickCompressibleLines(lines, 10)
  assert.equal(applyCompressedLines(lines, candidates, []), null, '条数不符 → 放弃')
  assert.equal(applyCompressedLines(lines, candidates, [LONG]), null, '没变短 → 放弃')
  assert.equal(applyCompressedLines(lines, candidates, ['   ']), null, '空条目 → 放弃')
})

test('parseCompressedBlock 去围栏与空行，按行返回', () => {
  assert.deepEqual(parseCompressedBlock('```text\n- 甲\n\n- 乙\n```'), ['- 甲', '- 乙'])
  assert.deepEqual(parseCompressedBlock('   '), [])
})

test('compressContentForWrite 在无压缩器 / 失败 / 不合格式时回退原文', async () => {
  const content = '- ' + LONG + '\n- ' + SHORT
  assert.equal(await compressContentForWrite(content, undefined), content, '没有压缩器 → 原文')
  assert.equal(await compressContentForWrite(content, async () => null), content, '压缩器返回 null → 原文')
  assert.equal(
    await compressContentForWrite('- ' + LONG + '\n- ' + LONG + '二', async () => ['只有一条'], 10),
    '- ' + LONG + '\n- ' + LONG + '二',
    '条数不符 → 原文',
  )
  assert.equal(
    await compressContentForWrite(content, async () => {
      throw new Error('boom')
    }),
    content,
    '抛错 → 原文',
  )
})

test('compressContentForWrite 正常压缩并保留未选中的行', async () => {
  const content = '# 标题\n- ' + LONG + '\n- ' + SHORT
  const next = await compressContentForWrite(content, async () => ['只留结论'], 10)
  assert.equal(next, '# 标题\n- 只留结论\n- ' + SHORT)
})

test('createLlmCompressor：无服务 / 无路由 / 抛错 / 条数不符 一律返回 null', async () => {
  const compressor = createLlmCompressor({ llm: () => undefined })
  assert.equal(await compressor(['a'], {}), null, '没有 llm 服务')

  const streamOk = {
    stream: () =>
      (async function* () {
        yield { type: 'text-delta', text: '- 甲' }
      })(),
  }
  const noRoute = createLlmCompressor({ llm: () => streamOk })
  assert.equal(await noRoute(['a'], {}), null, '拿不到模型路由')

  const thrower = {
    stream: () =>
      (async function* () {
        yield { type: 'text-delta', text: '' }
        throw new Error('network')
      })(),
  }
  const failing = createLlmCompressor({ llm: () => thrower })
  const exec = { agent: { session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } } }
  assert.equal(await failing(['a'], exec), null, '流内抛错')

  const twoLines = {
    stream: () =>
      (async function* () {
        yield { type: 'text-delta', text: '- 甲\n- 乙' }
      })(),
  }
  const mismatch = createLlmCompressor({ llm: () => twoLines })
  assert.equal(await mismatch(['a'], exec), null, '条数不符')
})

test('createLlmCompressor 正常返回同数量条目并带正确路由', async () => {
  const seen = []
  const service = {
    stream: (options) => {
      seen.push(options)
      return (async function* () {
        yield { type: 'text-delta', text: '- 压缩一\n' }
        yield { type: 'text-delta', text: '- 压缩二' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const compressor = createLlmCompressor({ llm: () => service })
  const exec = { agent: { session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'chat' } }) } } }
  assert.deepEqual(await compressor(['长一', '长二'], exec), ['- 压缩一', '- 压缩二'])
  assert.equal(seen[0].provider, 'deepseek')
  assert.equal(seen[0].model, 'chat')
  assert.ok(String(seen[0].system).includes('行数'), 'system prompt 约束行数')
})
