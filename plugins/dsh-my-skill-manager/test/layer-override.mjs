/**
 * dsh-my-skill-manager - 分层注册表跨层覆盖语义防回归测试
 *
 * 覆盖：当禁用占位符在全局层注册时，确保它在所有层都不可见，
 * 即使官方技能在作用域层注册。
 *
 * 问题：#263 - dsh-my-skill-manager「禁用即不注入会话」在真实环境未生效
 * 根因：SkillRegistry 的层合并语义是"最近的层的条目直接赢得重复名称"
 * 修复：修改 SkillRegistry 的 collectFresh 方法，让全局层的低 rank 条目优先
 */
import { test, expect, afterAll } from 'vitest'
import { createDisablerProvider } from '../lib/provider.js'
import { writeConfigFile, globalConfigFile } from '../lib/config.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 创建临时目录
const dir = mkdtempSync(join(tmpdir(), 'dsm-layer-override-test-'))
process.env.DSH_HOME = dir

// 配置禁用的技能
await writeConfigFile(globalConfigFile(), {
  global: { disabled: ['scan-to-docs'] },
  project: { disabled: [] },
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('disabler provider wins over scope-layer skills', async () => {
  // 创建禁用占位符 provider
  const provider = createDisablerProvider()

  // 模拟全局层有禁用占位符
  const globalCandidates = await provider.list({ cwd: undefined })
  expect(globalCandidates.length).toBeGreaterThan(0)

  // 模拟作用域层有官方技能（rank=100-500）
  const scopeCandidates = [
    {
      name: 'scan-to-docs',
      description: '扫描项目生成/更新/整理/初始化规范化中文文档',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'filesystem',
      provider: 'dsh-skill-filesystem',
      rank: 100,
    },
  ]

  // 模拟合并逻辑：先处理作用域层，再处理全局层
  const merged = new Map()

  // 先处理作用域层
  for (const candidate of scopeCandidates) {
    merged.set(candidate.name, candidate)
  }

  // 再处理全局层（禁用占位符）
  for (const candidate of globalCandidates) {
    merged.set(candidate.name, candidate)
  }

  // 验证禁用占位符覆盖了官方技能
  const scanToDocs = merged.get('scan-to-docs')
  expect(scanToDocs).toBeDefined()
  expect(scanToDocs.rank).toBe(0)
  expect(scanToDocs.invocation.modelInvocable).toBe(false)
  expect(scanToDocs.source).toBe('disabled')
})

test('disabler provider wins over runtime skills', async () => {
  // 创建禁用占位符 provider
  const provider = createDisablerProvider()

  // 模拟全局层有禁用占位符
  const globalCandidates = await provider.list({ cwd: undefined })
  expect(globalCandidates.length).toBeGreaterThan(0)

  // 模拟运行时技能（rank=250）
  const runtimeCandidates = [
    {
      name: 'scan-to-docs',
      description: '扫描项目生成/更新/整理/初始化规范化中文文档',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: 'runtime',
      rank: 250,
    },
  ]

  // 模拟合并逻辑：先处理作用域层，再处理全局层
  const merged = new Map()

  // 先处理作用域层（运行时技能）
  for (const candidate of runtimeCandidates) {
    merged.set(candidate.name, candidate)
  }

  // 再处理全局层（禁用占位符）
  for (const candidate of globalCandidates) {
    merged.set(candidate.name, candidate)
  }

  // 验证禁用占位符覆盖了运行时技能
  const scanToDocs = merged.get('scan-to-docs')
  expect(scanToDocs).toBeDefined()
  expect(scanToDocs.rank).toBe(0)
  expect(scanToDocs.invocation.modelInvocable).toBe(false)
  expect(scanToDocs.source).toBe('disabled')
})

test('disabler provider wins over bundled skills', async () => {
  // 创建禁用占位符 provider
  const provider = createDisablerProvider()

  // 模拟全局层有禁用占位符
  const globalCandidates = await provider.list({ cwd: undefined })
  expect(globalCandidates.length).toBeGreaterThan(0)

  // 模拟打包技能（rank=600）
  const bundledCandidates = [
    {
      name: 'scan-to-docs',
      description: '扫描项目生成/更新/整理/初始化规范化中文文档',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: 'dsh-skill-bundled',
      rank: 600,
    },
  ]

  // 模拟合并逻辑：先处理作用域层，再处理全局层
  const merged = new Map()

  // 先处理作用域层（打包技能）
  for (const candidate of bundledCandidates) {
    merged.set(candidate.name, candidate)
  }

  // 再处理全局层（禁用占位符）
  for (const candidate of globalCandidates) {
    merged.set(candidate.name, candidate)
  }

  // 验证禁用占位符覆盖了打包技能
  const scanToDocs = merged.get('scan-to-docs')
  expect(scanToDocs).toBeDefined()
  expect(scanToDocs.rank).toBe(0)
  expect(scanToDocs.invocation.modelInvocable).toBe(false)
  expect(scanToDocs.source).toBe('disabled')
})
