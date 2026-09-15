/**
 * #327 回归：投毒扫描 `readText` 的「类型闸门 + 字节账」。
 *
 * 背景：`76f52ac` 为消除 CodeQL `js/file-system-race`，把「`stat` 先检查再 `readFile`」
 * 改成「`readFile` 后判 `content.length`」，告警归零但引入两处退化：
 *   ① `!info.isFile()` 类型闸门与 `size > MAX_SCAN_FILE_BYTES` 的**读前**拒绝一起丢失
 *      → 上限判定发生在读完之后（FIFO 可永久阻塞、`/dev/zero` 可 OOM）；
 *   ② `handle.bytes += info.size`（**字节**）退化成 `content.length`（UTF-16 码元）
 *      → 中文/emoji 源码字节账最多低估 3 倍，`scannedBytes` 上报失真、预算被变相放宽。
 *
 * 正解：`stat` 与 `read` 走**同一个 fd**（`open` → `fh.stat()` → `fh.readFile()`），
 * 竞态、类型闸门、字节账、读前拒绝四项同时成立——不是拿任何一条换另一条。
 *
 * 断言口径刻意钉在「字节数」与「具体 errno 类别」上：只断言「返回 null / 被跳过」的实现
 * 退化后依然能通过，等于没测。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import tmp from 'tmp'
import { classifyReadFailure, readText, scanPackage } from '../lib/poison.js'
import { MAX_SCAN_FILE_BYTES } from '../lib/constants.js'

const tmpDirs = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    // 权限位被改过的 fixture 也要能清掉（0o000 文件在部分实现下会让 rm 静默失败）
    try {
      execFileSync('chmod', ['-R', 'u+rwX', dir])
    } catch {
      /* 目录已可写或已消失 */
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(prefix = 'dsh-guard-read-limits-') {
  const dir = tmp.dirSync({ prefix, unsafeCleanup: true }).name
  tmpDirs.push(dir)
  return dir
}

/** 与 ScanHandle 同形的测试句柄。 */
function handle() {
  return { findings: [], files: 0, bytes: 0, skipped: {} }
}

// ── ① 字节账（不是 UTF-16 码元账）────────────────────────────────────────────

test('#327 scannedBytes 按字节计：3000 字节中文源码不得记成 1000 码元', async () => {
  const dir = tempDir()
  const cn = '中'.repeat(1000)
  assert.equal(Buffer.byteLength(cn, 'utf8'), 3000, 'fixture 前提：1000 个汉字 = 3000 字节')
  assert.equal(cn.length, 1000, 'fixture 前提：UTF-16 码元数只有 1000')
  writeFileSync(join(dir, 'cn.js'), cn)

  const result = await scanPackage(dir)
  assert.equal(result.scannedFiles, 1)
  assert.equal(result.scannedBytes, 3000, 'scannedBytes 必须是字节数（常量名就是 MAX_SCAN_FILE_BYTES）')
})

test('#327 scannedBytes 对 emoji（4 字节 / 2 码元）同样计字节', async () => {
  const dir = tempDir()
  const emoji = '😀'.repeat(250)
  assert.equal(Buffer.byteLength(emoji, 'utf8'), 1000)
  assert.equal(emoji.length, 500)
  writeFileSync(join(dir, 'emoji.js'), emoji)

  const result = await scanPackage(dir)
  assert.equal(result.scannedBytes, 1000)
})

test('#327 中文内容仍进内容规则扫描（字节账修正不得影响检测能力）', async () => {
  const dir = tempDir()
  const body = `// 说明：${'中'.repeat(100)}\n-----BEGIN RSA PRIVATE KEY-----\n`
  writeFileSync(join(dir, 'leaky.js'), body)

  const result = await scanPackage(dir)
  assert.ok(
    result.findings.some((f) => f.id === 'secret'),
    '中文源码里的私钥仍要被抓到',
  )
  assert.equal(result.scannedBytes, Buffer.byteLength(body, 'utf8'))
})

// ── ② 类型闸门：非普通文件在读之前就被拒 ────────────────────────────────────

