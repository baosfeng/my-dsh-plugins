/**
 * verify-checklist.test.mjs — 发版前功能级验证清单的幂等合并（issue #329 防回归）。
 *
 * 复现的事故（反模式：「生成器重写人工编辑的文件」）：
 *   `node scripts/verify-real-profile.mjs --checklist verification/<插件>-<版本>.md`
 *   过去**整文件重写**目标清单 —— 已发布版本的清单在发布后被重跑一次，
 *   末尾「验证记录（真实环境证据）」整段（实测 45 行）被删除，头部「验证时间/端口」
 *   被改写（3092 → 3087）。改动以未提交状态留在工作区，极易被顺手提交掉。
 *
 * 本测试**不启动任何隔离实例**（issue #329 要求把"生成逻辑"与"启动实例"解耦）：
 * 全部断言只喂文本给 scripts/lib/verify-checklist.mjs 的纯函数。
 *
 * 验收判据（issue #329）：
 *   1. 同一清单连跑两次（不同端口）→ 第二次零 diff；
 *   2. 已有 [x] 保留；「验证记录」人工段落**逐字节不变**。
 */
import { afterAll, describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_AUTO_ITEMS,
  FUNCTIONAL_ITEMS,
  checkChecklistFile,
  checkChecklistText,
  mergeChecklist,
  parseChecklist,
  renderChecklist,
} from '../lib/verify-checklist.mjs'

const repoRoot = join(fileURLToPath(new URL('../../', import.meta.url)))
/** issue #329 的原始受害文件（已发布版本的清单 + 人工验证记录）。 */
const REAL_CHECKLIST = join(repoRoot, 'verification', 'dsh-think-zh-expand-0.4.10.md')
/** 该文件里由 --clean-externals 生成的那条自动项（重跑同参数时逐字相同）。 */
const REAL_EXTRA_AUTO = 'external 缺包演练：隔离实例 node_modules 不含 dsh-md-render（启动日志无相关错误）'

/** 人工追加在清单末尾的「验证记录」段（模拟真实发布者的手写证据）。 */
const MANUAL_SECTION = `## 验证记录（真实环境证据，2026-09-15）

**验证方式**：\`node scripts/verify-real-profile.mjs --addons plugins/dsh-think-zh-expand --port 3092 --clean-externals\`

**缺包证据**：\`profiles/web/node_modules/dsh-md-render\` → No such file or directory。

**未覆盖项（如实记录）**：未做"装了 dsh-md-render 时逐字节一致"的对照。

截图：\`/tmp/dsh-think-verify/artifacts/fix-3092.png\`
`

/** 构造一份「自动项已勾选 + 功能级项已勾选 + 人工段落」的既有清单。 */
function fixtureText({ port = 3092, timestamp = '2026-09-15T13:10:21.446Z' } = {}) {
  const base = renderChecklist({
    plugin: 'dsh-think-zh-expand',
    version: '0.4.10',
    port,
    timestamp,
    autoItems: [...DEFAULT_AUTO_ITEMS, REAL_EXTRA_AUTO],
  })
  return base.replace(/- \[ \] /g, '- [x] ') + MANUAL_SECTION
}

/** 模拟一次重跑生成的「新清单文本」（端口/时间与上一轮不同）。 */
function freshRun({ port = 3087, timestamp = '2026-09-16T08:00:00.000Z', autoItems } = {}) {
  return renderChecklist({
    plugin: 'dsh-think-zh-expand',
    version: '0.4.10',
    port,
    timestamp,
    autoItems: autoItems ?? [...DEFAULT_AUTO_ITEMS, REAL_EXTRA_AUTO],
  })
}

