/**
 * tmp-residue-sweep 防回归测试（vitest globalSetup 的清扫器）。
 *
 * 双向判据：
 *  - 陈旧（mtime 早于 TTL）的**本仓前缀**残留 → 必须被清掉；
 *  - 近期（mtime 在 TTL 内）的残留 → **必须保留**（供排障看现场）；
 *  - 非本仓前缀（宿主 dsh-spill-* 等 / 任意随机名）→ **必须保留**（不越权）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TTL_MS, sweepStaleTempDirs } from './tmp-residue-sweep.mjs'

/** 造一个隔离的「假 tmpdir」并用真实 mtime 标注新旧。 */
function makeFakeTmpdir(now) {
  const root = mkdtempSync(join(tmpdir(), 'sweep-probe-'))
  const stale = new Date(now - DEFAULT_TTL_MS - 60_000)
  const fresh = new Date(now - 60_000)
  const entries = [
    ['dsh-shared--12345-aaaaaaaaaaaa', stale, true],
    ['dsh-guard-feature-home--12345-bbbbbbbbbbbb', stale, true],
    ['dsh-shared--12345-cccccccccccc', fresh, false],
    ['dsh-spill-abcdef', stale, false],
    ['7fK2pQ-random-host-dir', stale, false],
  ]
  for (const [name, mtime] of entries) {
    const p = join(root, name)
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'payload.json'), '{}')
    utimesSync(p, mtime, mtime)
  }
  return root
}

describe('sweepStaleTempDirs（globalSetup 清扫器）', () => {
  it('清理陈旧的本仓残留，保留近期现场与非本仓前缀（fail-closed 不越权）', () => {
    const now = Date.now()
    const root = makeFakeTmpdir(now)
    try {
      const r = sweepStaleTempDirs({ dir: root, now })

      expect(r.removed, '两个陈旧本仓残留必须被清掉').toBe(2)
      expect(existsSync(join(root, 'dsh-shared--12345-aaaaaaaaaaaa'))).toBe(false)
      expect(existsSync(join(root, 'dsh-guard-feature-home--12345-bbbbbbbbbbbb'))).toBe(false)

      expect(existsSync(join(root, 'dsh-shared--12345-cccccccccccc')), '近期残留必须保留（排障现场）').toBe(true)
      expect(existsSync(join(root, 'dsh-spill-abcdef')), '非本仓前缀必须保留（不越权）').toBe(true)
      expect(existsSync(join(root, '7fK2pQ-random-host-dir')), '随机名宿主目录必须保留').toBe(true)

      expect(r.errors, '清扫不得产生错误').toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('清扫 verify-local 的隔离 TMPDIR 残留（该前缀此前不在白名单 → 结构性扫不到）', () => {
    const now = Date.now()
    const root = mkdtempSync(join(tmpdir(), 'sweep-iso-'))
    const stale = new Date(now - DEFAULT_TTL_MS - 60_000)
    const fresh = new Date(now - 60_000)
    try {
      for (const [name, mtime] of [
        ['verify-isolated-tmp-BjA8ox', stale],
        ['verify-isolated-tmp-9xERc0', fresh],
      ]) {
        const p = join(root, name)
        mkdirSync(p, { recursive: true })
        writeFileSync(join(p, 'payload.json'), '{}')
        utimesSync(p, mtime, mtime)
      }
      const r = sweepStaleTempDirs({ dir: root, now })
      expect(r.removed, '陈旧的隔离 TMPDIR 残留必须被清掉').toBe(1)
      expect(existsSync(join(root, 'verify-isolated-tmp-BjA8ox'))).toBe(false)
      expect(existsSync(join(root, 'verify-isolated-tmp-9xERc0')), '近期残留必须保留（排障现场）').toBe(true)
      expect(r.errors).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('清扫有界：不得超过 maxSweep 上限', () => {
    const now = Date.now()
    const root = mkdtempSync(join(tmpdir(), 'sweep-bound-'))
    const stale = new Date(now - DEFAULT_TTL_MS - 60_000)
    try {
      for (let i = 0; i < 5; i += 1) {
        const p = join(root, `dsh-shared--12345-${String(i).padStart(12, '0')}`)
        mkdirSync(p, { recursive: true })
        utimesSync(p, stale, stale)
      }
      const r = sweepStaleTempDirs({ dir: root, now, maxSweep: 2 })
      expect(r.removed, '上限 2 → 只清 2 个').toBe(2)
      expect(r.bounded, '必须显式标注触顶').toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fail-closed：目录不存在时不抛异常', () => {
    const r = sweepStaleTempDirs({ dir: join(tmpdir(), 'definitely-not-exist-xyz'), now: Date.now() })
    expect(r.removed).toBe(0)
    expect(r.errors.length).toBeGreaterThan(0)
  })
})