test('#327 FIFO 不被读入：readText 立即返回而不是永久阻塞', { timeout: 20_000 }, async () => {
  const dir = tempDir()
  const fifo = join(dir, 'pipe.js')
  execFileSync('mkfifo', [fifo])

  const h = handle()
  const outcome = await Promise.race([
    readText(fifo, h).then((value) => ({ kind: 'returned', value })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 3000)),
  ])

  assert.equal(outcome.kind, 'returned', '带超时断言：FIFO 上必须立即返回（旧实现 readFile 会挂起）')
  assert.equal(outcome.value, null)
  assert.equal(h.bytes, 0, 'FIFO 不计入字节账')
  assert.equal(h.skipped?.['not-a-file'], 1, '分类到「非普通文件」而不是静默丢弃')
})

test.skipIf(process.platform === 'win32')('#327 字符设备不被读入（/dev/null 归入非普通文件）', async () => {
  const h = handle()
  assert.equal(await readText('/dev/null', h), null, '非普通文件必须返回 null，而不是读到的空串')
  assert.equal(h.skipped?.['not-a-file'], 1)
})

test('#327 目录路径归入「非普通文件」，不静默吞掉 EISDIR', async () => {
  const h = handle()
  assert.equal(await readText(tempDir(), h), null)
  assert.equal(h.skipped?.['not-a-file'], 1)
})

// ── ③ errno 按类别区分（不再是裸 catch 吞全部）──────────────────────────────

test('#327 不存在的路径归入「文件不存在」', async () => {
  const h = handle()
  assert.equal(await readText(join(tempDir(), 'nope.js'), h), null)
  assert.equal(h.skipped?.['not-found'], 1)
})

test.skipIf(process.getuid?.() === 0)('#327 权限拒绝归入「权限不足」', async () => {
  const dir = tempDir()
  const file = join(dir, 'locked.js')
  writeFileSync(file, 'const locked = 1\n')
  chmodSync(file, 0o000)

  const h = handle()
  assert.equal(await readText(file, h), null)
  assert.equal(h.skipped?.['permission-denied'], 1, 'root 之外必须区分权限拒绝与不存在')
})

test('#327 classifyReadFailure 的 errno → 类别映射', () => {
  const err = (code) => Object.assign(new Error(code), { code })
  assert.equal(classifyReadFailure(err('EISDIR')), 'not-a-file')
  assert.equal(classifyReadFailure(err('ENOTDIR')), 'not-a-file')
  assert.equal(classifyReadFailure(err('EACCES')), 'permission-denied')
  assert.equal(classifyReadFailure(err('EPERM')), 'permission-denied')
  assert.equal(classifyReadFailure(err('ENOENT')), 'not-found')
  assert.equal(classifyReadFailure(err('EIO')), 'io-error')
  assert.equal(classifyReadFailure(new Error('no code')), 'io-error')
  assert.equal(classifyReadFailure(null), 'io-error')
})

// ── ④ 上限语义：超限文件在读之前被拒 ────────────────────────────────────────

test('#327 超过 MAX_SCAN_FILE_BYTES 的文件在读之前被拒（不入字节账）', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'big.js'), 'x'.repeat(MAX_SCAN_FILE_BYTES + 1))

  const result = await scanPackage(dir)
  assert.equal(result.scannedBytes, 0, '超限文件不得计入字节账')
  assert.equal(result.skipped?.['too-large'], 1)
})

test('#327 恰好等于上限的文件仍被扫描（边界不误拒）', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'edge.js'), 'x'.repeat(MAX_SCAN_FILE_BYTES))

  const result = await scanPackage(dir)
  assert.equal(result.scannedBytes, MAX_SCAN_FILE_BYTES)
  assert.equal(result.skipped?.['too-large'], undefined)
})

// ── ⑤ 防「永不读」假绿：普通文件必须真被读入 ───────────────────────────────

test('#327 普通文件仍被读入（防"一律跳过"的假绿）', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'a.js'), 'const a = 1\n')

  const result = await scanPackage(dir)
  assert.equal(result.scannedFiles, 1)
  assert.equal(result.scannedBytes, 12)
  assert.deepEqual(result.skipped, {})
})
