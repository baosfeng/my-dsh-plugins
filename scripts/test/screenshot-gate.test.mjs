/**
 * screenshot-gate.test.mjs — README 效果图门禁判定单元测试（issue #227）。
 *
 * 覆盖：引用提取（相对路径 / unpkg URL / HTML img）、豁免判据（dsh.kind=library、
 * dsh.ui=false + uiReason、与 dsh.client 互斥、非法声明）与三种门禁结局
 * （pass / exempt / fail）；外加**仓库不变量**断言，防「豁免判据腐烂」：
 *   - 声明 dsh.ui=false 的插件必须真的没有 client 端，且 README 向读者说明了「无 UI」；
 *   - 含 client 端的插件（必然有 UI）不得走豁免——真实截图要求不放松；
 *   - dsh-my-opencode-session-header（纯 server）按 dsh.ui=false 显式豁免，而不是名单豁免。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractScreenshotRefs, resolveScreenshotExemption, checkScreenshotGate } from '../lib/screenshot-gate.mjs'

// ── extractScreenshotRefs ─────────────────────────────────────────────────
describe('extractScreenshotRefs', () => {
  it('提取 markdown 相对路径引用', () => {
    expect(extractScreenshotRefs('![面板](./assets/panel.png)')).toEqual(['panel.png'])
  })

  it('提取 markdown unpkg 绝对 URL 引用', () => {
    expect(extractScreenshotRefs('![面板](https://unpkg.com/dsh-x/assets/panel.png)')).toEqual(['panel.png'])
  })

  it('提取 HTML <img> 的两种形态', () => {
    const md = [
      '<img alt="a" src="./assets/a.png" width="340" />',
      '<img alt="b" src="https://unpkg.com/dsh-x/assets/b.png" />',
    ].join('\n')
    expect(extractScreenshotRefs(md)).toEqual(['a.png', 'b.png'])
  })

  it('去重并保持出现顺序', () => {
    const md = '![a](./assets/x.png)\n![b](./assets/y.png)\n![c](./assets/x.png)'
    expect(extractScreenshotRefs(md)).toEqual(['x.png', 'y.png'])
  })

  it('忽略非 assets 图片与 badge', () => {
    const md = '![badge](https://img.shields.io/badge/x-y-blue)\n![logo](./logo.png)'
    expect(extractScreenshotRefs(md)).toEqual([])
  })

  it('空 / null 文本返回空数组', () => {
    expect(extractScreenshotRefs('')).toEqual([])
    expect(extractScreenshotRefs(null)).toEqual([])
    expect(extractScreenshotRefs(undefined)).toEqual([])
  })
})

// ── resolveScreenshotExemption ────────────────────────────────────────────
describe('resolveScreenshotExemption（豁免判据）', () => {
  it('dsh.kind=library（共享工具包）走原有豁免', () => {
    const r = resolveScreenshotExemption({ dsh: { kind: 'library' } })
    expect(r.exempt).toBe(true)
    expect(r.kind).toBe('library')
    expect(r.problem).toBeNull()
  })

  it('dsh.ui=false + 非空 uiReason → 豁免，理由随判定带出（发版输出可见）', () => {
    const r = resolveScreenshotExemption({ dsh: { ui: false, uiReason: '纯 server：仅注入 HTTP 请求头' } })
    expect(r.exempt).toBe(true)
    expect(r.kind).toBe('ui-none')
    expect(r.reason).toContain('纯 server：仅注入 HTTP 请求头')
    expect(r.problem).toBeNull()
  })

  it('dsh.ui=false 缺 uiReason → 拒绝豁免（不得「随手豁免」）', () => {
    const r = resolveScreenshotExemption({ dsh: { ui: false } })
    expect(r.exempt).toBe(false)
    expect(r.problem).toContain('uiReason')
  })

  it('dsh.ui=false 且 uiReason 只有空白 → 拒绝豁免', () => {
    expect(resolveScreenshotExemption({ dsh: { ui: false, uiReason: '   ' } }).problem).toContain('uiReason')
  })

  it('dsh.ui=false 与 dsh.client 互斥（声明无 UI 却提供 client 端 = 自欺）', () => {
    const r = resolveScreenshotExemption({ dsh: { ui: false, uiReason: 'x', client: { platform: 'web' } } })
    expect(r.exempt).toBe(false)
    expect(r.problem).toContain('dsh.client')
  })

  it('dsh.ui 非布尔值 → 报错（避免用字符串糊弄判据）', () => {
    const r = resolveScreenshotExemption({ dsh: { ui: 'no' } })
    expect(r.exempt).toBe(false)
    expect(r.problem).toContain('布尔')
  })

  it('dsh.ui=true / 未声明 → 不豁免且不报错（照旧要求真实截图）', () => {
    expect(resolveScreenshotExemption({ dsh: { ui: true } })).toEqual({
      exempt: false,
      kind: null,
      reason: '',
      problem: null,
    })
    expect(resolveScreenshotExemption({ dsh: {} })).toEqual({ exempt: false, kind: null, reason: '', problem: null })
    expect(resolveScreenshotExemption({})).toEqual({ exempt: false, kind: null, reason: '', problem: null })
    expect(resolveScreenshotExemption(undefined)).toEqual({ exempt: false, kind: null, reason: '', problem: null })
  })
})

// ── checkScreenshotGate ───────────────────────────────────────────────────
describe('checkScreenshotGate', () => {
  const assetExists = (file) => file === 'panel.png'

  it('引用存在的截图 → pass（带引用数量）', () => {
    const r = checkScreenshotGate({
      name: 'dsh-x',
      pkg: {},
      readme: '![面板](./assets/panel.png)',
      assetExists,
    })
    expect(r.status).toBe('pass')
    expect(r.refs).toEqual(['panel.png'])
    expect(r.detail).toContain('1 screenshot')
  })

  it('引用缺失文件 → fail 并列出缺失文件名', () => {
    const r = checkScreenshotGate({
      name: 'dsh-x',
      pkg: {},
      readme: '![面板](./assets/gone.png)',
      assetExists,
    })
    expect(r.status).toBe('fail')
    expect(r.missing).toEqual(['gone.png'])
    expect(r.detail).toContain('references missing screenshots: gone.png')
  })

  it('无任何截图引用 → fail，并提示无 UI 插件如何显式豁免', () => {
    const r = checkScreenshotGate({ name: 'dsh-x', pkg: {}, readme: '# dsh-x', assetExists })
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('has no real screenshot reference')
    expect(r.detail).toContain('dsh.ui=false')
  })

  it('README 缺失（null）同样按无引用处理 → fail', () => {
    expect(checkScreenshotGate({ name: 'dsh-x', pkg: {}, readme: null, assetExists }).status).toBe('fail')
  })

  it('library 豁免：不读 README 也 pass 为 exempt', () => {
    const r = checkScreenshotGate({ name: 'dsh-shared', pkg: { dsh: { kind: 'library' } }, readme: null, assetExists })
    expect(r.status).toBe('exempt')
    expect(r.exemption.kind).toBe('library')
    expect(r.detail).toContain('dsh.kind=library')
  })

  it('显式无 UI 声明 → exempt，理由进入 detail（发版输出可见）', () => {
    const r = checkScreenshotGate({
      name: 'dsh-y',
      pkg: { dsh: { ui: false, uiReason: '纯 server 插件：GUI 无可见产物' } },
      readme: null,
      assetExists,
    })
    expect(r.status).toBe('exempt')
    expect(r.detail).toContain('纯 server 插件：GUI 无可见产物')
  })

  it('豁免声明不合法 → fail（必须修正声明，而不是静默放行）', () => {
    const r = checkScreenshotGate({ name: 'dsh-z', pkg: { dsh: { ui: false } }, readme: null, assetExists })
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('dsh-z/package.json')
  })
})

// ── 仓库不变量（防判据腐烂 / 防自欺）────────────────────────────────────
describe('仓库不变量：豁免声明与实际形态一致', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const pluginsDir = join(repoRoot, 'plugins')
  const pluginNames = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const loadPkg = (name) => JSON.parse(readFileSync(join(pluginsDir, name, 'package.json'), 'utf8'))

  it('声明 dsh.ui=false 的插件必须真的没有 client 端', () => {
    const offenders = []
    for (const name of pluginNames) {
      const pkg = loadPkg(name)
      if (pkg.dsh?.ui === false && pkg.dsh.client !== undefined) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })

  it('声明 dsh.ui=false 的插件必须在 README 向读者说明「无 UI / 无可截图产物」', () => {
    const missing = []
    for (const name of pluginNames) {
      if (loadPkg(name).dsh?.ui !== false) continue
      const readme = readFileSync(join(pluginsDir, name, 'README.md'), 'utf8')
      if (!/无 UI|无可截图|不产生界面截图/.test(readme)) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it('含 client 端的插件（必然有 UI）不得被豁免——必须给出真实截图', () => {
    const offenders = []
    for (const name of pluginNames) {
      const pkg = loadPkg(name)
      if (pkg.dsh?.client === undefined) continue
      const readme = readFileSync(join(pluginsDir, name, 'README.md'), 'utf8')
      const result = checkScreenshotGate({
        name,
        pkg,
        readme,
        assetExists: () => true,
      })
      if (result.status !== 'pass') offenders.push(`${name} (${result.status})`)
    }
    expect(offenders).toEqual([])
  })

  it('dsh-my-opencode-session-header（纯 server）按 dsh.ui=false 显式豁免，而不是写死名单', () => {
    const pkg = loadPkg('dsh-my-opencode-session-header')
    const exemption = resolveScreenshotExemption(pkg)
    expect(exemption.exempt).toBe(true)
    expect(exemption.kind).toBe('ui-none')
    expect(pkg.dsh.client).toBeUndefined()
  })

  it('dsh-shared（共享工具包）仍走 dsh.kind=library 豁免', () => {
    expect(resolveScreenshotExemption(loadPkg('dsh-shared')).kind).toBe('library')
  })
})
