/**
 * issue #418 防复发：自适应并发度（核数 + load 双约束）的纯函数单测。
 *
 * 全部注入 cpus/load1，**不制造真实高负载** —— 确定性、毫秒级。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  resolveConcurrency,
  describeConcurrency,
  normalizeCpus,
  normalizeLoad,
  parseRequested,
  MIN_CONCURRENCY,
  resolveVitestWorkers,
} from '../lib/verify-concurrency.mjs'

const V = (input) => resolveConcurrency(input).value

test('#418 按核数推导：插件测试 clamp(floor(cpus/2),1,6)', () => {
  assert.equal(V({ kind: 'plugin', cpus: 1, load1: 0 }), 1, '1 核 → 下限 1')
  assert.equal(V({ kind: 'plugin', cpus: 4, load1: 0 }), 2, '4 核（CI runner）→ 2')
  assert.equal(V({ kind: 'plugin', cpus: 10, load1: 0 }), 5, '10 核 → 5')
  assert.equal(V({ kind: 'plugin', cpus: 64, load1: 0 }), 6, '64 核 → 上界 6')
})

test('#418 按核数推导：检查项 clamp(floor(cpus/2),1,4)', () => {
  assert.equal(V({ kind: 'check', cpus: 1, load1: 0 }), 1)
  assert.equal(V({ kind: 'check', cpus: 4, load1: 0 }), 2)
  assert.equal(V({ kind: 'check', cpus: 10, load1: 0 }), 4, '10 核 → 上界 4')
  assert.equal(V({ kind: 'check', cpus: 64, load1: 0 }), 4)
})

test('#418 load 熔断：> 核数减半，> 核数×1.5 串行（边界为严格大于）', () => {
  const base = { kind: 'plugin', cpus: 10 } // base = 5
  assert.equal(V({ ...base, load1: 0 }), 5, 'load 0 → 自适应')
  assert.equal(V({ ...base, load1: 10 }), 5, 'load == 核数 → 不降级')
  assert.equal(V({ ...base, load1: 11 }), 2, 'load > 核数 → 减半 max(1,floor(5/2))=2')
  assert.equal(V({ ...base, load1: 15 }), 2, 'load == 核数×1.5 → 仍是减半档')
  assert.equal(V({ ...base, load1: 16 }), 1, 'load > 核数×1.5 → 串行')
  assert.equal(V({ ...base, load1: 999 }), 1, '远高 → 串行')
})

test('#418 显式覆盖永远优先（不被负载熔断改写）', () => {
  const d = resolveConcurrency({ requested: '8', kind: 'plugin', cpus: 10, load1: 999 })
  assert.equal(d.value, 8)
  assert.equal(d.mode, 'explicit')
  assert.equal(resolveConcurrency({ requested: 1, kind: 'check', cpus: 64, load1: 0 }).value, 1)
})

test('#418 非法显式值不静默：回落自适应并带 invalidRequested', () => {
  for (const bad of ['abc', '0', '9', '-1', '1.5', 'nope']) {
    const d = resolveConcurrency({ requested: bad, kind: 'plugin', cpus: 10, load1: 0 })
    assert.equal(d.value, 5, `非法值 ${bad} 应回落自适应`)
    assert.equal(d.invalidRequested, bad, `非法值 ${bad} 必须被带出来供上层打印`)
    assert.notEqual(d.mode, 'explicit')
  }
  assert.equal(
    resolveConcurrency({ requested: '', kind: 'plugin', cpus: 10, load1: 0 }).invalidRequested,
    undefined,
    '未设置不告警',
  )
})

test('#418 fail-closed：任何输入都返回 ≥1 整数，绝不返回 0', () => {
  const cases = [
    { cpus: 0 },
    { cpus: -1 },
    { cpus: NaN },
    { cpus: undefined },
    { cpus: 10, load1: NaN },
    { cpus: 10, load1: -5 },
    { cpus: 10, load1: Infinity },
    { cpus: 0, load1: 999 },
    { cpus: 1, load1: 999 },
  ]
  for (const kind of ['plugin', 'check']) {
    for (const c of cases) {
      const v = V({ kind, ...c })
      assert.ok(Number.isInteger(v) && v >= MIN_CONCURRENCY, `${kind} ${JSON.stringify(c)} → ${v} 必须 ≥1`)
    }
  }
  assert.equal(V({ kind: 'plugin', cpus: 0, load1: 999 }), 1, '0 核 + 极高负载仍为 1（串行），绝不为 0')
})

test('#418 归一化与报告文案', () => {
  assert.equal(normalizeCpus(0), 1)
  assert.equal(normalizeCpus(-3), 1)
  assert.equal(normalizeCpus(NaN), 1)
  assert.equal(normalizeCpus(8), 8)
  assert.equal(normalizeLoad(NaN), 0)
  assert.equal(normalizeLoad(-1), 0)
  assert.equal(normalizeLoad(Infinity), 0)
  assert.equal(normalizeLoad(2.5), 2.5)
  assert.equal(parseRequested('4', 8).ok, true)
  assert.equal(parseRequested('4', 3).ok, false, '超出该池上界即非法')
  const d = resolveConcurrency({ kind: 'plugin', cpus: 10, load1: 0 })
  const text = describeConcurrency('插件测试', d)
  assert.ok(text.includes('并发 5'), `报告须含实际值：${text}`)
  assert.ok(text.includes('核数 10') && text.includes('load 0'), `报告须含依据：${text}`)
  const degraded = describeConcurrency('插件测试', resolveConcurrency({ kind: 'plugin', cpus: 10, load1: 99 }))
  assert.ok(degraded.includes('降为串行'), `降级原因必须出现在报告里（可见、不静默）：${degraded}`)
})

test('#418 防绕过：verify-local 的并发取值只来自 resolveConcurrency 单一来源', () => {
  const src = readFileSync(fileURLToPath(new URL('../verify-local.mjs', import.meta.url)), 'utf8')
  assert.ok(
    src.includes("from './lib/verify-concurrency.mjs'"),
    'verify-local 必须 import 共享纯函数（不得自建第二份）',
  )
  const bodyOf = (name) => {
    const at = src.indexOf(`function ${name}()`)
    assert.ok(at >= 0, `未找到 ${name} 定义`)
    return src.slice(at, at + 200)
  }
  const pluginBody = bodyOf('pluginConcurrency')
  assert.ok(pluginBody.includes('concurrencyFor'), 'pluginConcurrency 必须经 concurrencyFor 走单一来源')
  assert.ok(!pluginBody.includes('return 6'), 'pluginConcurrency 不得保留硬编码默认值 6')
  const checkBody = bodyOf('checkConcurrency')
  assert.ok(checkBody.includes('concurrencyFor'), 'checkConcurrency 必须经 concurrencyFor 走单一来源')
  assert.ok(!checkBody.includes('return 4'), 'checkConcurrency 不得保留硬编码默认值 4')
})

test('#418 vitest worker 预算：插件并发 × 每路 worker ≈ 核数', () => {
  assert.equal(resolveVitestWorkers({ cpus: 10, concurrency: 5 }), 2, '10 核 / 5 路 → 每路 2')
  assert.equal(resolveVitestWorkers({ cpus: 10, concurrency: 1 }), 10, '串行时单路可用满核')
  assert.equal(resolveVitestWorkers({ cpus: 4, concurrency: 2 }), 2, '4 核 runner')
  assert.equal(resolveVitestWorkers({ cpus: 64, concurrency: 6 }), 10, '64 核 / 6 路 → 每路 10')
  for (const [cores, lanes] of [
    [10, 5],
    [4, 2],
    [64, 6],
    [1, 1],
    [10, 6],
    [2, 2],
  ]) {
    const w = resolveVitestWorkers({ cpus: cores, concurrency: lanes })
    assert.ok(Number.isInteger(w) && w >= 1, `${cores} 核 × ${lanes} 路 → 每路 ${w} 必须 ≥1`)
    assert.ok(lanes * w <= Math.max(cores, lanes), `${cores} 核 × ${lanes} 路 → 乘积 ${lanes * w} 不得超过核数`)
  }
})

test('#418 vitest worker 预算 fail-closed + 显式覆盖下的取值', () => {
  const bads = [
    {},
    { cpus: 0 },
    { cpus: -1 },
    { cpus: NaN, concurrency: 3 },
    { cpus: 10, concurrency: 0 },
    { cpus: 10, concurrency: NaN },
  ]
  for (const bad of bads) {
    const w = resolveVitestWorkers(bad)
    assert.ok(Number.isInteger(w) && w >= 1, `${JSON.stringify(bad)} → ${w} 必须 ≥1，绝不 0`)
  }
  // 显式 VERIFY_CONCURRENCY 优先 → worker 预算跟随显式值计算（不被负载改写）
  const explicit = resolveConcurrency({ requested: '8', kind: 'plugin', cpus: 10, load1: 999 })
  assert.equal(explicit.value, 8, '显式覆盖不被负载改写')
  assert.equal(
    resolveVitestWorkers({ cpus: explicit.cpus, concurrency: explicit.value }),
    1,
    '8 路 → 每路 1 worker（乘积 8 ≤ 核数 10）',
  )
})
