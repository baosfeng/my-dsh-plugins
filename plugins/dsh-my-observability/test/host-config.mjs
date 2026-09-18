/**
 * dsh-my-observability — 设置页配置端点契约测试（issue #383）。
 *
 * 设置 → 插件 → 可观测性 面板读写的两项配置（aiReview / aiTimeoutMs）走
 * `/observability/api/config`：
 *  1. GET 返回**当前生效值**（设置页表单回填）；
 *  2. PUT 校验后写回 profile 层 patch 文件（行 id = `observability`，与
 *     cordis.patch.yml 中的插件行 id 一致）、立即更新内存（保存即生效）；
 *  3. **非法值不写坏配置**：aiReview 非布尔 → 忽略（保持原值）；
 *     aiTimeoutMs 非正/非有限 → 回退默认 60000；
 *  4. 写回**保留 patch 条目里手写的其他键**（aiProvider / resourceIntervalMs
 *     等只在 cordis.patch.yml 里配的字段不得被设置页保存抹掉）；
 *  5. 既有路由契约不变（status / 404 / 403 围栏）。
 *
 * 写回一律在临时 DSH_HOME（bootPlugin 注入）下进行，绝不触碰真实 profile。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { extractConfig } from 'dsh-shared'
import { bootPlugin, mockRequest, mockResponse, invoke, jsonOf } from './lib/helpers.mjs'

const CONFIG_API = '/observability/api/config'
/** 写回行 id：必须与 plugins/dsh-my-observability/cordis.patch.yml 的插件行 id 一致。 */
const ROW_ID = 'observability'
const DEFAULT_TIMEOUT_MS = 60000

/** profile 层 patch 文件路径（临时 DSH_HOME 下，currentProfile 默认 web）。 */
function patchPathOf(home) {
  return join(home, 'profiles', 'web', 'cordis.patch.yml')
}

/** 预置 patch 文件（模拟用户手写 config 的场景）。 */
function seedPatch(home, text) {
  const file = patchPathOf(home)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
  return file
}

/** 调用配置端点。 */
async function callConfig(boot, { method = 'GET', body } = {}) {
  const request = mockRequest({ url: CONFIG_API, method, ...(body === undefined ? {} : { body }) })
  const response = await invoke(boot.api, request, mockResponse())
  return { status: response.writeHeadStatus, body: jsonOf(response) }
}

test('GET /config 返回当前生效的 aiReview 与 aiTimeoutMs（含默认值）', async () => {
  const boot = bootPlugin()
  try {
    const res = await callConfig(boot)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true, value: { aiReview: true, aiTimeoutMs: DEFAULT_TIMEOUT_MS } })
  } finally {
    await boot.disposeAll()
  }
})

test('PUT /config 写回 profile patch 并立即生效（保存即应用）', async () => {
  const boot = bootPlugin({ aiReview: true, aiTimeoutMs: 12345 })
  try {
    assert.deepEqual((await callConfig(boot)).body.value, { aiReview: true, aiTimeoutMs: 12345 })

    const put = await callConfig(boot, {
      method: 'PUT',
      body: JSON.stringify({ aiReview: false, aiTimeoutMs: 30000 }),
    })
    assert.equal(put.status, 200)
    assert.equal(put.body.ok, true)

    // 写回 patch：行 id 与插件行一致，值可被 loader 重新解析（重启不丢）
    const patch = readFileSync(patchPathOf(boot.home), 'utf8')
    assert.ok(patch.includes(`- id: ${ROW_ID}`), `写回条目行 id 必须是 ${ROW_ID}，实际：\n${patch}`)
    assert.deepEqual(extractConfig(patch, ROW_ID), { aiReview: false, aiTimeoutMs: 30000 })

    // 立即生效：GET（表单回填源）与 status（功能开关）都反映新值
    assert.deepEqual((await callConfig(boot)).body.value, { aiReview: false, aiTimeoutMs: 30000 })
    const status = await invoke(boot.api, mockRequest({ url: '/observability/api/status' }), mockResponse())
    assert.equal(jsonOf(status).value.aiReview, false)
  } finally {
    await boot.disposeAll()
  }
})

test('PUT /config 非法值不写坏配置：aiReview 非布尔忽略、aiTimeoutMs 非法回退 60000', async () => {
  const boot = bootPlugin({ aiReview: true, aiTimeoutMs: 9000 })
  try {
    // aiReview 非布尔 → 忽略该字段（保持原值 true）；aiTimeoutMs 非法 → 回退默认
    const bad = await callConfig(boot, {
      method: 'PUT',
      body: JSON.stringify({ aiReview: 'yes', aiTimeoutMs: -1 }),
    })
    assert.equal(bad.status, 200)
    assert.deepEqual(bad.body.value, { aiReview: true, aiTimeoutMs: DEFAULT_TIMEOUT_MS })

    const patch = readFileSync(patchPathOf(boot.home), 'utf8')
    assert.deepEqual(extractConfig(patch, ROW_ID), { aiReview: true, aiTimeoutMs: DEFAULT_TIMEOUT_MS })
    assert.ok(!/aiReview: 'yes'/.test(patch), '非法 aiReview 不得写进 patch')
    assert.ok(!/aiTimeoutMs: -1/.test(patch), '非法 aiTimeoutMs 不得写进 patch')

    // 其余非法形态：0 / null / 字符串 / 数组 / Infinity（JSON 用 1e999 表达）
    for (const body of [
      '{"aiTimeoutMs":0}',
      '{"aiTimeoutMs":null}',
      '{"aiTimeoutMs":"abc"}',
      '{"aiTimeoutMs":[]}',
      '{"aiTimeoutMs":1e999}',
    ]) {
      const res = await callConfig(boot, { method: 'PUT', body })
      assert.equal(res.status, 200, `${body} 不应报错`)
      assert.equal(res.body.value.aiTimeoutMs, DEFAULT_TIMEOUT_MS, `${body} 应回退默认 60000`)
    }
  } finally {
    await boot.disposeAll()
  }
})

