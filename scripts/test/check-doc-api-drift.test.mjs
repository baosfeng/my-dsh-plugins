/**
 * check-doc-api-drift.mjs 回归测试（文档-代码漂移门禁）。
 *
 * 三类断言，缺一不可：
 *  1. **能力**：文档提到代码里没有的 API、代码用了文档没登记的 API、范例坐标失效——
 *     都必须被抓住（否则门禁形同虚设，本门禁要防的两个真实事故会静默复发）；
 *  2. **不误报**：每条豁免规则都要有反例——尤其"剥离注释"这条：`ctx.config` 全仓 11 处
 *     只在注释里，若不剥离就会被判成"代码在用"，文档里写它就再也抓不到；
 *  3. **真实仓库自检**：用当前工作区跑一遍，findings 必须是空数组（这条最重要——
 *     它保证门禁当下可用，而不是"写了个永远红的门禁"）。
 *
 * fixture 用 mkdtemp 造独立小仓库（无 git 依赖），纯函数级用例直接注入两侧数据。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirSync } from 'tmp'
import { join } from 'node:path'
import {
  DOC_REL,
  INTENTIONALLY_ABSENT,
  REPO_ROOT,
  buildCodeSurface,
  evaluate,
  isEventName,
  parseDoc,
  runCheck,
  stripComments,
} from '../check-doc-api-drift.mjs'

const tmpRoots = []
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})

const DOC_FILE = DOC_REL

/**
 * fixture 的「健康文档」：只列默认 fixture 代码里真实存在的能力（`ctx.effect` / `ctx.logger` /
 * `ctx.webServer`）+ 事件 `tools/pre-execute` + `dsh.kind`——避免 fixture 自己引入无关漂移，
 * 让每个用例只断言它要断的那一条。
 */
const HEALTHY_DOC = [
  '# 重点',
  '',
  '## 一、能力',
  '',
  '| 能力 | 用途 | 范例 |',
  '| --- | --- | --- |',
  '| `ctx.effect` | 基座 | `dsh-demo/src/index.ts:2` |',
  '| `ctx.logger` | 日志 | `dsh-demo/src/index.ts:3` |',
  '| `ctx.webServer` | HTTP | `dsh-demo/src/index.ts:4` |',
  '',
  '**事件面**：`tools/pre-execute`。',
  '',
  '## 三、自造字段',
  '',
  '`dsh.kind`（`library`/`preset`）。',
  '',
].join('\n')

/**
 * 空文档：只用来断言"代码在用、文档完全没登记"这一方向——文档里一个 API 都不声明，
 * 于是任何 finding 都必然来自代码侧（避免 fixture 自带的范例坐标引入噪音）。
 */
const EMPTY_DOC = ['# 重点', '', '## 一、能力', '', '（此 fixture 刻意不声明任何能力）'].join('\n')

/**
 * 造 fixture 仓库。默认内容刻意做出**一处漂移**（文档写 `ctx.missingApi`，代码里没有）
 * 之外，其余都成对存在，便于断言"只有该处被报"。
 */
