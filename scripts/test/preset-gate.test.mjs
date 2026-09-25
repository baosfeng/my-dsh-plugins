/**
 * preset-gate.test.mjs — agent preset 声明包形态判定单元测试（issue #231；0.1.7 形态迁移）。
 *
 * 覆盖：豁免判据（dsh.kind=preset + 非空 presetReason）、载体不变量（必须声明
 * dsh.bundle.patch 且 patch 里真的有 @deepseek-ai/dsh-agent-preset 声明行）、与 client
 * 形态的互斥、反向不变量（patch 里有声明行必须显式声明 kind）；外加**仓库不变量**断言，
 * 防「豁免判据腐烂」：
 *   - 每个插件目录的判定只能是 declared / none——任何非法声明或形态矛盾都会让本套件红灯；
 *   - 声明 dsh.kind=preset 的目录必须真的有 patch 载体与声明行（不许用声明骗取豁免）；
 *   - 普通 profile 插件（有 cordis.patch.yml、无声明行）不得被判成 preset；
 *   - 已移除的目录资产（preset.yml / agent.cordis.yml）不得回归；
 *   - dsh-shared 仍走 dsh.kind=library，不被 preset 判据吞掉；
 *   - dsh-plugin-dev-mode 按显式声明豁免，而不是写死的插件名单。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePresetAsset, PRESET_PATCH_FILE, PRESET_DECLARATION_PLUGIN } from '../lib/preset-gate.mjs'

/** 声明最小成形样本（与 plugins/dsh-plugin-dev-mode/cordis.patch.yml 同形）。 */
const DECLARATION = [
  '- insert:',
  '    - id: preset-review',
  `      name: '${PRESET_DECLARATION_PLUGIN}'`,
  '      config:',
  '        id: review',
  '        name: Review',
  '        plugins:',
  '          - id: persona',
  "            name: '@deepseek-ai/dsh-persona'",
  '',
].join('\n')
/** 普通 profile bundle 的 patch（无 preset 声明行）。 */
const PLAIN_BUNDLE_PATCH = ['- insert:', '    - id: ui-theme', "      name: 'dsh-my-theme'", ''].join('\n')
const REASON = '插件开发模式（plugin-dev）'

/** 用内存文件表构造 readAsset（缺失返回 null，与 release.mjs 的注入一致）。 */
const reader = (files) => (file) => files[file] ?? null
/** 声明齐全的 pkg（含 patch 载体）。 */
const declaringPkg = (extra = {}) => ({
  dsh: { kind: 'preset', presetReason: REASON, bundle: { patch: `./${PRESET_PATCH_FILE}` }, ...extra },
})
/** 载体与声明行齐全的 readAsset。 */
const withDeclaration = reader({ [`./${PRESET_PATCH_FILE}`]: DECLARATION, [PRESET_PATCH_FILE]: DECLARATION })

