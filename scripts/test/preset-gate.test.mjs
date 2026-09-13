/**
 * preset-gate.test.mjs — agent preset 资产包形态判定单元测试（issue #231）。
 *
 * 覆盖：豁免判据（dsh.kind=preset + 非空 presetReason）、与 profile 插件形态的互斥
 * （dsh.bundle / dsh.client）、资产不变量（agent.cordis.yml + preset.yml 必须真实存在且
 * 内容成形）、反向不变量（有 preset 资产必须显式声明）；外加**仓库不变量**断言，
 * 防「豁免判据腐烂」：
 *   - 每个插件目录的判定只能是 declared / none——任何非法声明或形态矛盾都会让本套件红灯；
 *   - 声明 dsh.kind=preset 的目录必须真的有 preset 资产（不许用声明骗取豁免）；
 *   - 有 cordis.patch.yml 的 profile 插件不得声明 preset；
 *   - dsh-shared 仍走 dsh.kind=library，不被 preset 判据吞掉；
 *   - dsh-plugin-dev-mode 按显式声明豁免，而不是写死的插件名单。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePresetAsset, PRESET_COMPOSITION_FILE, PRESET_METADATA_FILE } from '../lib/preset-gate.mjs'

/** 组合文件最小成形样本（与 plugins/dsh-plugin-dev-mode/agent.cordis.yml 同形）。 */
const COMPOSITION = ['- id: persona', "  name: '@deepseek-ai/dsh-persona'", ''].join('\n')
/** 显示元数据最小成形样本（与 plugins/dsh-plugin-dev-mode/preset.yml 同形）。 */
const METADATA = ['name: 插件开发模式', 'description: 插件开发专用', ''].join('\n')
const REASON = '插件开发模式（plugin-dev）'

/** 用内存文件表构造 readAsset（缺失返回 null，与 release.mjs 的注入一致）。 */
const reader = (files) => (file) => files[file] ?? null
/** 资产齐全的 readAsset。 */
const withAssets = reader({ [PRESET_COMPOSITION_FILE]: COMPOSITION, [PRESET_METADATA_FILE]: METADATA })

describe('resolvePresetAsset（形态判定与豁免判据）', () => {
  it('未声明 dsh.kind 且无 preset 资产 → none（走常规插件门禁）', () => {
    expect(resolvePresetAsset({ pkg: { dsh: {} }, readAsset: reader({}) })).toEqual({
      status: 'none',
      reason: '',
      problem: null,
    })
  })

  it('dsh.kind=library 且无 preset 资产 → none（共享工具包走自己的豁免）', () => {
    const r = resolvePresetAsset({ pkg: { dsh: { kind: 'library' } }, readAsset: reader({}) })
    expect(r.status).toBe('none')
  })

  it('pkg 无 dsh 字段 / pkg 缺失 → none（不误判）', () => {
    expect(resolvePresetAsset({ pkg: {}, readAsset: reader({}) }).status).toBe('none')
    expect(resolvePresetAsset({ pkg: undefined, readAsset: reader({}) }).status).toBe('none')
  })

  it('合法声明：dsh.kind=preset + presetReason + 两项资产 → declared，理由含预设理由', () => {
    const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset', presetReason: REASON } }, readAsset: withAssets })
    expect(r.status).toBe('declared')
    expect(r.problem).toBeNull()
    expect(r.reason).toContain(REASON)
    expect(r.reason).toContain('dsh.kind=preset')
  })

  it('dsh.kind=preset 缺 presetReason → problem（必填理由，防随手豁免）', () => {
    const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset' } }, readAsset: withAssets })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('presetReason')
  })

  it('dsh.presetReason 为空白字符串 / 非字符串 → problem', () => {
    for (const presetReason of ['', '   ', 42, null]) {
      const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset', presetReason } }, readAsset: withAssets })
      expect(r.status).toBe('problem')
    }
  })

  it('dsh.kind=preset 与 dsh.bundle 互斥 → problem（自相矛盾即拒绝）', () => {
    const pkg = { dsh: { kind: 'preset', presetReason: REASON, bundle: { patch: './cordis.patch.yml' } } }
    const r = resolvePresetAsset({ pkg, readAsset: withAssets })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('dsh.bundle')
  })

  it('dsh.kind=preset 与 dsh.client 互斥 → problem（自相矛盾即拒绝）', () => {
    const pkg = { dsh: { kind: 'preset', presetReason: REASON, client: { platform: 'web' } } }
    const r = resolvePresetAsset({ pkg, readAsset: withAssets })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('dsh.client')
  })

  it('声明 preset 但缺 agent.cordis.yml → problem（无资产不得豁免）', () => {
    const readAsset = reader({ [PRESET_METADATA_FILE]: METADATA })
    const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset', presetReason: REASON } }, readAsset })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain(PRESET_COMPOSITION_FILE)
  })

  it('声明 preset 但缺 preset.yml → problem（无资产不得豁免）', () => {
    const readAsset = reader({ [PRESET_COMPOSITION_FILE]: COMPOSITION })
    const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset', presetReason: REASON } }, readAsset })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain(PRESET_METADATA_FILE)
  })

  it('agent.cordis.yml 无插件行（空/注释）→ problem（内容不成形不得豁免）', () => {
    for (const composition of ['', '# 只有注释\n', '- id: persona\n']) {
      const readAsset = reader({ [PRESET_COMPOSITION_FILE]: composition, [PRESET_METADATA_FILE]: METADATA })
      const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset', presetReason: REASON } }, readAsset })
      expect(r.status).toBe('problem')
      expect(r.problem).toContain(PRESET_COMPOSITION_FILE)
    }
  })

  it('preset.yml 无非空 name → problem（选择器显示名缺失不得豁免）', () => {
    for (const metadata of ['', 'description: 只有描述\n', 'name:\n']) {
      const readAsset = reader({ [PRESET_COMPOSITION_FILE]: COMPOSITION, [PRESET_METADATA_FILE]: metadata })
      const r = resolvePresetAsset({ pkg: { dsh: { kind: 'preset', presetReason: REASON } }, readAsset })
      expect(r.status).toBe('problem')
      expect(r.problem).toContain(PRESET_METADATA_FILE)
    }
  })

  it('有 preset 资产但未声明 dsh.kind → problem，提示正确修复方式（不误报缺 cordis peer）', () => {
    const r = resolvePresetAsset({ pkg: { dsh: {} }, readAsset: withAssets })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('未声明 dsh.kind')
    expect(r.problem).toContain('dsh.kind="preset"')
    expect(r.problem).toContain('#231')
  })

  it('有 preset 资产但 dsh.kind=library（或拼写错误）→ problem（形态矛盾）', () => {
    for (const kind of ['library', 'presett']) {
      const r = resolvePresetAsset({ pkg: { dsh: { kind } }, readAsset: withAssets })
      expect(r.status).toBe('problem')
      expect(r.problem).toContain('agent preset 资产')
    }
  })

  it('只有单项资产（半成品）也算试图声明，必须显式声明 kind', () => {
    for (const files of [{ [PRESET_COMPOSITION_FILE]: COMPOSITION }, { [PRESET_METADATA_FILE]: METADATA }]) {
      expect(resolvePresetAsset({ pkg: { dsh: {} }, readAsset: reader(files) }).status).toBe('problem')
    }
  })
})