function makeRepo({ doc, code, pkg } = {}) {
  const { name: root } = dirSync({ unsafeCleanup: true, prefix: 'doc-api-' })
  tmpRoots.push(root)
  const write = (rel, content) => {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  write('plugins/dsh-demo/package.json', pkg ?? JSON.stringify({ name: 'dsh-demo', dsh: { kind: 'library' } }))
  write(
    'plugins/dsh-demo/src/index.ts',
    code ??
      [
        'export function apply(ctx, config) {',
        "  ctx.effect(() => ctx.on('tools/pre-execute', () => {}))",
        "  ctx.logger.info('ok')",
        '  ctx.webServer.register({})',
        '}',
      ].join('\n'),
  )
  write(
    DOC_FILE,
    doc ??
      [
        '# 重点',
        '',
        '## 一、能力',
        '',
        '| 能力 | 用途 | 范例 | 官方页 |',
        '| --- | --- | --- | --- |',
        '| `ctx.effect` | 基座 | `dsh-demo/src/index.ts:2` | x |',
        '| `ctx.logger` | 日志 | `dsh-demo/src/index.ts:3` | x |',
        '| `ctx.missingApi` | 漂移项 | `dsh-demo/src/index.ts:2` | x |',
        '',
        '## 二、没有的',
        '',
        '- `ctx.config` —— 全仓只在注释里，真实调用 0。',
        '',
      ].join('\n'),
  )
  return root
}

/**
 * fixture 的 API 面 + 文档声明（纯函数用例用）。
 * 与 `runCheck` 同源地补齐 `evaluate` 需要的 `root` / `members`（Set）——少这两个字段
 * 会让范例坐标解析不到文件，测试就成了假绿。
 */
function surfaces(root) {
  const code = buildCodeSurface(root)
  const doc = parseDoc(readFileSync(join(root, DOC_FILE), 'utf8'))
  return {
    code: { ...code, root, members: new Set([...code.members.keys()]) },
    doc,
  }
}

const kindsOf = (findings) => findings.map((f) => `${f.kind}:${f.target}`)

// ── 1. 能力：漂移必须被抓住 ────────────────────────────────────────────────

describe('漂移能抓到', () => {
  it('文档声明了代码里不存在的 API → doc-missing-api', () => {
    const root = makeRepo()
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('doc-missing-api:missingApi')
  })

  it('代码用了文档未声明的宿主服务 → code-undocumented-service', () => {
    const root = makeRepo({
      doc: EMPTY_DOC,
      code: "export function apply(ctx) {\n  ctx.get('webServer')\n}\n",
    })
    const { code, doc } = surfaces(root)
    const hits = kindsOf(evaluate({ code, doc }))
    expect(hits).toContain('code-undocumented-service:webServer')
  })

  it('代码用了文档未声明的事件 → code-undocumented-event', () => {
    const root = makeRepo({
      doc: EMPTY_DOC,
      code: "export function apply(ctx) {\n  ctx.on('agent/status', () => {})\n}\n",
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('code-undocumented-event:agent/status')
  })

  it('代码用了文档未声明的槽位 → code-undocumented-slot', () => {
    const root = makeRepo({
      doc: EMPTY_DOC,
      code: "export function apply(ctx) {\n  ctx.slots.inject('settings.plugins.tab', () => null)\n}\n",
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('code-undocumented-slot:settings.plugins.tab')
  })

  it('代码新声明了文档未登记的自造字段 → code-undocumented-field', () => {
    const root = makeRepo({
      doc: EMPTY_DOC,
      pkg: JSON.stringify({ name: 'dsh-demo', dsh: { brandNewField: true } }),
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('code-undocumented-field:brandNewField')
  })

  it('范例坐标指向不存在的文件 → bad-example-file', () => {
    const root = makeRepo({
      doc: ['# 重点', '', '## 一、能力', '', '| `ctx.effect` | x | `dsh-demo/src/nope.ts:1` |'].join('\n'),
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('bad-example-file:dsh-demo/src/nope.ts')
  })

  it('范例行号超出文件行数 → bad-example-line（行号允许漂移，但不能出界）', () => {
    const root = makeRepo({
      doc: ['# 重点', '', '## 一、能力', '', '| `ctx.effect` | x | `dsh-demo/src/index.ts:9999` |'].join('\n'),
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('bad-example-line:dsh-demo/src/index.ts:9999')
  })

  it('范例文件里没有该 API → bad-example-api（范例指错了文件）', () => {
    const root = makeRepo({
      doc: ['# 重点', '', '## 一、能力', '', '| `ctx.systemPrompt` | x | `dsh-demo/src/index.ts:2` |'].join('\n'),
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toContain('bad-example-api:dsh-demo/src/index.ts')
  })

  it('同行 API 在文件里存在 → 不报 bad-example-api（行号对了但内容别处）', () => {
    const root = makeRepo({
      doc: ['# 重点', '', '## 一、能力', '', '| `ctx.logger` | x | `dsh-demo/src/index.ts:2` |'].join('\n'),
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).not.toContain('bad-example-api:dsh-demo/src/index.ts')
  })
})

// ── 1b. 变异验证：同一 fixture 先破坏再修复（证明断言不是永远绿）─────────────

describe('变异验证（红 → 绿）', () => {
  it('把文档里的 API 改成不存在的名字 → 红；改回来 → 绿', () => {
    const broken = makeRepo({
      doc: [
        '# 重点',
        '',
        '## 一、能力',
        '',
        '| 能力 | 用途 | 范例 |',
        '| --- | --- | --- |',
        '| `ctx.effect` | 基座 | `dsh-demo/src/index.ts:2` |',
        '| `ctx.typoApi` | 打错的名字 | `dsh-demo/src/index.ts:2` |',
      ].join('\n'),
    })
    expect(kindsOf(evaluate(surfaces(broken)))).toContain('doc-missing-api:typoApi')

    const healthy = makeRepo({ doc: HEALTHY_DOC })
    expect(evaluate(surfaces(healthy))).toEqual([])

    // 同一份健康文档，再把代码里那个被声明的能力删掉 → 立刻变红（证明绿不是假绿）。
    // 这里把 dsh 清单一并去掉，让断言只聚焦"文档声明了、代码没了"这一条。
    const regressed = makeRepo({
      doc: HEALTHY_DOC,
      code: 'export function apply(ctx) {\n  void ctx\n}\n',
      pkg: JSON.stringify({ name: 'dsh-demo' }),
    })
    const hits = kindsOf(evaluate(surfaces(regressed)))
    expect(hits).toContain('doc-missing-api:webServer')
    expect(hits).toContain('doc-missing-event:tools/pre-execute')
  })
})

// ── 2. 不误报：豁免规则的反例 ─────────────────────────────────────────────

describe('不误报', () => {
  it('注释里的 ctx.foo 不算"代码在用"，真实代码里的 ctx.bar 才算（剥离注释）', () => {
    const stripped = stripComments(
      [
        '// ctx.commentedOnly 只是注释',
        '/* ctx.blockCommented 也是注释 */',
        '/** JSDoc: ctx.jsdocOnly 依然是注释 */',
        'export function apply(ctx) {',
        '  ctx.webServer.register({})',
        '}',
      ].join('\n'),
    )
    expect(stripped).not.toContain('ctx.commentedOnly')
    expect(stripped).not.toContain('ctx.blockCommented')
    expect(stripped).not.toContain('ctx.jsdocOnly')
    expect(stripped).toContain('ctx.webServer')

    // 真实事故复现：`ctx.config` 只在注释里 → 既不算"代码在用"，也不产生任何 finding
    const root = makeRepo({
      doc: HEALTHY_DOC,
      code: [
        '// ctx.config 只在注释里（真实事故：文档写它，代码 0 调用）',
        'export function apply(ctx) {',
        "  ctx.effect(() => ctx.on('tools/pre-execute', () => {}))",
        "  ctx.logger.info('ok')",
        '  ctx.webServer.register({})',
        '}',
      ].join('\n'),
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).toEqual([])
    expect(buildCodeSurface(root).services.has('config')).toBe(false)
  })

  it('文档写 ctx.config（有意标注为不存在）→ 不报', () => {
    const root = makeRepo({
      doc: [
        '# 重点',
        '',
        '## 一、能力',
        '',
        '| 能力 |',
        '| --- |',
        '| `ctx.effect` |',
        '',
        '## 四、容易被误导',
        '',
        '`ctx.config` 全仓 11 处全在注释里，真实调用 0；配置入口是 `apply(ctx, config)`。',
      ].join('\n'),
    })
    const { code, doc } = surfaces(root)
    const hits = kindsOf(evaluate({ code, doc }))
    expect(hits).not.toContain('doc-missing-api:config')
  })

  it('INTENTIONALLY_ABSENT 里的每一项都能被白名单机制命中（短名 / ctx. 前缀 / 调用形态）', () => {
    // betterSidebar 是第三方 API：文档写 `ctx.betterSidebar` 这种形态，短名也要能命中
    const root = makeRepo({
      doc: ['# 重点', '', '## 四、误导', '', '- `ctx.betterSidebar` 与 `settings.plugin.item` 代码零使用。'].join('\n'),
    })
    const { code, doc } = surfaces(root)
    const hits = kindsOf(evaluate({ code, doc }))
    expect(hits).not.toContain('doc-missing-api:betterSidebar')
    expect(hits).not.toContain('doc-missing-slot:settings.plugin.item')
    expect(INTENTIONALLY_ABSENT).toContain('betterSidebar')
    expect(INTENTIONALLY_ABSENT).toContain('settings.plugin.item')
  })

  it('cordis 通用成员（ctx.get 只提供方法）不阻断"代码在用"', () => {
    const root = makeRepo({
      doc: HEALTHY_DOC,
      code: [
        'export function apply(ctx) {',
        "  ctx.effect(() => ctx.on('tools/pre-execute', () => {}))",
        "  ctx.logger.info('ok')",
        '  ctx.webServer.register({})',
        "  ctx.get('slots', false)",
        '}',
      ].join('\n'),
    })
    const { code, doc } = surfaces(root)
    // ctx.get 是"调用手段"：既不算服务漂移，也不因它本身被报
    const hits = kindsOf(evaluate({ code, doc }))
    expect(hits).not.toContain('code-undocumented-service:get')
    expect(hits).toEqual(['code-undocumented-service:slots'])
  })

  it('恰好也叫 ctx 的局部变量（ctx.now / ctx.max）不算宿主服务', () => {
    const root = makeRepo({
      doc: HEALTHY_DOC,
      code: ['export function scan(ctx) {', '  return [ctx.now, ctx.max, ctx.cwd, ctx.result, ctx.keyword]', '}'].join(
        '\n',
      ),
    })
    const { code, doc } = surfaces(root)
    const hits = kindsOf(evaluate({ code, doc }))
    expect(hits.filter((h) => h.includes('ctx.') || /now|max|cwd|result|keyword/.test(h))).toEqual([])
    // 这五个都不该进服务表
    const surface = buildCodeSurface(root)
    for (const n of ['now', 'max', 'cwd', 'result', 'keyword']) {
      expect(surface.services.has(n)).toBe(false)
    }
  })

  it('源码里字符串/正则中的 // 不会被当成行注释（保留后续 ctx.* 调用）', () => {
    const stripped = stripComments(
      [
        "const url = 'https://example.com/x'",
        'const re = /a\\/\\/b/',
        'export function apply(ctx) {',
        '  ctx.tools.register({})',
        '}',
      ].join('\n'),
    )
    expect(stripped).toContain('ctx.tools')
    expect(stripped).toContain('https://example.com/x')
  })

  it('文档里的仓库路径（skills/x、scripts/x.mjs）不被当成事件名', () => {
    expect(isEventName('skills/plugin-runtime-debug')).toBe(false)
    expect(isEventName('tools/pre-execute')).toBe(true)
    expect(isEventName('plugin:status-query')).toBe(true)
  })

  it('范例坐标支持相对 plugins/ 与仓库根两种基准', () => {
    const root = makeRepo({
      doc: HEALTHY_DOC,
    })
    const { code, doc } = surfaces(root)
    expect(kindsOf(evaluate({ code, doc }))).not.toContain('bad-example-file:dsh-demo/src/index.ts')
  })
})

// ── 3. 真实仓库自检（最重要：保证门禁当下可用）──────────────────────────────

describe('真实仓库自检', () => {
  it('当前工作区的 findings 为空数组（否则门禁不可用）', () => {
    const result = runCheck({ root: REPO_ROOT })
    expect(result.findings).toEqual([])
    expect(result.stats.codeFiles).toBeGreaterThan(100)
    expect(result.stats.docDeclarations).toBeGreaterThan(20)
  })

  it('CLI 退出码为 0 且打印 ✓', () => {
    const out = execFileSync('node', ['scripts/check-doc-api-drift.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(out).toContain('✓ 文档-代码 API 面一致')
  })

  it('--json 输出可机读且 findings 为空', () => {
    const out = execFileSync('node', ['scripts/check-doc-api-drift.mjs', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out)
    expect(parsed.findings).toEqual([])
    expect(parsed.services.code).toContain('webServer')
    expect(parsed.slots.code).toContain('settings.plugins.tab')
  })

  it('真实仓库里 ctx.config 未被当成"代码在用"（注释剥离的实战证据）', () => {
    const surface = buildCodeSurface(REPO_ROOT)
    expect(surface.services.has('config')).toBe(false)
    expect(surface.members.has('config')).toBe(false)
    // 反面：真实调用必须在
    expect(surface.services.has('pluginInventory')).toBe(true)
    expect(surface.services.has('webServer')).toBe(true)
  })
})
