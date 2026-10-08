/**
 * 宿主来源解析防回归（纯桌面 App 环境）。
 *
 * 为什么需要它：用户改用桌面 App 后本机**没有 npm 全局宿主**，宿主依赖树被归档进
 * app.asar（普通文件）。取证脚本若只认 npm prefix，--update 直接不可用；而把 asar
 * 路径塞进「可 import 的宿主」又会炸 Node 的 ESM loader（ENOTDIR）——两条路径必须
 * 分开，本套件同时钉住这两件事：
 *   ① installedHostScanDir() 能解析 asar 内的宿主树（version/事件/marker 逐字取证）
 *   ② installedHostDir() **绝不**返回 asar 路径（消费方含 import 真宿主 loader 的测试）
 *   ③ 已装宿主缺失时 --update 降级：保留上一次 installed 段，绝不伪造
 *
 * 本机没有桌面 App 时同样有效：测试自造一个最小 asar 文件，不依赖 /Applications。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  extractFromInstalledHost,
  findMarkerInInstalledHost,
  installedHostDir,
  installedHostScanDir,
  updateFixture,
  versionOf,
} from '../scripts/host-events.mjs'

/** 造一个最小可读的 asar 归档（只含本用例需要的条目）。 */
function writeAsar(file, entries) {
  const files = {}
  const chunks = []
  let offset = 0
  for (const [path, content] of entries) {
    const buf = Buffer.from(content, 'utf8')
    const parts = path.split('/')
    let node = files
    for (const part of parts.slice(0, -1)) {
      node[part] = node[part] ?? { files: {} }
      node = node[part].files
    }
    node[parts[parts.length - 1]] = { size: buf.length, offset: String(offset) }
    chunks.push(buf)
    offset += buf.length
  }
  const json = Buffer.from(JSON.stringify({ files }), 'utf8')
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4)
  json.copy(padded)
  const headerSize = 8 + padded.length
  const head = Buffer.alloc(16 + padded.length)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(headerSize, 4)
  head.writeUInt32LE(json.length, 8)
  padded.copy(head, 16)
  writeFileSync(file, Buffer.concat([head, ...chunks]))
}

function withEnv(vars, fn) {
  const saved = new Map()
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('桌面 App 形态：installedHostScanDir 解析 asar 内宿主，installedHostDir 拒绝 asar 路径', () => {
  const root = mkdtempSync(join(tmpdir(), 'guardian-asar-'))
  try {
    const asar = join(root, 'app.asar')
    writeAsar(asar, [
      ['dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime', version: '9.9.9-probe' })],
      [
        'dsh/node_modules/@deepseek-ai/dsh/package.json',
        JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9-probe' }),
      ],
      ['dsh/node_modules/@deepseek-ai/dsh-base/lib/index.js', "export const x = 1\nctx.emit('probe/from-asar', 1)\n"],
    ])
    withEnv({ DSH_APP_RESOURCES: root, DSH_INSTALLED_HOST: undefined }, () => {
      const scan = installedHostScanDir()
      assert.equal(scan, join(root, 'app.asar', 'dsh'), 'asar 宿主必须能被 scan 版解析')
      // 关键防回归：可 import 的宿主解析器绝不能给出 asar 路径（否则真 loader 测试 ENOTDIR）
      if (installedHostDir() !== null) {
        assert.ok(!installedHostDir().includes('.asar'), 'installedHostDir 不得返回 asar 内路径')
      }
      assert.equal(installedHostDir(), null, '本机无 npm 全局宿主时 installedHostDir 必须为 null')
      assert.equal(versionOf(scan), '9.9.9-probe', 'asar 内 package.json 必须能按字节读出')
      assert.deepEqual(extractFromInstalledHost(scan), ['probe/from-asar'], 'asar 内 lib 的派发通道必须能取证')
      assert.deepEqual(findMarkerInInstalledHost(scan, 'probe/from-asar'), ['@deepseek-ai/dsh-base/lib/index.js'])
      assert.deepEqual(findMarkerInInstalledHost(scan, 'no-such-marker'), [])
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('已装宿主缺失：--update 降级保留 installed 段，且拒绝凭空生成', () => {
  const root = mkdtempSync(join(tmpdir(), 'guardian-degrade-'))
  try {
    const reference = join(root, 'reference')
    mkdirSync(join(reference, 'packages'), { recursive: true })
    mkdirSync(join(reference, 'vendor'), { recursive: true })
    writeFileSync(join(reference, 'package.json'), JSON.stringify({ name: 'ref', version: '0.0.0-ref' }))
    writeFileSync(
      join(reference, 'packages', 'probe.ts'),
      "declare module '@deepseek-ai/cordis' {\n  interface Events {\n    'probe/kept'(a: string): void\n  }\n}\n",
    )
    const empty = join(root, 'no-app-here')
    mkdirSync(empty, { recursive: true })
    const fixturePath = join(root, 'fixture.json')
    const previous = {
      installed: { version: '0.1.7-rc.2', source: '旧取证', events: ['probe/kept'] },
    }
    withEnv({ DSH_HARNESS_REF: reference, DSH_APP_RESOURCES: empty, DSH_INSTALLED_HOST: undefined }, () => {
      if (installedHostDir() !== null) {
        console.log('skip: 本机存在 npm 全局宿主，降级分支不适用')
        return
      }
      const fixture = updateFixture({ previous, fixturePath, fallbackEvidence: {} })
      assert.equal(fixture.installed.version, '0.1.7-rc.2', 'installed 段必须原样保留，不得被清空/伪造')
      assert.deepEqual(fixture.installed.events, ['probe/kept'])
      assert.equal(fixture.reference.version, '0.0.0-ref', 'reference 段必须刷新')
      const written = JSON.parse(readFileSync(fixturePath, 'utf8'))
      assert.equal(written.installed.version, '0.1.7-rc.2')
      // 没有可保留的 installed 段时必须硬失败（不许凭空生成"已装宿主清单"）
      assert.throws(
        () => updateFixture({ previous: null, fixturePath: join(root, 'never.json'), fallbackEvidence: {} }),
        /没有可用的已安装宿主/,
      )
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