describe('resolvePresetAsset（形态判定与豁免判据）', () => {
  it('未声明 dsh.kind 且无声明行 → none（走常规插件门禁）', () => {
    expect(resolvePresetAsset({ pkg: { dsh: {} }, readAsset: reader({}) })).toEqual({
      status: 'none',
      reason: '',
      problem: null,
    })
  })

  it('dsh.kind=library 且无声明行 → none（共享工具包走自己的豁免）', () => {
    expect(resolvePresetAsset({ pkg: { dsh: { kind: 'library' } }, readAsset: reader({}) }).status).toBe('none')
  })

  it('pkg 无 dsh 字段 / pkg 缺失 → none（不误判）', () => {
    expect(resolvePresetAsset({ pkg: {}, readAsset: reader({}) }).status).toBe('none')
    expect(resolvePresetAsset({ pkg: undefined, readAsset: reader({}) }).status).toBe('none')
  })

  it('普通 profile bundle（有 patch、无声明行）→ none（不被 preset 判据吞掉）', () => {
    const pkg = { dsh: { bundle: { patch: `./${PRESET_PATCH_FILE}` } } }
    expect(
      resolvePresetAsset({ pkg, readAsset: reader({ [`./${PRESET_PATCH_FILE}`]: PLAIN_BUNDLE_PATCH }) }).status,
    ).toBe('none')
  })

  it('合法声明：dsh.kind=preset + presetReason + patch 载体与声明行 → declared，理由含预设理由', () => {
    const r = resolvePresetAsset({ pkg: declaringPkg(), readAsset: withDeclaration })
    expect(r.status).toBe('declared')
    expect(r.problem).toBeNull()
    expect(r.reason).toContain(REASON)
    expect(r.reason).toContain('dsh.kind=preset')
  })

  it('dsh.bundle.patch 为列表（官方 bundle 形态）且声明行在第二个文件 → declared', () => {
    const pkg = {
      dsh: {
        kind: 'preset',
        presetReason: REASON,
        bundle: { patch: ['./cordis.patch.yml', './presets/plugin-dev.patch.yml'] },
      },
    }
    const readAsset = reader({
      './cordis.patch.yml': PLAIN_BUNDLE_PATCH,
      './presets/plugin-dev.patch.yml': DECLARATION,
    })
    expect(resolvePresetAsset({ pkg, readAsset }).status).toBe('declared')
  })

  it('dsh.bundle.patch 列表含非字符串项 → 忽略该项，仍能判定', () => {
    const pkg = { dsh: { kind: 'preset', presetReason: REASON, bundle: { patch: [42, `./${PRESET_PATCH_FILE}`] } } }
    expect(resolvePresetAsset({ pkg, readAsset: reader({ [`./${PRESET_PATCH_FILE}`]: DECLARATION }) }).status).toBe(
      'declared',
    )
  })

  it('dsh.kind=preset 缺 presetReason → problem（必填理由，防随手豁免）', () => {
    const pkg = { dsh: { kind: 'preset', bundle: { patch: `./${PRESET_PATCH_FILE}` } } }
    const r = resolvePresetAsset({ pkg, readAsset: withDeclaration })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('presetReason')
  })

  it('dsh.presetReason 为空白字符串 / 非字符串 → problem', () => {
    for (const presetReason of ['', '   ', 42, null]) {
      const pkg = { dsh: { kind: 'preset', presetReason, bundle: { patch: `./${PRESET_PATCH_FILE}` } } }
      expect(resolvePresetAsset({ pkg, readAsset: withDeclaration }).status).toBe('problem')
    }
  })

  it('dsh.kind=preset 缺 dsh.bundle.patch → problem（0.1.7 的 preset 必须由 bundle 承载）', () => {
    const pkg = { dsh: { kind: 'preset', presetReason: REASON } }
    const r = resolvePresetAsset({ pkg, readAsset: withDeclaration })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('dsh.bundle.patch')
  })

  it('dsh.bundle.patch 非字符串 / 非数组（如数字）→ 视为缺载体 → problem', () => {
    const pkg = { dsh: { kind: 'preset', presetReason: REASON, bundle: { patch: 42 } } }
    expect(resolvePresetAsset({ pkg, readAsset: withDeclaration }).problem).toContain('dsh.bundle.patch')
  })

  it('dsh.kind=preset 与 dsh.client 互斥 → problem（自相矛盾即拒绝）', () => {
    const pkg = declaringPkg({ client: { platform: 'web' } })
    const r = resolvePresetAsset({ pkg, readAsset: withDeclaration })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('dsh.client')
  })

  it('声明 preset 但 patch 里没有声明行 → problem（无载体内容不得豁免）', () => {
    const pkg = declaringPkg()
    const r = resolvePresetAsset({ pkg, readAsset: reader({ [`./${PRESET_PATCH_FILE}`]: PLAIN_BUNDLE_PATCH }) })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain(PRESET_DECLARATION_PLUGIN)
  })

  it('声明 preset 但 patch 文件不存在 → problem', () => {
    const r = resolvePresetAsset({ pkg: declaringPkg(), readAsset: reader({}) })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain(PRESET_DECLARATION_PLUGIN)
  })

  it('声明行缺 config.id → problem（preset 身份缺失不得豁免）', () => {
    const noId = [
      '- insert:',
      `    - name: '${PRESET_DECLARATION_PLUGIN}'`,
      '      config:',
      '        plugins:',
      '',
    ].join('\n')
    const r = resolvePresetAsset({ pkg: declaringPkg(), readAsset: reader({ [`./${PRESET_PATCH_FILE}`]: noId }) })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('config.id')
  })

  it('声明行缺 plugins 列表 → problem（空插件行不可挂载）', () => {
    const noPlugins = [
      '- insert:',
      `    - name: '${PRESET_DECLARATION_PLUGIN}'`,
      '      config:',
      '        id: review',
      '',
    ].join('\n')
    const r = resolvePresetAsset({ pkg: declaringPkg(), readAsset: reader({ [`./${PRESET_PATCH_FILE}`]: noPlugins }) })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('plugins')
  })

  it('patch 里有声明行但未声明 dsh.kind → problem，提示正确修复方式（不误报缺 cordis peer）', () => {
    const r = resolvePresetAsset({ pkg: { dsh: {} }, readAsset: withDeclaration })
    expect(r.status).toBe('problem')
    expect(r.problem).toContain('未声明 dsh.kind')
    expect(r.problem).toContain('dsh.kind="preset"')
    expect(r.problem).toContain('#231')
  })

  it('patch 里有声明行但 dsh.kind=library（或拼写错误）→ problem（形态矛盾）', () => {
    for (const kind of ['library', 'presett']) {
      const r = resolvePresetAsset({ pkg: { dsh: { kind } }, readAsset: withDeclaration })
      expect(r.status).toBe('problem')
      expect(r.problem).toContain('agent preset 形态')
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
  const pkgOf = (dir) => JSON.parse(readFileSync(join(pluginsRoot, dir, 'package.json'), 'utf8'))

  it('dsh-plugin-dev-mode 按显式声明豁免（不是插件名单），且 patch 载体与声明行真实存在', () => {
    const r = inspect('dsh-plugin-dev-mode')
    expect(r.status).toBe('declared')
    expect(r.problem).toBeNull()
    const text = readFileSync(join(pluginsRoot, 'dsh-plugin-dev-mode', PRESET_PATCH_FILE), 'utf8')
    expect(text).toContain(PRESET_DECLARATION_PLUGIN)
    expect(pkgOf('dsh-plugin-dev-mode').dsh?.bundle?.patch).toBe(`./${PRESET_PATCH_FILE}`)
  })

  it('每个插件目录的判定只能是 declared / none——非法声明或形态矛盾即红', () => {
    const problems = dirs.map((d) => [d, inspect(d)]).filter(([, r]) => r.status === 'problem')
    expect(problems.map(([d, r]) => `${d}: ${r.problem}`)).toEqual([])
  })

  it('声明 dsh.kind=preset 的目录必须真的有 patch 载体与声明行（无载体不得豁免）', () => {
    for (const dir of dirs) {
      if (pkgOf(dir).dsh?.kind !== 'preset') continue
      expect(inspect(dir).status).toBe('declared')
      expect(pkgOf(dir).dsh?.bundle?.patch).toBeTruthy()
    }
  })

  it('已移除的目录资产（preset.yml / agent.cordis.yml）不得回归（0.1.7 无读取者）', () => {
    const stragglers = dirs.filter(
      (dir) =>
        existsSync(join(pluginsRoot, dir, 'preset.yml')) || existsSync(join(pluginsRoot, dir, 'agent.cordis.yml')),
    )
    expect(stragglers).toEqual([])
  })

  it('dsh-shared 仍走 dsh.kind=library（不被 preset 判据吞掉）', () => {
    expect(inspect('dsh-shared').status).toBe('none')
    expect(pkgOf('dsh-shared').dsh?.kind).toBe('library')
  })
})
