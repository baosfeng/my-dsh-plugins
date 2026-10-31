/**
 * dsh-my-guardian — 宿主内置包清单测试（issue #481）。
 *
 * 覆盖三件事：
 *  1. desktop-runtime.json 的两种索引（sharedPackages 带版本、files 覆盖第三方包）；
 *  2. 读取失败 / 损坏 / 不存在时降级为空索引，绝不抛错（纯 Node 环境没有 asar）；
 *  3. asar 归档读取（桌面版宿主把清单放在 app.asar 内）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  buildHostInventory,
  buildInstallDirInventory,
  hostInstallRoot,
  loadHostInventory,
  packageNameFromFile,
  readHostText,
  resetHostInventoryCache,
} from '../lib/host-inventory.js'

const createdDirs = []
function freshDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-guardian-test-' }).name
  createdDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
})

function writeRuntimeJson(dir, json) {
  const path = join(dir, 'desktop-runtime.json')
  writeFileSync(path, typeof json === 'string' ? json : JSON.stringify(json), 'utf8')
  return path
}

const RUNTIME = {
  sharedPackages: [
    { name: '@deepseek-ai/cordis', version: '4.0.4', path: 'node_modules/@deepseek-ai/cordis' },
    { name: '@deepseek-ai/dsh-tools', version: '0.5.0', path: 'node_modules/@deepseek-ai/dsh-tools' },
  ],
  files: [
    { path: 'node_modules/react/package.json', bytes: 1 },
    { path: 'node_modules/@scope/pkg/lib/index.js', bytes: 1 },
    { path: 'dsh/package.json', bytes: 1 },
  ],
}

test('#481: sharedPackages 提供版本、files 覆盖第三方包', () => {
  const path = writeRuntimeJson(freshDir(), RUNTIME)
  resetHostInventoryCache()
  const inventory = loadHostInventory({ runtimeJsonPath: path })
  assert.equal(inventory.available, true)
  assert.equal(inventory.source, path)
  assert.equal(inventory.has('@deepseek-ai/cordis'), true)
  assert.equal(inventory.versionOf('@deepseek-ai/cordis'), '4.0.4', 'sharedPackages 带版本')
  assert.equal(inventory.has('react'), true, 'files 清单覆盖第三方包')
  assert.equal(inventory.versionOf('react'), null, 'files 只给「存在」，没有版本')
  assert.equal(inventory.has('@scope/pkg'), true, 'scoped 包名从 files 路径正确提取')
  assert.equal(inventory.has('@deepseek-ai/absent'), false)
})

test('#481: 清单文件不存在时降级为空索引（纯 Node 环境），不抛错', () => {
  resetHostInventoryCache()
  const inventory = loadHostInventory({ runtimeJsonPath: join(freshDir(), 'missing.json') })
  assert.equal(inventory.available, false)
  assert.equal(inventory.has('@deepseek-ai/cordis'), false)
  assert.equal(inventory.versionOf('@deepseek-ai/cordis'), null)
})

test('#481: 清单 JSON 损坏时降级为空索引，不抛错', () => {
  const path = writeRuntimeJson(freshDir(), '{"sharedPackages": [')
  resetHostInventoryCache()
  const inventory = loadHostInventory({ runtimeJsonPath: path })
  assert.equal(inventory.available, false)
})

test('#481: packageNameFromFile 取包名（嵌套 node_modules 取最后一层）', () => {
  assert.equal(packageNameFromFile('node_modules/react/package.json'), 'react')
  assert.equal(packageNameFromFile('node_modules/@scope/pkg/lib/x.js'), '@scope/pkg')
  assert.equal(packageNameFromFile('node_modules/a/node_modules/b/x.js'), 'b')
  assert.equal(packageNameFromFile('dsh/package.json'), null)
})

test('#481: buildHostInventory 对结构异常的清单按空清单处理', () => {
  const inventory = buildHostInventory({ sharedPackages: 'nope', files: [{}, null] }, 'fixture')
  assert.equal(inventory.available, true)
  assert.equal(inventory.has('anything'), false)
})

test('#481: readHostText 读普通路径，也能按字节读 asar 归档内的条目', () => {
  const dir = freshDir()
  const plain = join(dir, 'plain.json')
  writeFileSync(plain, '{"ok":true}', 'utf8')
  assert.equal(readHostText(plain), '{"ok":true}')

  // 构造最小 asar：8 字节头（header pickle 长度 + JSON 长度）+ JSON 头 + 数据段。
  const payload = Buffer.from('{"sharedPackages":[{"name":"@deepseek-ai/cordis","version":"4.0.4"}]}', 'utf8')
  const headerJson = Buffer.from(
    JSON.stringify({ files: { 'runtime.json': { size: payload.length, offset: 0 } } }),
    'utf8',
  )
  // 布局与 asar 一致：u32[4] = header pickle 大小（= 8 + JSON 长度），u32[8] = JSON 长度；
  // JSON 从 offset 16 开始，数据区从 8 + headerSize 开始。
  const headerSize = 8 + headerJson.length
  const buf = Buffer.alloc(8 + headerSize + payload.length)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(headerSize, 4)
  buf.writeUInt32LE(headerJson.length, 8)
  buf.writeUInt32LE(4, 12)
  headerJson.copy(buf, 16)
  payload.copy(buf, 8 + headerSize)
  const asarPath = join(dir, 'app.asar')
  writeFileSync(asarPath, buf)

  assert.equal(readHostText(join(asarPath, 'runtime.json')), payload.toString('utf8'))
  assert.equal(readHostText(join(asarPath, 'absent.json')), null, '归档内不存在的条目返回 null')

  resetHostInventoryCache()
  const inventory = loadHostInventory({ runtimeJsonPath: join(asarPath, 'runtime.json') })
  assert.equal(inventory.available, true)
  assert.equal(inventory.versionOf('@deepseek-ai/cordis'), '4.0.4', '能从 asar 内读清单')
})

// ── #503: npm 全局 dsh web 的宿主安装目录（无 app.asar、profiles 根无 node_modules）───
/** #503 夹具：写一套 npm 全局安装布局 <prefix>/lib/node_modules/@deepseek-ai/dsh。 */
function writeGlobalHost(prefixDir, packages) {
  const hostRoot = join(prefixDir, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(hostRoot, 'lib'), { recursive: true })
  writeFileSync(
    join(hostRoot, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }),
    'utf8',
  )
  writeFileSync(join(hostRoot, 'lib', 'bin.js'), '#!/usr/bin/env node\n', 'utf8')
  for (const [name, version] of Object.entries(packages)) {
    const dir = join(hostRoot, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
  }
  return hostRoot
}