describe('mergeChecklist — 幂等（issue #329 验收判据 1）', () => {
  it('同一清单连跑两次（端口 3092 → 3087）第二次零 diff', () => {
    const first = mergeChecklist({ existingText: fixtureText(), freshText: freshRun() }).text
    const second = mergeChecklist({ existingText: first, freshText: freshRun({ port: 3099 }) }).text
    expect(second).toBe(first)
  })

  it('已发布清单（0.4.10，issue 原始案例）重跑后逐字节不变', () => {
    const existing = readFileSync(REAL_CHECKLIST, 'utf8')
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun() }).text
    expect(merged).toBe(existing)
  })

  it('第三次、第四次重跑仍零 diff（幂等可重复）', () => {
    const existing = readFileSync(REAL_CHECKLIST, 'utf8')
    let text = existing
    for (const port of [3090, 3100, 3111]) {
      text = mergeChecklist({ existingText: text, freshText: freshRun({ port }) }).text
    }
    expect(text).toBe(existing)
  })
})

describe('mergeChecklist — 人工内容不被覆盖（issue #329 验收判据 2）', () => {
  it('「验证记录」人工段落逐字节不变', () => {
    const existing = fixtureText()
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun() }).text
    expect(merged.endsWith(MANUAL_SECTION)).toBe(true)
    const before = existing.slice(existing.indexOf('## 验证记录'))
    const after = merged.slice(merged.indexOf('## 验证记录'))
    expect(after).toBe(before)
  })

  it('已勾选的功能级 [x] 全部保留', () => {
    const existing = fixtureText()
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun() }).text
    const doc = parseChecklist(merged)
    for (const item of FUNCTIONAL_ITEMS) {
      expect(doc.functional.join('\n')).toContain(`- [x] ${item}`)
    }
    expect(checkChecklistText(merged).ok).toBe(true)
  })

  it('未勾选的功能级 [ ] 保持未勾选（不替验证者下结论）', () => {
    const existing =
      renderChecklist({
        plugin: 'dsh-think-zh-expand',
        version: '0.4.10',
        port: 3092,
        timestamp: '2026-09-15T13:10:21.446Z',
      }) + MANUAL_SECTION
    const merged = mergeChecklist({
      existingText: existing,
      freshText: freshRun({ autoItems: DEFAULT_AUTO_ITEMS }),
    }).text
    expect(merged).toBe(existing)
    expect(checkChecklistText(merged).pending).toEqual([...FUNCTIONAL_ITEMS])
  })

  it('人工在清单里新增的段落/条目不被删除', () => {
    const existing = fixtureText().replace(
      '- [x] 核心功能走通（插件主功能在真实 GUI 中可用）',
      '- [x] 核心功能走通（插件主功能在真实 GUI 中可用）\n- [x] 自定义验收点：三档降级实测',
    )
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun() }).text
    expect(merged).toContain('- [x] 自定义验收点：三档降级实测')
  })

  it('头部「验证时间 / 验证环境」保持原值（不产生假 diff）', () => {
    const existing = fixtureText()
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun() }).text
    expect(merged).toContain('验证时间：2026-09-15T13:10:21.446Z')
    expect(merged).toContain('端口 3092')
    expect(merged).not.toContain('端口 3087')
  })

  it('refreshHeader 显式开启时才刷新时间/环境行，且不动人工段落', () => {
    const existing = fixtureText()
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun(), refreshHeader: true }).text
    expect(merged).toContain('验证时间：2026-09-16T08:00:00.000Z')
    expect(merged).toContain('端口 3087')
    expect(merged.endsWith(MANUAL_SECTION)).toBe(true)
  })
})

