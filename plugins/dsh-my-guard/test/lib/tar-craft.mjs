/**
 * 测试专用 tar 构造器：按 tar 物理格式（512 字节 header + 数据块）直接拼字节，
 * 用来造**恶意 tarball**——穿越路径 / 绝对路径 / 盘符 / 软硬链接逃逸 /
 * GNU longname·PAX 覆盖 / 解压炸弹。
 *
 * 为什么不用系统 tar 造：tar 自己会规范化路径（拦 `..`、剥 `/` 前缀），
 * 这些输入它根本产生不出来（CodeQL #105 加固要防的正是这类包）。
 *
 * 本文件位于 test/lib/，vitest include（test/*.mjs）不会收集它。
 */
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const BLOCK = 512

/** 八进制字段（长度含结尾 NUL）。 */
function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`
}

/** 造一个 entry（header + 数据块 + 填充）。`size` 可覆盖 header 里声明的体积（炸弹用例）。 */
export function entry(name, { data = '', type = '0', link = '', size, mode = 0o644 } = {}) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const header = Buffer.alloc(BLOCK)
  header.write(name, 0, 100, 'utf8')
  header.write(octal(mode, 8), 100, 8)
  header.write(octal(0, 8), 108, 8)
  header.write(octal(0, 8), 116, 8)
  header.write(octal(size ?? body.length, 12), 124, 12)
  header.write(octal(0, 12), 136, 12)
  header.write('        ', 148, 8)
  header.write(type, 156, 1)
  header.write(link, 157, 100, 'utf8')
  header.write('ustar\0', 257, 6)
  header.write('00', 263, 2)
  writeChecksum(header)
  return Buffer.concat([header, body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK)])
}

/** 写入 8 字节校验和字段（计算时该字段按 8 个空格计）。 */
function writeChecksum(header) {
  let sum = 0
  for (let index = 0; index < BLOCK; index += 1) sum += header[index]
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8)
}

/** 目录 entry（0o755：权限位必须可进入，否则解包出来的目录无法读写）。 */
export function dir(name) {
  return entry(name, { type: '5', mode: 0o755 })
}

/** 软链接 entry。 */
export function symlink(name, link) {
  return entry(name, { type: '2', link })
}

/** 硬链接 entry。 */
export function hardlink(name, link) {
  return entry(name, { type: '1', link })
}

/** PAX 扩展头：records 形如 `[['path', '../evil']]`；type `x` 局部、`g` 全局。 */
export function pax(records, type = 'x') {
  return entry('PaxHeaders/x', { type, data: records.map(([key, value]) => paxRecord(key, value)).join('') })
}

/** PAX 记录：`<总长> <key>=<value>\n`，总长含自身的十进制位数。 */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`
  let length = Buffer.byteLength(body) + 1
  while (String(length).length + Buffer.byteLength(body) !== length) {
    length = String(length).length + Buffer.byteLength(body)
  }
  return `${length}${body}`
}

/** GNU 长名 entry（type `L`）：内容即下一个 entry 的真实名字。 */
export function gnuLongName(name) {
  return entry('././@LongLink', { type: 'L', data: `${name}\0` })
}

/** 拼成未压缩 tar（含两个结束零块）。 */
function archive(entries) {
  return Buffer.concat([...entries, Buffer.alloc(BLOCK * 2)])
}

/** 拼成 gzip 后的 tarball 字节。 */
export function tgz(entries) {
  return gzipSync(archive(entries))
}

/** 落盘成 .tgz 并返回路径。 */
export function writeTgz(path, entries) {
  writeFileSync(path, tgz(entries))
  return path
}