// ── 仓库不变量（真实文件系统） ─────────────────────────────────────────────
describe('仓库不变量（防豁免判据腐烂）', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const pluginsRoot = join(root, 'plugins')
  const dirs = readdirSync(pluginsRoot).filter((e) => existsSync(join(pluginsRoot, e, 'package.json')))
  const readAssetFrom = (dir) => (file) => {
    const p = join(dir, file)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  const inspect = (dir) =>
    resolvePresetAsset({
      pkg: JSON.parse(readFileSync(join(pluginsRoot, dir, 'package.json'), 'utf8')),
      readAsset: readAssetFrom(join(pluginsRoot, dir)),
    })

  it('dsh-plugin-dev-mode 按显式声明豁免（不是插件名单），且资产真实存在', () => {
    const r = inspect('dsh-plugin-dev-mode')
    expect(r.status).toBe('declared')
    expect(r.problem).toBeNull()
    expect(existsSync(join(pluginsRoot, 'dsh-plugin-dev-mode', PRESET_COMPOSITION_FILE))).toBe(true)
    expect(existsSync(join(pluginsRoot, 'dsh-plugin-dev-mode', PRESET_METADATA_FILE))).toBe(true)
  })

  it('每个插件目录的判定只能是 declared / none——非法声明或形态矛盾即红', () => {
    const problems = dirs.map((d) => [d, inspect(d)]).filter(([, r]) => r.status === 'problem')
    expect(problems.map(([d, r]) => `${d}: ${r.problem}`)).toEqual([])
  })

  it('声明 dsh.kind=preset 的目录必须真的有 preset 资产（无资产不得豁免）', () => {
    for (const dir of dirs) {
      const pkg = JSON.parse(readFileSync(join(pluginsRoot, dir, 'package.json'), 'utf8'))
      if (pkg.dsh?.kind !== 'preset') continue
      expect(existsSync(join(pluginsRoot, dir, PRESET_COMPOSITION_FILE))).toBe(true)
      expect(existsSync(join(pluginsRoot, dir, PRESET_METADATA_FILE))).toBe(true)
    }
  })

  it('profile 插件（有 cordis.patch.yml）不得声明 dsh.kind=preset', () => {
    for (const dir of dirs) {
      const pkg = JSON.parse(readFileSync(join(pluginsRoot, dir, 'package.json'), 'utf8'))
      if (!existsSync(join(pluginsRoot, dir, 'cordis.patch.yml'))) continue
      expect(pkg.dsh?.kind).not.toBe('preset')
    }
  })

  it('dsh-shared 仍走 dsh.kind=library（不被 preset 判据吞掉）', () => {
    expect(inspect('dsh-shared').status).toBe('none')
    const pkg = JSON.parse(readFileSync(join(pluginsRoot, 'dsh-shared', 'package.json'), 'utf8'))
    expect(pkg.dsh?.kind).toBe('library')
  })
})