describe('mergeChecklist — 自动验证项按本轮刷新', () => {
  it('自动项里的 [ ] 被本轮结果刷新为 [x]', () => {
    const existing = fixtureText().replace('- [x] 实例启动就绪（HTTP 200）', '- [ ] 实例启动就绪（HTTP 200）')
    const merged = mergeChecklist({ existingText: existing, freshText: freshRun() }).text
    expect(merged).toContain('- [x] 实例启动就绪（HTTP 200）')
  })

  it('本轮新增的自动项被补入', () => {
    const existing = fixtureText()
    const merged = mergeChecklist({
      existingText: existing,
      freshText: freshRun({ autoItems: [...DEFAULT_AUTO_ITEMS, REAL_EXTRA_AUTO, '本轮新增：缺包演练升级为双包'] }),
    }).text
    expect(merged).toContain('- [x] 本轮新增：缺包演练升级为双包')
    expect(merged).toContain('- [x] 实例启动就绪（HTTP 200）')
  })

  it('上一轮有、本轮没有的自动项保留不删（宁多留证据）', () => {
    const existing = fixtureText()
    const merged = mergeChecklist({
      existingText: existing,
      freshText: freshRun({ autoItems: DEFAULT_AUTO_ITEMS }),
    }).text
    expect(merged).toContain(REAL_EXTRA_AUTO)
  })
})

describe('mergeChecklist — 结构不可识别时 fail-closed', () => {
  it('缺锚点的文件原样返回，不做任何改写', () => {
    const weird = '# 手写清单\n\n- [x] 我自己写的项\n\n## 验证记录\n\n证据\n'
    const result = mergeChecklist({ existingText: weird, freshText: freshRun() })
    expect(result.text).toBe(weird)
    expect(result.merged).toBe(false)
    expect(result.reason).toBeTruthy()
  })
})

describe('renderChecklist — 新文件模板（行为零回归）', () => {
  it('与 issue #67 的既有模板逐字节一致', () => {
    const text = renderChecklist({
      plugin: 'dsh-demo',
      version: '0.1.0',
      port: 3087,
      timestamp: '2026-09-15T00:00:00.000Z',
    })
    expect(text).toBe(
      `# 发版前功能级验证清单 — dsh-demo@0.1.0

验证时间：2026-09-15T00:00:00.000Z
验证环境：隔离实例（端口 3087，复用生产 profile 配置组合，独立 DSH_HOME）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [ ] 核心功能走通（插件主功能在真实 GUI 中可用）
- [ ] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [ ] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [ ] 插件间联动不崩（与相邻插件共存）
- [ ] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
`,
    )
  })

  it('autoItems 为参数（缺包演练行由调用方决定）', () => {
    const text = renderChecklist({
      plugin: 'dsh-demo',
      version: '0.1.0',
      port: 3087,
      timestamp: '2026-09-15T00:00:00.000Z',
      autoItems: [...DEFAULT_AUTO_ITEMS, REAL_EXTRA_AUTO],
    })
    expect(text).toContain(`- [x] ${REAL_EXTRA_AUTO}`)
  })
})

describe('checkChecklistText — release.mjs 的 #67 门禁用它判定', () => {
  it('功能级项未全勾选 → 不通过，并列出待验证项', () => {
    const text = renderChecklist({
      plugin: 'dsh-demo',
      version: '0.1.0',
      port: 3087,
      timestamp: '2026-09-15T00:00:00.000Z',
    })
    const result = checkChecklistText(text)
    expect(result.ok).toBe(false)
    expect(result.pending).toEqual([...FUNCTIONAL_ITEMS])
  })

  it('功能级项全勾选 → 通过（自动项不参与判定）', () => {
    const text = renderChecklist({
      plugin: 'dsh-demo',
      version: '0.1.0',
      port: 3087,
      timestamp: '2026-09-15T00:00:00.000Z',
    }).replace(/- \[ \] /g, '- [x] ')
    expect(checkChecklistText(text).ok).toBe(true)
  })

  it('无功能级段的历史清单不阻断（与 #67 既有语义一致）', () => {
    expect(checkChecklistText('# 手写清单\n\n- [ ] 随便一项\n').ok).toBe(true)
  })
})

