/**
 * dsh-my-memory — issue #78 progressive memory scoring tests:
 * structured metadata defaults (legacy-compatible), same-theme detection,
 * progressive merge (confidence up / content update / conflict marker),
 * long-idle decay, and the smart injection scorer (relevance + recency +
 * confidence — replacing the plain top-N pick).
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  DEFAULT_DECAY_MS,
  DEFAULT_HALF_LIFE_MS,
  MAX_CONFIDENCE,
  MIN_CONFIDENCE,
  categoryLabel,
  decayConfidence,
  mergeCandidate,
  pickForInjection,
  relevanceOf,
  sameTheme,
  scoreForInjection,
  themeKeyOf,
  withDefaults,
} from '../lib/memory-scoring.js'

const NOW = 1_800_000_000_000

test('withDefaults fills legacy items with issue #78 metadata defaults', () => {
  const legacy = { id: 'old', desc: '旧条目', createdAt: 1, updatedAt: 2 }
  const upgraded = withDefaults(legacy, NOW)
  assert.equal(upgraded.category, DEFAULT_CATEGORY, 'legacy items default to fact')
  assert.equal(upgraded.confidence, 1, 'legacy items start at confidence 1')
  assert.equal(upgraded.status, 'active')
  assert.deepEqual(upgraded.source, { sessionId: '', at: 0 }, 'empty source default')
  assert.deepEqual(upgraded.relatedIds, [], 'empty relatedIds default')
  assert.deepEqual(upgraded.history, [], 'empty history default')
  assert.equal(upgraded.desc, '旧条目', 'desc preserved verbatim')
})

test('withDefaults keeps existing metadata and tolerates junk input', () => {
  const item = {
    id: 'a',
    desc: '偏好',
    createdAt: 1,
    updatedAt: 2,
    category: 'preference',
    confidence: 3,
    status: 'conflict-pending',
    source: { sessionId: 's1', at: 5 },
    relatedIds: ['x'],
    history: [{ at: 1, action: 'reinforce', desc: '旧' }],
  }
  const kept = withDefaults(item, NOW)
  assert.equal(kept.category, 'preference')
  assert.equal(kept.confidence, 3)
  assert.equal(kept.status, 'conflict-pending')
  assert.equal(kept.source.sessionId, 's1')
  assert.equal(kept.relatedIds.length, 1)
  assert.equal(kept.history.length, 1)
  // 容错
  const junk = withDefaults({ id: 'b', desc: 'x', createdAt: 1, updatedAt: 2, confidence: 0, status: 'bogus' }, NOW)
  assert.equal(junk.confidence, 1, 'confidence < 1 falls back')
  assert.equal(junk.status, 'active', 'unknown status falls back')
  assert.equal(withDefaults(null, NOW).id, '', 'null input tolerated')
})

test('CATEGORIES covers the issue #78 taxonomy with zh labels', () => {
  assert.deepEqual(CATEGORIES, ['preference', 'fact', 'project', 'stack', 'workflow'])
  assert.equal(categoryLabel('preference'), '偏好')
  assert.equal(categoryLabel('stack'), '技术栈')
  assert.equal(categoryLabel('nope'), '事实', 'unknown category falls back to fact')
})

test('themeKeyOf combines category and normalized desc', () => {
  const a = themeKeyOf({ desc: '回复使用中文', category: 'preference', id: 'x', createdAt: 1, updatedAt: 2 })
  const b = themeKeyOf({ desc: '回复使用中文', category: 'preference', id: 'y', createdAt: 1, updatedAt: 2 })
  const c = themeKeyOf({ desc: '回复使用英文', category: 'preference', id: 'z', createdAt: 1, updatedAt: 2 })
  assert.equal(a, b, 'same theme key for same normalized desc')
  assert.notEqual(a, c, 'different desc → different key')
})

test('sameTheme requires same category and contained normalized text', () => {
  const base = { id: 'a', desc: '回复使用中文', category: 'preference', createdAt: 1, updatedAt: 2 }
  const worded = { id: 'b', desc: '回复必须使用中文', category: 'preference', createdAt: 1, updatedAt: 2 }
  const english = { id: 'c', desc: '回复使用英文', category: 'preference', createdAt: 1, updatedAt: 2 }
  const fact = { id: 'd', desc: '回复使用中文', category: 'fact', createdAt: 1, updatedAt: 2 }
  const stack = { id: 'e', desc: '回复使用中文', category: 'stack', createdAt: 1, updatedAt: 2 }
  const factOther = { id: 'f', desc: '我在写另一个东西', category: 'fact', createdAt: 1, updatedAt: 2 }
  assert.equal(sameTheme(base, worded), true, 'same intent, stronger wording → same theme')
  assert.equal(sameTheme(base, english), false, 'opposite conclusion → different theme')
  assert.equal(sameTheme(base, fact), true, 'default-fact manual entry merges into a real category (no duplicate rows)')
  assert.equal(sameTheme(base, stack), false, 'two explicit categories stay distinct (no cross-dimension collapse)')
  assert.equal(sameTheme(base, factOther), false, 'different desc + different category → not the same theme')
  assert.equal(sameTheme(base, { ...base }), true, 'identical items are the same theme')
})

test('mergeCandidate adds a brand-new theme with confidence 1 and source', () => {
  const candidate = {
    id: 'cand-1',
    desc: '回复使用中文',
    category: 'preference',
    source: { sessionId: 's1', at: NOW },
    createdAt: NOW,
  }
  const result = mergeCandidate([], candidate, NOW)
  assert.equal(result.outcome, 'added')
  assert.equal(result.items.length, 1)
  const item = result.items[0]
  assert.equal(item.confidence, 1)
  assert.equal(item.desc, '回复使用中文')
  assert.equal(item.source.sessionId, 's1')
  assert.equal(item.status, 'active')
})

test('mergeCandidate reinforces the same theme: confidence+1 and content update', () => {
  const existing = [
    {
      id: 'm1',
      desc: '回复使用中文',
      category: 'preference',
      createdAt: 1,
      updatedAt: 2,
      confidence: 1,
      status: 'active',
    },
  ]
  const candidate = {
    id: 'cand-2',
    desc: '回复使用中文',
    category: 'preference',
    source: { sessionId: 's2', at: NOW },
    createdAt: NOW,
  }
  const result = mergeCandidate(existing, candidate, NOW)
  assert.equal(result.outcome, 'reinforced')
  assert.equal(result.items.length, 1, 'no duplicate row')
  const item = result.items[0]
  assert.equal(item.confidence, 2, 'confidence raised on repeat')
  assert.equal(item.updatedAt, NOW, 'updatedAt refreshed')
  assert.equal(item.history.length, 1, 'evolution history recorded')
  assert.equal(item.history[0].action, 'reinforce')
  assert.equal(item.status, 'active')
})

test('mergeCandidate caps confidence at MAX_CONFIDENCE across repeats', () => {
  let items = []
  for (let i = 0; i < MAX_CONFIDENCE + 3; i += 1) {
    const candidate = {
      id: `cand-${i}`,
      desc: '重复的偏好',
      category: 'preference',
      source: { sessionId: 's', at: NOW + i },
      createdAt: NOW + i,
    }
    items = mergeCandidate(items, candidate, NOW + i).items
  }
  const top = items[0]
  assert.equal(top.confidence, MAX_CONFIDENCE, 'confidence never exceeds the cap')
  assert.equal(items.length, 1, 'same theme never duplicates')
})

test('mergeCandidate marks a conflict when the same theme diverges in wording', () => {
  const existing = [
    {
      id: 'm1',
      desc: '回复使用中文',
      category: 'preference',
      createdAt: 1,
      updatedAt: 2,
      confidence: 2,
      status: 'active',
    },
  ]
  const candidate = {
    id: 'cand-3',
    desc: '回复必须使用中文，代码注释也要中文',
    category: 'preference',
    source: { sessionId: 's3', at: NOW },
    createdAt: NOW,
  }
  const result = mergeCandidate(existing, candidate, NOW)
  assert.equal(result.outcome, 'conflicted')
  const item = result.items[0]
  assert.equal(item.desc, '回复必须使用中文，代码注释也要中文', 'new content takes effect (user confirmed it)')
  assert.equal(item.status, 'conflict-pending', 'conflict marked pending')
  assert.equal(item.confidence, 3, 'confidence still raised')
  assert.equal(item.history.length, 1)
  assert.equal(item.history[0].action, 'conflict', 'history records the conflict update')
})

test('decayConfidence lowers confidence for long-idle memories only', () => {
  const recent = { id: 'r', desc: '最近', category: 'fact', createdAt: NOW, updatedAt: NOW, confidence: 3 }
  const stale = { id: 's', desc: '很久没用', category: 'fact', createdAt: 1, updatedAt: 1, confidence: 3 }
  const result = decayConfidence([recent, stale], NOW, DEFAULT_DECAY_MS)
  assert.equal(result.items[0].confidence, 3, 'recent memory unchanged')
  assert.equal(result.items[1].confidence, 2, 'stale memory decays by one')
  assert.ok(result.items[1].confidence >= MIN_CONFIDENCE)
})

test('decayConfidence never drops confidence below the floor', () => {
  const ancient = { id: 'a', desc: '上古条目', category: 'fact', createdAt: 1, updatedAt: 1, confidence: 1 }
  const result = decayConfidence([ancient], NOW, 1)
  assert.equal(result.items[0].confidence, MIN_CONFIDENCE, 'confidence floor respected')
})

test('decayConfidence respects a custom threshold (fresh within it)', () => {
  const m = { id: 'm', desc: 'x', category: 'fact', createdAt: NOW - 60_000, updatedAt: NOW - 60_000, confidence: 2 }
  const result = decayConfidence([m], NOW, 3 * 24 * 60 * 60 * 1000)
  assert.equal(result.items[0].confidence, 2, 'one minute < 3 days → no decay')
})

test('relevanceOf scores keyword hits against the desc', () => {
  assert.equal(relevanceOf('', []), 0)
  assert.equal(relevanceOf('回复使用中文', ['中文']), 1)
  assert.equal(relevanceOf('回复使用中文', ['中文', '英文']), 0.5)
  assert.equal(relevanceOf('回复使用中文', ['英文']), 0)
  assert.equal(relevanceOf('x', ['']), 0, 'empty keywords ignored')
})

test('scoreForInjection mixes relevance, recency and confidence', () => {
  const item = { id: 'm', desc: '回复使用中文', category: 'preference', confidence: 2, createdAt: NOW, updatedAt: NOW }
  // 新鲜 + 命中关键词 + 较高置信度 → 高分
  const hot = scoreForInjection(item, { keywords: ['中文'] }, { now: NOW, maxConfidence: 2 })
  assert.equal(hot.score, 1, 'all three factors at max → score 1')
  // 非常旧（时效性 → 0）→ 分数下降
  const aged = scoreForInjection(item, { keywords: ['中文'] }, { now: NOW + 365 * 24 * 3600_000, maxConfidence: 2 })
  assert.ok(aged.score < hot.score, 'age lowers the score')
  // 不相关（relevance → 0）→ 分数下降
  const unrelated = scoreForInjection(item, { keywords: ['vitest'] }, { now: NOW, maxConfidence: 2 })
  assert.ok(unrelated.score < hot.score, 'irrelevance lowers the score')
  // 低置信度归一化 → 分数下降
  const lowConf = scoreForInjection({ ...item, confidence: 1 }, { keywords: ['中文'] }, { now: NOW, maxConfidence: 2 })
  assert.ok(lowConf.score < hot.score, 'lower confidence lowers the score')
})

test('pickForInjection picks by score, not by newest (issue #78)', () => {
  const now = NOW
  const items = [
    // 新但无关（relevance 0）
    {
      id: 'new-irrelevant',
      desc: '无关的非常新条目',
      category: 'fact',
      confidence: 1,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    },
    // 旧但相关且高置信度 → 应当被选中
    {
      id: 'old-relevant',
      desc: '回复使用中文',
      category: 'preference',
      confidence: 5,
      createdAt: now - 30 * 24 * 3600_000,
      updatedAt: now - 30 * 24 * 3600_000,
    },
    // 相关且新 → 最高分
    {
      id: 'fresh-relevant',
      desc: '代码注释用中文',
      category: 'preference',
      confidence: 2,
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
    },
  ]
  const context = { keywords: ['中文'] }
  const { picked } = pickForInjection(items, context, { now, maxItems: 2 })
  assert.deepEqual(
    picked.map((i) => i.id),
    ['fresh-relevant', 'old-relevant'],
    'relevance + confidence beat plain recency for the picks',
  )
  assert.equal(picked.length, 2, 'maxItems respected')
})

test('pickForInjection respects maxItems and tolerates junk items', () => {
  const items = [
    { id: 'a', desc: '第一条', category: 'fact', confidence: 1, createdAt: NOW, updatedAt: NOW },
    { id: 'b', desc: '第二条', category: 'preference', confidence: 1, createdAt: NOW, updatedAt: NOW },
    { id: 'c', desc: '第三条', category: 'stack', confidence: 1, createdAt: NOW, updatedAt: NOW },
    null,
    'junk',
  ]
  const { picked } = pickForInjection(items, {}, { now: NOW, maxItems: 2 })
  assert.equal(picked.length, 2, 'junk items ignored, maxItems respected')
  const all = pickForInjection(items, {}, { now: NOW, maxItems: 99 }).picked
  assert.equal(all.length, 3, 'all well-formed items returned when cap is large')
})

test('pickForInjection does not mutate the input list', () => {
  const items = [{ id: 'a', desc: 'x', category: 'fact', confidence: 1, createdAt: NOW, updatedAt: NOW }]
  pickForInjection(items, {}, { now: NOW, maxItems: 5 })
  assert.equal(items.length, 1, 'input untouched')
  assert.equal(items[0].id, 'a')
})

test('DEFAULT_DECAY_MS and DEFAULT_HALF_LIFE_MS are sane', () => {
  assert.equal(DEFAULT_DECAY_MS, 90 * 24 * 60 * 60 * 1000, '90-day decay threshold')
  assert.equal(DEFAULT_HALF_LIFE_MS, 7 * 24 * 60 * 60 * 1000, '7-day recency half-life')
})

// ── issue #518：恒定（pinned）通道 ───────────────────────────────────

test('withDefaults defaults pinned to false and preserves an explicit true (issue #518)', () => {
  assert.equal(withDefaults({ id: 'a', desc: 'x' }, NOW).pinned, false, 'legacy items are not pinned')
  assert.equal(withDefaults({ id: 'b', desc: 'y', pinned: true }, NOW).pinned, true, 'explicit pin preserved')
})

test('pickForInjection routes pinned items into their own channel, out of the scored top-N (issue #518)', () => {
  const old = NOW - 90 * 24 * 60 * 60 * 1000
  const items = [
    { id: 'pin', desc: '禁止创建 goal 任务', pinned: true, confidence: 1, createdAt: old, updatedAt: old },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: 's' + index,
      desc: '普通' + index,
      confidence: 1,
      createdAt: NOW,
      updatedAt: NOW - index * 1000,
    })),
  ]
  const { picked, pinned, pinnedDropped } = pickForInjection(items, {}, { now: NOW, maxItems: 2 })
  assert.deepEqual(
    picked.map((item) => item.id),
    ['s0', 's1'],
    'scored channel ignores the pinned item',
  )
  assert.deepEqual(
    pinned.map((item) => item.id),
    ['pin'],
    'pinned item still injected although it is 90 days old (the real failure this fixes)',
  )
  assert.equal(pinnedDropped, 0)
})

test('pinned channel has its own cap and reports the overflow (issue #518)', () => {
  const items = [1, 2, 3].map((n) => ({
    id: 'p' + n,
    desc: '恒定' + n,
    pinned: true,
    createdAt: NOW,
    updatedAt: NOW - n,
  }))
  const { pinned, pinnedDropped } = pickForInjection(items, {}, { now: NOW, pinnedMax: 2 })
  assert.deepEqual(
    pinned.map((item) => item.id),
    ['p1', 'p2'],
    'newest pinned first, capped at 2',
  )
  assert.equal(pinnedDropped, 1, 'overflow counted, never silent')
})

test('pinned: false behaves exactly like a legacy item (no channel split)', () => {
  const items = [{ id: 'a', desc: 'x', pinned: false, confidence: 1, createdAt: NOW, updatedAt: NOW }]
  const { picked, pinned } = pickForInjection(items, {}, { now: NOW, maxItems: 5 })
  assert.equal(picked.length, 1)
  assert.equal(pinned.length, 0)
})