test('PUT /config 部分字段：只提交合法字段时其余字段保持当前值', async () => {
  const boot = bootPlugin({ aiReview: false, aiTimeoutMs: 45000 })
  try {
    const res = await callConfig(boot, { method: 'PUT', body: JSON.stringify({ aiTimeoutMs: 5000 }) })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.value, { aiReview: false, aiTimeoutMs: 5000 })

    const patch = readFileSync(patchPathOf(boot.home), 'utf8')
    assert.deepEqual(extractConfig(patch, ROW_ID), { aiReview: false, aiTimeoutMs: 5000 })
  } finally {
    await boot.disposeAll()
  }
})

test('PUT /config 保留 patch 条目中手写的其他配置键（不扩大设置页范围）', async () => {
  const boot = bootPlugin()
  try {
    // profile 层 patch 的条目形态：顶层 `- id: <行 id>` + `config:` 块
    // （writePatchConfig / extractConfig 认这一种；bundle 的 `- insert:`
    // 嵌套形态是插件自带补丁，不是 profile 层用户配置）。
    seedPatch(
      boot.home,
      ['- id: observability', '  config:', "    aiProvider: 'deepseek'", '    resourceIntervalMs: 30000', ''].join(
        '\n',
      ),
    )

    const res = await callConfig(boot, { method: 'PUT', body: JSON.stringify({ aiReview: false, aiTimeoutMs: 20000 }) })
    assert.equal(res.status, 200)

    const config = extractConfig(readFileSync(patchPathOf(boot.home), 'utf8'), ROW_ID)
    assert.equal(config.aiProvider, 'deepseek', '手写的 aiProvider 不得被设置页保存抹掉')
    assert.equal(config.resourceIntervalMs, 30000, '手写的 resourceIntervalMs 不得被设置页保存抹掉')
    assert.deepEqual(
      { aiReview: config.aiReview, aiTimeoutMs: config.aiTimeoutMs },
      { aiReview: false, aiTimeoutMs: 20000 },
    )
  } finally {
    await boot.disposeAll()
  }
})

test('写回失败如实报错：不误报已保存，内存配置保持旧值', async () => {
  const boot = bootPlugin({ aiReview: true, aiTimeoutMs: 7000 })
  try {
    // 把 DSH_HOME 指向一个**文件**：profile 目录 mkdir 必然 ENOTDIR 失败 →
    // writePatchConfig 抛错（模拟磁盘不可写/权限问题）。
    const blocker = join(boot.home, 'not-a-dir')
    writeFileSync(blocker, 'x', 'utf8')
    process.env.DSH_HOME = blocker

    const res = await callConfig(boot, { method: 'PUT', body: JSON.stringify({ aiReview: false, aiTimeoutMs: 1000 }) })
    assert.equal(res.status, 400, '写盘失败必须如实报错（不得返回 ok: true）')
    assert.equal(res.body.ok, false)

    process.env.DSH_HOME = boot.home
    // 内存不被写坏：写盘失败时保持旧值（否则内存与磁盘劈叉）
    assert.deepEqual((await callConfig(boot)).body.value, { aiReview: true, aiTimeoutMs: 7000 })
  } finally {
    if (process.env.DSH_HOME !== undefined && process.env.DSH_HOME.endsWith('not-a-dir')) {
      process.env.DSH_HOME = boot.home
    }
    await boot.disposeAll()
  }
})

test('既有路由契约不变：status / 未知方法 404 / 非本机来源 403', async () => {
  const boot = bootPlugin()
  try {
    const status = await invoke(boot.api, mockRequest({ url: '/observability/api/status' }), mockResponse())
    const statusBody = jsonOf(status)
    assert.equal(status.writeHeadStatus, 200)
    assert.equal(typeof statusBody.value.auditCount, 'number')
    assert.equal(statusBody.value.aiReview, true)

    const unknown = await invoke(boot.api, mockRequest({ url: '/observability/api/nope' }), mockResponse())
    assert.equal(unknown.writeHeadStatus, 404)

    // 配置端点的动词也要受匹配约束：DELETE 不属于已声明契约
    const wrongVerb = await invoke(boot.api, mockRequest({ url: CONFIG_API, method: 'DELETE' }), mockResponse())
    assert.equal(wrongVerb.writeHeadStatus, 404)

    const fenced = await invoke(
      boot.api,
      mockRequest({ url: CONFIG_API, host: 'evil.example.com', secFetchSite: 'cross-site' }),
      mockResponse(),
    )
    assert.equal(fenced.writeHeadStatus, 403)
  } finally {
    await boot.disposeAll()
  }
})