describe('接线防漂移 — CLI 必须真的调用 lib（issue #329）', () => {
  it('verify-real-profile.mjs 通过 lib 的 mergeChecklist 落盘，而非自造一份重写逻辑', () => {
    const source = readFileSync(join(repoRoot, 'scripts', 'verify-real-profile.mjs'), 'utf8')
    expect(source).toContain("from './lib/verify-checklist.mjs'")
    expect(source).toContain('mergeChecklist(')
    expect(source).toContain('checkChecklistFile(')
    expect(source).not.toContain('function mergeChecklistState')
  })
})

describe('checkChecklistFile — `--check` 的文件级判定（release.mjs 3c 第二段）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vchecklist-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const make = (name, text) => {
    const file = join(dir, name)
    writeFileSync(file, text, 'utf8')
    return file
  }
  const fresh = (checked) => {
    const text = renderChecklist({
      plugin: 'dsh-demo',
      version: '0.1.0',
      port: 3087,
      timestamp: '2026-09-15T00:00:00.000Z',
    })
    return checked ? text.replace(/- \[ \] /g, '- [x] ') : text
  }

  it('清单不存在 → missing（发版前没跑 --checklist）', () => {
    const result = checkChecklistFile(join(dir, 'nope.md'))
    expect(result.missing).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('存在但功能级项未勾选 → 阻断', () => {
    const result = checkChecklistFile(make('pending.md', fresh(false)))
    expect(result.missing).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.pending).toEqual([...FUNCTIONAL_ITEMS])
  })

  it('存在且功能级项全勾选 → 放行', () => {
    const result = checkChecklistFile(make('checked.md', fresh(true)))
    expect(result.ok).toBe(true)
    expect(result.pending).toEqual([])
  })
})

/**
 * 判据有效性证明（mutation 风格）：把实现换回 #329 的旧行为，本文件里所有幂等用例
 * 都必须失败 —— 断言留在这里，是为了证明上面那些用例真的能抓到 #329，而不是"恰好通过"。
 *
 * `legacyRewrite` 的行为**等价于改动前的 scripts/verify-real-profile.mjs**
 * （`checklistTemplate` + `mergeChecklistState`）：整文件重写 + 只按文案合并功能级 [x]。
 * 改动前用它对 issue 原始受害文件实测：人工「验证记录」段整段（**43 行**）被删除、
 * 头部「验证时间 / 端口」2 行被改写（3092 → 3087）。
 */
function legacyRewrite(existingText, freshText) {
  const checked = new Set()
  let inFunctional = false
  for (const line of existingText.split('\n')) {
    if (line.startsWith('## 功能级验证项')) inFunctional = true
    else if (line.startsWith('## ')) inFunctional = false
    if (!inFunctional) continue
    const m = /^- \[x\] (.+)$/.exec(line.trim())
    if (m) checked.add(m[1])
  }
  if (checked.size === 0) return freshText
  return freshText
    .split('\n')
    .map((line) => {
      const m = /^- \[( |x)\] (.+)$/.exec(line.trim())
      if (m && checked.has(m[2])) return line.replace('- [ ]', '- [x]')
      return line
    })
    .join('\n')
}

describe('判据有效性 — 旧行为必须被判失败（复现 #329 现象）', () => {
  it('旧逻辑整文件重写 → 人工「验证记录」段整段丢失', () => {
    const existing = fixtureText()
    const legacy = legacyRewrite(existing, freshRun())
    expect(legacy).not.toBe(existing)
    expect(legacy).not.toContain('## 验证记录（真实环境证据，2026-09-15）')
  })

  it('旧逻辑重写头部 → 端口 3092 被改写成 3087（对已发布版本是假 diff）', () => {
    const legacy = legacyRewrite(fixtureText(), freshRun())
    expect(legacy).toContain('端口 3087')
    expect(legacy).not.toContain('端口 3092')
  })

  it('旧逻辑同样能保住功能级 [x]（说明 #67 勾选保 merge 不是本卡的修复点）', () => {
    const legacy = legacyRewrite(fixtureText(), freshRun())
    expect(legacy).toContain('- [x] 核心功能走通（插件主功能在真实 GUI 中可用）')
  })
})
