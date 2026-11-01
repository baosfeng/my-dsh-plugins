/**
 * dsh-my-guardian — #508：两套宿主形态对「宿主供给」的结论必须一致。
 *
 * 桌面 App 形态读 app.asar 内的 desktop-runtime.json（`DSH_APP_RESOURCES` →
 * `<resources>/app.asar/dsh/desktop-runtime.json`），npm 全局形态读
 * `<prefix>/lib/node_modules/@deepseek-ai/dsh/node_modules`。此前只有后者按
 * `@deepseek-ai/*` 过滤，前者按 `files` 里的文件名判定 → 桌面形态下插件真缺 yaml
 * 被判成「由宿主供给、无需安装」→ 依赖缺失静默漏报。
 *
 * 本文件把**同一组断言在两种形态下各跑一遍**再逐字段比较两份结论：任一侧口径再分叉，
 * 断言立即红。夹具是「最小伪造资源目录」——asar 用真实归档格式（含 dsh/desktop-runtime.json），
 * npm 全局形态用最小 node_modules 布局。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { loadHostInventory, resetHostInventoryCache } from '../lib/host-inventory.js'
import { buildDependencyMessage, checkPeerDependencies, dependencyFailureType } from '../lib/dep-precheck.js'

const createdDirs = []
function freshDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-guardian-508-' }).name
  createdDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
})

/** 宿主版本在两种形态里写成同一个值，才能逐字段比较 versionOf。 */
const HOST_TOOLS_VERSION = '0.2.1-rc.3'

/** 最小 desktop-runtime.json：files 里同时放一个 @deepseek-ai/* 和一个第三方包（yaml）。 */
const DESKTOP_RUNTIME = {
  sharedPackages: [
    { name: '@deepseek-ai/dsh-tools', version: HOST_TOOLS_VERSION, path: 'node_modules/@deepseek-ai/dsh-tools' },
  ],
  files: [
    { path: 'node_modules/@deepseek-ai/dsh-llm/package.json', bytes: 1 },
    { path: 'node_modules/yaml/dist/index.js', bytes: 1 },
  ],
}

/** 按 asar 真实布局写一个归档（8 字节头 + JSON 头 + 数据段，条目可嵌套）。 */
function writeMinimalAsar(asarPath, entries) {
  const header = { files: {} }
  const payloads = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.from(entry.content, 'utf8')
    const parts = entry.inner.split('/').filter((part) => part !== '')
    let node = header
    for (const part of parts.slice(0, -1)) {
      node.files[part] = node.files[part] ?? { files: {} }
      node = node.files[part]
    }
    node.files[parts[parts.length - 1]] = { size: data.length, offset }
    payloads.push(data)
    offset += data.length
  }
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8')
  const headerSize = 8 + headerJson.length
  const buf = Buffer.alloc(8 + headerSize + offset)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(headerSize, 4)
  buf.writeUInt32LE(headerJson.length, 8)
  buf.writeUInt32LE(4, 12)
  headerJson.copy(buf, 16)
  let cursor = 8 + headerSize
  for (const data of payloads) {
    data.copy(buf, cursor)
    cursor += data.length
  }
  writeFileSync(asarPath, buf)
}

/** 桌面形态夹具：<resources>/app.asar/dsh/desktop-runtime.json（走 DSH_APP_RESOURCES 探测）。 */
function writeDesktopResources(runtime = DESKTOP_RUNTIME) {
  const resourcesDir = freshDir()
  writeMinimalAsar(join(resourcesDir, 'app.asar'), [
    { inner: 'dsh/desktop-runtime.json', content: JSON.stringify(runtime) },
  ])
  return resourcesDir
}

