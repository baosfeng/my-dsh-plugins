/**
 * host-snapshot-guardrails.mjs — 告警快照落盘接入 dsh-shared 原语（issue #198 P2）。
 *
 * 缺陷形态（src/store.ts 的 persistNow）：
 *  `JSON.stringify(state, null, 2)` 全量 pretty 落盘 —— 缩进把快照体积放大约
 *  10~30%，而这份快照没有任何人读（机器解析用，不需要缩进）；且写入路径是
 *  插件自实现的 mkdir+writeFile，没有 shared 快照原语自带的**字节上限**护栏
 *  （MAX_ALERTS=500 条封顶，但单条 message 长度不受常量约束）。
 *
 * 本文件先 RED 后 GREEN 锁定接入后的契约：
 *  - 落盘内容 = 紧凑 JSON（与 JSON.stringify(state) 逐字节相等），体积小于 pretty；
 *  - 仍可被 JSON.parse 读回（加载路径不变）；
 *  - 落盘走 dsh-shared 的 atomicWriteJson（字节上限 + 被拦计数可观测）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteStats } from 'dsh-shared'
import { createStore, stateFile } from '../lib/store.js'

/** 条件等待（等状态而不是等墙钟：固定 sleep 是 CI flaky 的根因）。 */
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return true
    if (Date.now() > deadline) return predicate()
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('落盘接入 shared 快照原语：紧凑 JSON（消除 pretty 放大）且可读回', async () => {
  const home = mkdtempSync(join(tmpdir(), 'guard-snapshot-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const store = createStore({})
    await store.whenReady()
    const before = atomicWriteStats().writes
    store.record({ time: Date.now(), type: 'destructive-command', message: 'x'.repeat(200), severity: 'high' })
    const file = stateFile()
    await waitFor(() => existsSync(file) && readFileSync(file, 'utf8').includes('alerts'))
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    assert.equal(parsed.alerts.length, 1, '快照仍完整落盘')
    assert.equal(text, JSON.stringify(parsed), '紧凑 JSON：与 JSON.stringify(state) 逐字节相等（pretty 缩进被消除）')
    const prettyBytes = Buffer.byteLength(JSON.stringify(parsed, null, 2))
    const compactBytes = Buffer.byteLength(text)
    assert.ok(
      compactBytes < prettyBytes,
      `紧凑 ${compactBytes}B < pretty ${prettyBytes}B（放大约 ${prettyBytes - compactBytes}B）`,
    )
    assert.ok(atomicWriteStats().writes > before, '落盘经 dsh-shared atomicWriteJson（护栏计数可观测）')
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    rmSync(home, { recursive: true, force: true })
  }
})