test('#503: 从 bin 脚本（argv[1] 形态）向上找到宿主安装根', () => {
  const prefix = freshDir()
  const hostRoot = writeGlobalHost(prefix, { '@deepseek-ai/dsh-agent': '0.2.1-rc.3' })
  assert.equal(hostInstallRoot({ seeds: [join(hostRoot, 'lib', 'bin.js')] }), hostRoot)
  assert.equal(hostInstallRoot({ hostRoot }), hostRoot, 'hostRoot 直指（等价 DSH_HOST_ROOT）')
  assert.equal(hostInstallRoot({ seeds: [join(prefix, 'bin', 'dsh')] }), null, '不存在的种子不猜')
})

test('#503: bin 软链（/usr/local/bin/dsh → …/dsh/lib/bin.js）按真实路径解析', () => {
  const prefix = freshDir()
  const hostRoot = writeGlobalHost(prefix, { '@deepseek-ai/dsh-tools': '0.2.1-rc.3' })
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  const link = join(prefix, 'bin', 'dsh')
  symlinkSync(join(hostRoot, 'lib', 'bin.js'), link)
  assert.equal(hostInstallRoot({ seeds: [link] }), hostRoot)
})

test('#503: 宿主安装目录清单只认 @deepseek-ai/*，第三方包不算宿主供给', () => {
  const hostRoot = writeGlobalHost(freshDir(), { '@deepseek-ai/dsh-agent': '0.2.1-rc.3', yaml: '2.8.1' })
  const inventory = buildInstallDirInventory(hostRoot)
  assert.equal(inventory.available, true)
  assert.equal(inventory.source, join(hostRoot, 'node_modules'))
  assert.equal(inventory.has('@deepseek-ai/dsh-agent'), true)
  assert.equal(inventory.versionOf('@deepseek-ai/dsh-agent'), '0.2.1-rc.3')
  assert.equal(inventory.has('yaml'), false, '宿主树里的第三方包算成宿主供给，会把「插件真缺 yaml」掩盖成漏报')
  assert.equal(inventory.versionOf('yaml'), null)
  assert.equal(inventory.has('@deepseek-ai/dsh-nope'), false)
})

test('#503: asar 清单落空时兜底到宿主安装目录（纯 npm 全局 dsh web）', () => {
  const hostRoot = writeGlobalHost(freshDir(), { '@deepseek-ai/dsh-tools': '0.2.1-rc.3' })
  const savedResources = process.env.DSH_APP_RESOURCES
  delete process.env.DSH_APP_RESOURCES
  try {
    resetHostInventoryCache()
    const inventory = loadHostInventory({ hostRoot })
    assert.equal(inventory.available, true)
    assert.equal(inventory.versionOf('@deepseek-ai/dsh-tools'), '0.2.1-rc.3')
  } finally {
    if (savedResources !== undefined) process.env.DSH_APP_RESOURCES = savedResources
    resetHostInventoryCache()
  }
})

test('#503: 显式传 runtimeJsonPath 时不兜底宿主安装目录（指定文件不存在就是不存在）', () => {
  const hostRoot = writeGlobalHost(freshDir(), { '@deepseek-ai/dsh-tools': '0.2.1-rc.3' })
  resetHostInventoryCache()
  const inventory = loadHostInventory({ runtimeJsonPath: join(freshDir(), 'missing.json'), hostRoot })
  assert.equal(inventory.available, false)
  assert.equal(inventory.has('@deepseek-ai/dsh-tools'), false)
})