/** npm 全局形态夹具：<prefix>/lib/node_modules/@deepseek-ai/dsh 的宿主树（yaml 真躺在树里）。 */
function writeGlobalHost(packages) {
  const hostRoot = join(freshDir(), 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(hostRoot, { recursive: true })
  writeFileSync(
    join(hostRoot, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: HOST_TOOLS_VERSION }),
    'utf8',
  )
  for (const [name, version] of Object.entries(packages)) {
    const dir = join(hostRoot, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
  }
  return hostRoot
}

/**
 * 两种形态各建一份清单：桌面形态靠 DSH_APP_RESOURCES 探测，npm 形态靠 hostRoot。
 * 环境变量与缓存都在这里配对保存 / 清理，用例之间不互相污染。
 */
function buildBothForms() {
  const savedResources = process.env.DSH_APP_RESOURCES
  const resourcesDir = writeDesktopResources()
  process.env.DSH_APP_RESOURCES = resourcesDir
  resetHostInventoryCache()
  const desktop = loadHostInventory()
  try {
    delete process.env.DSH_APP_RESOURCES
    resetHostInventoryCache()
    const hostRoot = writeGlobalHost({
      '@deepseek-ai/dsh-llm': HOST_TOOLS_VERSION,
      '@deepseek-ai/dsh-tools': HOST_TOOLS_VERSION,
      yaml: '2.8.1',
    })
    const npmGlobal = loadHostInventory({ hostRoot })
    return { desktop, npmGlobal, hostRoot, resourcesDir }
  } finally {
    if (savedResources !== undefined) process.env.DSH_APP_RESOURCES = savedResources
    resetHostInventoryCache()
  }
}

/** 清单层结论：只有这五个字段参与「两种形态是否一致」的比较。 */
function inventoryView(inventory) {
  return {
    yaml: inventory.has('yaml'),
    ws: inventory.has('ws'),
    zod: inventory.has('zod'),
    llm: inventory.has('@deepseek-ai/dsh-llm'),
    tools: inventory.has('@deepseek-ai/dsh-tools'),
    toolsVersion: inventory.versionOf('@deepseek-ai/dsh-tools'),
    yamlVersion: inventory.versionOf('yaml'),
  }
}

test('#508: 两种宿主形态的清单层结论一致（第三方包不算宿主供给）', () => {
  const { desktop, npmGlobal, hostRoot, resourcesDir } = buildBothForms()
  assert.equal(desktop.available, true)
  assert.equal(
    desktop.source,
    join(resourcesDir, 'app.asar', 'dsh', 'desktop-runtime.json'),
    '桌面形态真的走了 app.asar 内的清单（不是兜底到安装目录）',
  )
  assert.equal(npmGlobal.source, join(hostRoot, 'node_modules'), 'npm 全局形态走安装目录清单')

  const desktopView = inventoryView(desktop)
  const npmView = inventoryView(npmGlobal)
  assert.equal(desktopView.yaml, false, '桌面 asar 的 files 里有 yaml，但它不是宿主供给')
  assert.equal(npmView.yaml, false, 'npm 全局树里躺着 yaml，但它不是宿主供给')
  assert.equal(desktopView.llm, true, 'asar 的 files 里的 @deepseek-ai/* 仍是宿主供给')
  assert.equal(npmView.llm, true)
  assert.equal(desktopView.llm, npmView.llm, '对 @deepseek-ai/* 的结论必须一致')
  assert.equal(desktopView.yaml, npmView.yaml, '对 yaml 的结论必须一致')
  assert.deepEqual(desktopView, npmView, '两种形态的清单结论逐字段一致')

  // 集合本身也只装宿主命名空间的包：将来若有消费者直接读 files / shared，同样不会读错。
  for (const [label, inventory] of [
    ['桌面 asar', desktop],
    ['npm 全局', npmGlobal],
  ]) {
    assert.deepEqual(
      [...inventory.files].filter((name) => !name.startsWith('@deepseek-ai/')),
      [],
      `${label}：files 集合里不得残留第三方包名`,
    )
    assert.deepEqual(
      [...inventory.shared.keys()].filter((name) => !name.startsWith('@deepseek-ai/')),
      [],
      `${label}：shared 集合里不得残留第三方包名`,
    )
  }
})

test('#508: 插件真缺 yaml 时两种形态都判 dependency-missing 并给安装建议', () => {
  const { desktop, npmGlobal } = buildBothForms()
  const profileDir = freshDir()
  writePlugin(profileDir, 'dsh-needy-508', {
    peerDependencies: { yaml: '^2.8.1', '@deepseek-ai/dsh-tools': '^0.2.1-rc.3' },
  })
  const results = [
    ['桌面 asar', checkPeerDependencies({ profileDir, pluginName: 'dsh-needy-508', hostInventory: desktop })],
    ['npm 全局', checkPeerDependencies({ profileDir, pluginName: 'dsh-needy-508', hostInventory: npmGlobal })],
  ]
  for (const [label, result] of results) {
    assert.deepEqual(result.missing, ['yaml'], `${label}：yaml 不在宿主供给里 → 判缺失`)
    assert.deepEqual(result.missingHostNamespace, [], `${label}：yaml 不是宿主命名空间，文案走「请先安装」`)
    assert.deepEqual(result.mismatched, [], `${label}：宿主供给的 @deepseek-ai/dsh-tools 版本满足`)
    assert.deepEqual(result.warnings, [], `${label}：没有 warning`)
    assert.deepEqual(result.suggestions, ['dsh plugin add yaml'], `${label}：第三方包给可执行安装建议`)
    assert.equal(dependencyFailureType(result), 'dependency-missing', `${label}：分类为依赖缺失`)
    const message = buildDependencyMessage(result)
    assert.ok(message.includes('缺少依赖 yaml（请先安装）'), `${label}：${message}`)
  }
  assert.deepEqual(results[0][1], results[1][1], '两种形态的预检结论逐字段一致')
})

/** fixture：<profileDir>/node_modules/<name>/package.json。 */
function writePlugin(dir, name, json) {
  mkdirSync(join(dir, 'node_modules', name), { recursive: true })
  writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, ...json }), 'utf8')
}
