import { test, beforeAll, afterAll } from 'vitest'
/**
 * dsh-my-remote — 真实 DSH 配置的写入防护（防复发，issue #385 事故后续）。
 *
 * ## 事故
 *
 * `~/.dsh/profiles/web/cordis.patch.yml`（用户**真实生产配置**）曾被本插件的测试
 * 整文件覆盖成测试夹具。根因两条：
 *  1. `writePatchFile` 无路径防护 —— `patchFileOf` 在 `DSH_HOME` 为空时回退 `~/.dsh`，
 *     `writeFileSync` 直接整文件覆盖真实配置；
 *  2. DSH_HOME 隔离只在 `boot()` 内部设置 —— 任何 boot 之外的写入都落在真实路径。
 *
 * ## 本文件钉住
 *
 *  - **DSH_HOME 未设置**时，`writeIsolatedPatchFile` / `assertDshHomeIsolated` 抛错；
 *    「用真实 DSH_HOME 写 patch」的老写法必须被拦下；
 *  - **DSH_HOME 指向真实 ~/.dsh** 时同样抛错；
 *  - 目标路径位于临时目录之外时抛错（fail-closed，不只靠 DSH_HOME 一个信号）；
 *  - 以上每一条都断言**真实配置文件的内容 sha256 + size + mtime 均未变化**（只读快照）；
 *  - 隔离正常时写入照常成功（防护不能把正常功能一起挡掉）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentProfile, patchFileOf } from 'dsh-shared'
import {
  assertDshHomeIsolated,
  assertIsolatedPatchPath,
  defaultRealConfigPath,
  realDshRoot,
  snapshotRealConfig,
  writeIsolatedPatchFile,
} from './helpers/isolated-home.mjs'

const REAL_CONFIG = defaultRealConfigPath()

/** 用例期间真实配置的快照（before/after 各取一次做比对）。 */
let before = null

beforeAll(() => {
  before = snapshotRealConfig(REAL_CONFIG)
})

afterAll(() => {
  assert.deepEqual(
    snapshotRealConfig(REAL_CONFIG),
    before,
    '整套防护测试**不得**触碰真实配置（内容 / size / mtime 必须完全不变）',
  )
})

/** 断言真实配置此刻仍与用例开始时逐字节一致。 */
function assertRealConfigUntouched(label) {
  assert.deepEqual(snapshotRealConfig(REAL_CONFIG), before, `${label}：真实配置必须零变化`)
}

test('DSH_HOME 未设置时拒绝写入：抛错，且真实配置零变化（事故主场景）', () => {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    // 事故路径：patchFileOf 在 DSH_HOME 为空时回退到真实 ~/.dsh（事故根因）
    assert.equal(
      patchFileOf(currentProfile()),
      REAL_CONFIG,
      '前提：DSH_HOME 未设置时 patchFileOf 确实回退到真实配置路径（事故根因）',
    )
    // 注意：**不**真的尝试写真实路径（硬边界：除只读快照外不碰 ~/.dsh）。
    // 只验证防护入口在落盘之前就抛错 —— 这正是事故缺失的那一道。
    assert.throws(
      () => writeIsolatedPatchFile(REAL_CONFIG, 'POLLUTED BY TEST'),
      /测试保护|DSH_HOME 未设置/,
      '写入真实配置必须被 fail-closed 拦下',
    )
    assert.throws(() => assertDshHomeIsolated(), /DSH_HOME 未设置/, 'DSH_HOME 断言必须报错')
    assert.throws(() => assertIsolatedPatchPath(REAL_CONFIG), /拒绝写入真实 DSH 配置/, '路径断言必须独立拦下真实路径')
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
    else delete process.env.DSH_HOME
  }
  assertRealConfigUntouched('DSH_HOME 未设置场景')
})

test('DSH_HOME 指向真实 ~/.dsh 时拒绝写入', () => {
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = realDshRoot()
  try {
    assert.throws(() => assertDshHomeIsolated(), /指向真实配置目录/, 'DSH_HOME 指向真实目录必须报错')
    assert.throws(
      () => writeIsolatedPatchFile(patchFileOf(currentProfile()), 'POLLUTED BY TEST'),
      /测试保护/,
      '即便 DSH_HOME 被显式设为真实目录，也必须拦下',
    )
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
    else delete process.env.DSH_HOME
  }
  assertRealConfigUntouched('DSH_HOME 指向真实目录场景')
})

test('目标路径在临时目录之外时拒绝写入（不只看 DSH_HOME 一个信号）', () => {
  assert.throws(
    () => assertIsolatedPatchPath(join(realDshRoot(), 'profiles', 'web', 'cordis.patch.yml')),
    /拒绝写入真实 DSH 配置/,
    '真实路径必须被拒',
  )
  assert.throws(
    () => assertIsolatedPatchPath(join(process.cwd(), 'cordis.patch.yml')),
    /拒绝写入临时目录之外/,
    '仓库内路径也必须被拒（避免污染工作区）',
  )
  assertRealConfigUntouched('越界路径场景')
})

test('隔离正常时写入照常成功（防护不得挡住正常功能）', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-remote-guard-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const target = patchFileOf(currentProfile())
    const written = writeIsolatedPatchFile(target, ['- id: remote', '  config:', '    end: false', ''].join('\n'))
    assert.ok(written.startsWith(realpathSync(home)), '写入落在隔离目录内（realpath 归一化后比较）')
    assert.equal(readFileSync(target, 'utf8').includes('end: false'), true, '内容已写入隔离文件')
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
    else delete process.env.DSH_HOME
  }
  assertRealConfigUntouched('隔离正常写入场景')
})

test('Gherkin world 的 writePatchFile 走同一防护入口（静态断言，不实例化 cucumber World）', () => {
  // world.mjs 会注册 cucumber hooks（import 即有副作用），故这里只做源码级断言：
  // 它的 writePatchFile 必须调用 writeIsolatedPatchFile，不得自己 writeFileSync。
  const source = readFileSync(new URL('./features/steps/world.mjs', import.meta.url), 'utf8')
  assert.ok(
    source.includes('writeIsolatedPatchFile(patchFileOf(currentProfile()), text)'),
    'world.writePatchFile 必须经 writeIsolatedPatchFile（fail-closed 断言）',
  )
  assert.ok(
    !/writeFileSync\(\s*patchFileOf/.test(source),
    'world.mjs 不得再出现「直接 writeFileSync(patchFileOf(...))」的裸写入',
  )
  assert.ok(source.includes('Before(function ()'), '必须有 Before hook 提前隔离 DSH_HOME')
  assertRealConfigUntouched('world 源码断言场景')
})
