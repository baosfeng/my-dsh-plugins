/**
 * check-links.mjs 回归测试。
 *
 * 两类断言，缺一不可：
 *  1. **能力**：失效的 markdown 链接/图片/锚点、路径 token、shell 调用、npm script、
 *     skill 与插件名必须被抓住（否则门禁形同虚设）；
 *  2. **不误报**：每条 skip 规则都要有反例证明"该豁免的确实没报"——这类门禁一旦有误报
 *     就会被绕过，所以 skip 规则和检查规则同等重要（每条规则一个用例）。
 *
 * 外加：
 *  · 变异验证——同一 fixture 先破坏再修复，断言"红 → 绿"，证明断言不是永远绿的假测试；
 *  · 真实仓库自检——用**空的 home**（等价 CI 环境：没有 ~/Documents/skills）跑真实仓库，
 *    证明 EXTERNAL_SKILLS 白名单足以让本地与 CI 判定一致。
 *
 * fixture 用 mkdtemp 造独立小仓库：非 git 目录 → listFiles 走目录遍历分支（顺带覆盖回退路径）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { REPO_ROOT, anchorsOfContent, runCheck, skillFromPath, slugify } from '../check-links.mjs'

const tmpRoots = []
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})

/** fixture 基线：一个最小可用仓库（根 package.json + docs + 一个插件 + 一个 skill）。 */
const BASE = {
  'package.json': JSON.stringify({
    name: 'fixture',
    private: true,
    scripts: { 'test:scripts': 'vitest', verify: 'node scripts/verify.mjs' },
  }),
  'README.md': '# Fixture\n',
  'docs/guide.md': '# 指南\n\n## 需求回归（强制要求）\n\n## 安装\n',
  'docs/sub/page.md': '# 子页\n',
  'docs/assets/logo.png': 'binary',
  'scripts/ok.mjs': '// ok\n',
  'scripts/verify.mjs': '// verify\n',
  'plugins/dsh-my-notify/package.json': JSON.stringify({
    name: 'dsh-my-notify',
    scripts: { build: 'node scripts/build.mjs', test: 'vitest' },
  }),
  'plugins/dsh-my-notify/README.md': '# notify\n',
  'plugins/dsh-my-notify/scripts/build.mjs': '// build\n',
  'skills/plugin-upgrade/SKILL.md': '# upgrade\n',
  'skills/plugin-upgrade/references/card.md': '# card\n',
}

/** 造 fixture 仓库并返回根目录（extra 覆盖 BASE 同名文件）。 */
function makeRepo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-links-'))
  tmpRoots.push(root)
  for (const [rel, content] of Object.entries({ ...BASE, ...extra })) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

/** 跑校验（home 指向 fixture 内的空目录，避免依赖本机 ~/Documents/skills）。 */
function check(root) {
  return runCheck({ root, home: join(root, 'home') })
}

/** 命中的「类别:目标」清单，便于断言与可读的失败信息。 */
function hits(root) {
  return check(root).findings.map((f) => `${f.kind}:${f.target}`)
}

const GUIDE = (body) => `# 指南\n\n## 需求回归（强制要求）\n\n## 安装\n\n${body}\n`

// ── 1. 能力：失效引用必须被抓住 ─────────────────────────────────────────────

describe('失效引用能抓到', () => {
  it('相对链接指向不存在的文件 → link', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('[缺](./missing.md)') }))).toContain('link:./missing.md')
  })

  it('图片指向不存在的资源 → link', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('![图](./assets/missing.png)') }))).toContain(
      'link:./assets/missing.png',
    )
  })

  it('跨目录层级写错的链接 → link', () => {
    expect(hits(makeRepo({ 'docs/sub/page.md': '# 子页\n\n[g](../../docs/nowhere.md)\n' }))).toContain(
      'link:../../docs/nowhere.md',
    )
  })

  it('锚点在目标文件里不存在 → anchor', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('[x](./guide.md#不存在的标题)') }))).toContain(
      'anchor:./guide.md#不存在的标题',
    )
  })

  it('#anchor-only 指向本文档不存在的标题 → anchor', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('[x](#没有这个标题)') }))).toContain('anchor:#没有这个标题')
  })

  it('反引号路径 token 不存在 → path', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('见 `docs/missing.md` 说明。') }))).toContain('path:docs/missing.md')
  })

  it('代码块内的 node 调用脚本不存在 → shell', () => {
    const body = ['```bash', 'node scripts/missing.mjs --flag', '```'].join('\n')
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE(body) }))).toContain('shell:scripts/missing.mjs')
  })

  it('代码块内的 bash 调用脚本不存在 → shell', () => {
    const body = ['```bash', 'bash scripts/missing.sh', '```'].join('\n')
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE(body) }))).toContain('shell:scripts/missing.sh')
  })

  it('npm run 引用了根 package.json 不存在的 script → npm', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('运行 `npm run nonexistent`。') }))).toContain(
      'npm:npm run nonexistent',
    )
  })

  it('引用了不存在的 skill 名 → skill', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('用 `ghost-skill` skill 处理。') }))).toContain('skill:ghost-skill')
  })

  it('引用了不存在的插件名（dsh-my- 前缀写错）→ plugin', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('插件 `dsh-my-notfy` 提供该能力。') }))).toContain(
      'plugin:dsh-my-notfy',
    )
  })
})

// ── 2. 有效引用不能误报 ─────────────────────────────────────────────────────

describe('有效引用不误报', () => {
  it('相对文件目录解析：同目录 / 上级目录 / 目录链接 / 图片', () => {
    const root = makeRepo({
      'docs/guide.md': GUIDE('[a](./sub/page.md) [b](sub/) [c](./assets/logo.png)'),
      'docs/sub/page.md': '# 子页\n\n[回上级](../guide.md)\n',
    })
    expect(check(root).findings).toEqual([])
  })

  it('按仓库根解析：docs/guide.md 这种从根写起的链接也算有效', () => {
    expect(check(makeRepo({ 'docs/sub/page.md': '# 子页\n\n[g](docs/guide.md)\n' })).findings).toEqual([])
  })

  it('中文标题锚点：全角括号按 GitHub 规则剔除，正确锚点有效', () => {
    const root = makeRepo({
      'docs/guide.md': GUIDE('[x](#需求回归强制要求) [y](guide.md#安装) [z](./guide.md#需求回归强制要求)'),
    })
    expect(check(root).findings).toEqual([])
  })

  it('直接拿标题原文（含全角括号）当锚点 → 抓出来（上一轮审计修的正是这个坑）', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('[x](#需求回归（强制要求）)') })
    expect(hits(root)).toEqual(['anchor:#需求回归（强制要求）'])
  })

  it('重复标题的 -1 后缀锚点有效', () => {
    const body = '# 指南\n\n## 说明\n\n## 说明\n\n[x](#说明-1)\n'
    expect(check(makeRepo({ 'docs/guide.md': body })).findings).toEqual([])
  })

  it('反引号路径 token 与 node/bash 调用有效', () => {
    const body = [
      '见 `docs/guide.md` 与 `scripts/ok.mjs`。',
      '',
      '```bash',
      'node scripts/ok.mjs',
      'bash scripts/ok.mjs',
      '```',
    ].join('\n')
    expect(check(makeRepo({ 'docs/guide.md': GUIDE(body) })).findings).toEqual([])
  })

  it('根级 npm script 有效', () => {
    expect(
      check(makeRepo({ 'docs/guide.md': GUIDE('`npm run test:scripts` 与 `npm run verify`。') })).findings,
    ).toEqual([])
  })

  it('插件 README 的 npm run build 指插件自己的 package.json（不是根）', () => {
    const root = makeRepo({
      'plugins/dsh-my-notify/README.md': '# notify\n\n```bash\nnpm run build\nnpm test\n```\n',
    })
    expect(check(root).findings).toEqual([])
  })

  it('代码块内 cd 到插件目录后 npm run 按该目录解析', () => {
    const body = ['```bash', 'cd plugins/dsh-my-notify', 'npm run build', '```'].join('\n')
    expect(check(makeRepo({ 'docs/guide.md': GUIDE(body) })).findings).toEqual([])
  })

  it('仓库内 skill 名与已登记的外部 skill 名有效', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('用 `plugin-upgrade` skill 与 `quality-gates` skill。') })
    expect(check(root).findings).toEqual([])
  })

  it('仓库内插件名有效（含 node_modules 命中路径）', () => {
    expect(check(makeRepo({ 'docs/guide.md': GUIDE('插件 `dsh-my-notify`。') })).findings).toEqual([])
  })

  it('本仓库新增的 md 文件自身不产生噪音', () => {
    expect(check(makeRepo()).findings).toEqual([])
  })
})

// ── 3. skip 规则：每条豁免都要有反例 ────────────────────────────────────────

describe('skip 规则不误报', () => {
  const noFindings = (extra) => expect(check(makeRepo(extra)).findings).toEqual([])

  it('外部 URL / mailto / data: 不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE(
        '[a](https://example.com/missing.md) [b](http://x.invalid/a#b) [c](mailto:a@b.c) [d](data:text/plain,x)',
      ),
    })
  })

  it('~ 家目录路径不校验（环境相关）', () => {
    noFindings({ 'docs/guide.md': GUIDE('见 [x](~/nowhere/x.md) 与 `~/.dsh/profiles/web/cordis.patch.yml`。') })
  })

  it('工作区外绝对路径不校验', () => {
    noFindings({ 'docs/guide.md': GUIDE('见 [x](/Users/nobody/nowhere.md) 与 `/opt/data/x.json`。') })
  })

  it('glob 模式不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE('匹配 [x](docs/*.md)、`docs/**/*.md`、`scripts/*.mjs`、`.github/workflows/*.yml`。'),
    })
  })

  it('占位符与省略号不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE(
        '占位：`docs/<name>/README.md`、`skills/...`、`plugins/xxx/package.json`、`docs/NNN.md`，语法示例 `![alt](url)`。',
      ),
    })
  })

  it('fenced code block 内的 markdown 链接是示例文本，不校验', () => {
    const body = ['```md', '[示例](./whatever-missing.md)', '```'].join('\n')
    noFindings({ 'docs/guide.md': GUIDE(body) })
  })

  it('fenced code block 内的 dsh-* / skill 名不校验（示例命令）', () => {
    const body = ['```bash', 'dsh plugin add dsh-my-nonexistent', 'run `ghost-skill` skill', '```'].join('\n')
    noFindings({ 'docs/guide.md': GUIDE(body) })
  })

  it('CHANGELOG 里的失效引用是历史留痕，不校验', () => {
    noFindings({
      'plugins/dsh-my-notify/CHANGELOG.md': '# 变更\n\n- 见 [旧文档](../../docs/deleted.md) 与 `dsh-my-old-name`\n',
    })
  })

  it('docs/adr 里的失效引用是历史留痕，不校验', () => {
    noFindings({
      'docs/adr/0001-rename.md': '# 改名\n\n原 `plugins/dsh-my-old/README.md`，见 [旧](../../docs/gone.md)。\n',
    })
  })

  it('「有意裁剪」标注 ±3 行内的引用不校验（上游未随本副本分发）', () => {
    const body = [
      '详见 `host-plane-probes.md`（upstream reference, not shipped in this trimmed copy）。',
      '',
      '',
      '另有 `scripts/ghost-host-check.mjs` 可用。',
    ].join('\n')
    noFindings({ 'skills/plugin-upgrade/references/card.md': `# card\n\n${body}\n` })
  })

  it('宿主内部包名（不像本仓库插件的 dsh-*）不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE('依赖 `dsh-llm`、`dsh-session`、`dsh-client-runtime`、`dsh-better-sidebar`。'),
    })
  })

  it('HTTP 路由路径（/plugins/<name>/client.js）不校验', () => {
    noFindings({ 'docs/guide.md': GUIDE('浏览器请求 `/plugins/dsh-my-notify/client.js` 与 `/notify/api/config`。') })
  })

  it('宿主仓库布局行（packages/ apps/ bundle/）里的路径不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE(
        'Targets: `packages/settings/**`, `docs/config-catalog.md`, `.github/workflows/release.yml`。',
      ),
    })
  })

  it('同行有外部仓库链接时，第三方仓库的 scripts/ 引用不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE(
        '本地实现见 [dsh-TUI #622](https://github.com/ccch1mneyyy/dsh-TUI/pull/622)，由 `scripts/verify-tps.mjs` 回归。',
      ),
    })
  })

  it('宿主 API 名（skill.list）同行的 skills/ 路径不校验', () => {
    noFindings({ 'docs/guide.md': GUIDE('| `skill.list` | `skills/list` | 列表不激活冷 Agent |') })
  })

  it('升级审计语料引用的上游 DSH 文档不校验', () => {
    noFindings({
      'skills/dsh-upgrade-audit/references/playbook.md':
        '# 审计\n\n~19 plugins, see `docs/config-catalog.md` `Requires:`。\n',
    })
  })

  it('省略宿主目录的约定路径（任意插件/skill 内存在）不校验', () => {
    noFindings({
      'docs/guide.md': GUIDE('插件契约见 `scripts/build.mjs` 与 `plugins/dsh-my-notify/scripts/build.mjs`。'),
    })
  })

  it('插件级通用 npm script 不校验（文档在讲插件目录内的操作）', () => {
    noFindings({ 'docs/guide.md': GUIDE('每个插件目录里执行 `npm run build` 后再提交。') })
  })

  it('CSS 类名 / DOM id（现存插件名的扩展）不当插件名校验', () => {
    noFindings({ 'docs/guide.md': GUIDE('根容器类名 `dsh-my-notify-toast-box`、`dsh-my-notify-root`。') })
  })

  it('skill 目录泛指（未指名具体 skill）不校验', () => {
    noFindings({ 'docs/guide.md': GUIDE('把 skill 放到 `~/.dsh/skills/` 或 `.reasonix/skills/` 下。') })
  })

  it('被有意裁剪的引用在目标文件不存在时也不报（同文件其它段落失效则照报）', () => {
    const root = makeRepo({
      'skills/plugin-upgrade/references/card.md':
        '# card\n\n见 `scripts/upstream-helper.mjs`（not shipped in this trimmed copy）。\n\n## 另一段\n\n正文。\n\n另见 `scripts/really-missing.mjs`。\n',
    })
    expect(hits(root)).toEqual(['path:scripts/really-missing.mjs'])
  })

  it('超大文件整体跳过（构建/压缩产物，防 markdown 正则退化成 O(n²) 挂死）', () => {
    // 实测：单行 8.9MB 的 mermaid.min.js 会让 ](...) 链接正则永不收敛，门禁必须跳过这类输入
    const root = makeRepo({ 'docs/huge.js': `// ${'x'.repeat(1_200_000)}\n` })
    const started = Date.now()
    expect(check(root).findings).toEqual([])
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('shell 调用后面紧跟中文说明/标点：收缩到路径前缀后仍算命中（真实踩过的误报）', () => {
    expect(
      check(makeRepo({ 'docs/guide.md': GUIDE('运行 `node scripts/ok.mjs，等价于 npm run verify`。') })).findings,
    ).toEqual([])
  })

  it('shell 调用里的 glob 不校验', () => {
    expect(check(makeRepo({ 'docs/guide.md': GUIDE('`node scripts/*.mjs` 会全部执行。') })).findings).toEqual([])
  })

  it('仓库外 skill 的 SKILL.md 与已登记的内部脚本都不误报（CI 无全局 skill 目录）', () => {
    const body = 'skill `github-ops`：`~/Documents/skills/github-ops/SKILL.md`（命令表）、`scripts/ghops.py`。'
    expect(check(makeRepo({ 'docs/guide.md': GUIDE(body) })).findings).toEqual([])
  })

  it('超长单行不做 markdown 解析（同上的行级保护）', () => {
    const longLine = `[缺](./missing.md) ${'x'.repeat(100_001)}`
    expect(check(makeRepo({ 'docs/guide.md': `# 指南\n\n${longLine}\n` })).findings).toEqual([])
  })
})

// ── 3a. 大小写敏感（CI run #15 实测教训）───────────────────────────────────
//
// macOS 文件系统不区分大小写：`existsSync('DOCS/x.md')` 在本地为真、在 Linux CI 为假。
// 门禁若直接用 existsSync，就会"本地永远测不出大小写写错、第一次上 CI 才红"——
// 实测那次同时打红了 12/13 门禁与 7/13 的真实仓库自检测试（同一个根因）。

describe('大小写敏感（对齐 Linux CI 语义）', () => {
  it('链接路径大小写写错必须报（本地 macOS 上也不放过）', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('[a](DOCS/guide.md) [b](./Docs/guide.md)') })
    expect(hits(root)).toEqual(['link:DOCS/guide.md', 'link:./Docs/guide.md'])
  })

  it('反引号路径 token 与 shell 调用的文件名同样精确比对', () => {
    const body = ['见 `docs/GUIDE.md`。', '', '```bash', 'node scripts/OK.mjs', '```'].join('\n')
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE(body) })).sort()).toEqual([
      'path:docs/GUIDE.md',
      'shell:scripts/OK.mjs',
    ])
  })

  it('锚点链接的目标文件大小写错误 → 报 link（不应静默当成另一个文件）', () => {
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE('[x](Guide.md#安装)') }))).toEqual(['link:Guide.md#安装'])
  })

  it('大小写完全一致时照常通过（修复没把正常路径判红）', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('[a](guide.md) [b](docs/guide.md) `docs/guide.md`') })
    expect(check(root).findings).toEqual([])
  })
})

// ── 3b. 对抗验证（红队）发现的缺陷回归 D1–D9 ───────────────────────────────
//
// 这些用例全部来自一次独立的对抗验证：前 5 条是**修复后**必须保持的行为，
// 没有它们这几个缺陷会悄悄复发（尤其 D1，它曾把 36 处引用整块关掉）。

describe('对抗验证缺陷回归（D1–D9）', () => {
  it('D1：仓库内 skill 的子路径失效必须报 path（不能被"skill 名有效"整体豁免）', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('见 `skills/plugin-upgrade/references/gone.md`。') })
    expect(hits(root)).toEqual(['path:skills/plugin-upgrade/references/gone.md'])
  })

  it('D1：同类失效写成 markdown 链接与 shell 调用也必须报', () => {
    const root = makeRepo({
      'docs/guide.md': GUIDE('[x](skills/plugin-upgrade/references/gone.md)'),
      'docs/shell.md': '# 指南\n\n```bash\nnode skills/plugin-upgrade/scripts/gone.mjs\n```\n',
    })
    expect(hits(root)).toEqual([
      'link:skills/plugin-upgrade/references/gone.md',
      'shell:skills/plugin-upgrade/scripts/gone.mjs',
    ])
  })

  it('D2：GitHub 保留下划线——## foo_bar 的锚点 #foo_bar 必须有效', () => {
    const root = makeRepo({ 'docs/guide.md': '# 指南\n\n## foo_bar\n\n[本节](#foo_bar) [跨文件](guide.md#foo_bar)\n' })
    expect(check(root).findings).toEqual([])
  })

  it('D2：下划线剥离版（旧行为）仍是已知宽松面，但不得反过来把正确锚点判红', () => {
    const root = makeRepo({ 'docs/guide.md': '# 指南\n\n## foo_bar\n\n[x](#foobar)\n' })
    expect(check(root).findings).toEqual([])
  })

  it('D9：HTML 命名锚点原样大小写有效（#UserGuide 与小写都必须能命中）', () => {
    const root = makeRepo({
      'docs/guide.md': '# 指南\n\n<a name="UserGuide"></a>\n\n[原样](#UserGuide) [小写](#userguide)\n',
    })
    expect(check(root).findings).toEqual([])
  })

  it('D5：占位名不当引用（dsh-my-xxx / my-xxx skill / ~/.dsh/skills/my-xxx）', () => {
    const body = '新插件包名形如 `dsh-my-xxx`；新建 `my-xxx` skill 时放到 `~/.dsh/skills/my-xxx` 下。'
    expect(check(makeRepo({ 'docs/guide.md': GUIDE(body) })).findings).toEqual([])
  })

  it('D6：中文脚本名的失效 shell 调用必须报（收缩不能把目录当命中）', () => {
    const body = ['```bash', 'node scripts/中文脚本.mjs', '```'].join('\n')
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE(body) }))).toEqual(['shell:scripts/中文脚本.mjs'])
  })

  it('D6 根因：home 下恰好存在同名目录也不能假命中（相对路径不去 home 解析）', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE(['```bash', 'node scripts/中文脚本.mjs', '```'].join('\n')) })
    // 本机 ~/scripts 真实存在，曾让 scripts/<中文> 被 home 兜底误判为命中——fixture 复刻这个环境
    mkdirSync(join(root, 'home', 'scripts'), { recursive: true })
    mkdirSync(join(root, 'home', 'docs'), { recursive: true })
    expect(hits(root)).toEqual(['shell:scripts/中文脚本.mjs'])
  })

  it('D7：shell 调用的 ../ 前缀要认（`node ../scripts/x.mjs` 从子目录指向仓库根）', () => {
    const body = ['```bash', 'node ../scripts/ok.mjs', '```'].join('\n')
    expect(check(makeRepo({ 'docs/guide.md': GUIDE(body) })).findings).toEqual([])
    const bad = ['```bash', 'node ../scripts/gone.mjs', '```'].join('\n')
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE(bad) }))).toEqual(['shell:../scripts/gone.mjs'])
  })

  it('D4：反斜杠转义的方括号是字面量示例，不算链接', () => {
    expect(check(makeRepo({ 'docs/guide.md': GUIDE('写法示例：\\[缺\\](./missing.md)') })).findings).toEqual([])
  })

  it('D3：嵌套栅栏——外层 ````markdown 不会被内层 ```mermaid 关闭（块内示例保持豁免）', () => {
    const body = ['````markdown', '```mermaid', 'graph TD', '  E[文档](./docs/不存在.md)', '```', '````'].join('\n')
    expect(check(makeRepo({ 'docs/guide.md': GUIDE(body) })).findings).toEqual([])
  })

  it('D3：未闭合栅栏显式报 fence（其后检查被关闭，不能再静默）', () => {
    const root = makeRepo({ 'docs/guide.md': '# 指南\n\n```bash\nnode scripts/ok.mjs\n' })
    expect(check(root).findings.map((f) => f.kind)).toEqual(['fence'])
  })

  it('D4：行内代码里的链接示例不算引用（同一行的真实失效链接照报）', () => {
    const body = '行内示例 `[标题](./目标.md)` 与 `![alt](url)`。\n\n对照真实失效：[缺](./真的不存在.md)'
    expect(hits(makeRepo({ 'docs/guide.md': GUIDE(body) }))).toEqual(['link:./真的不存在.md'])
  })

  it('D6 反向：命令后跟中文说明的收缩豁免仍然有效（修复没把这条一起干掉）', () => {
    expect(
      check(makeRepo({ 'docs/guide.md': GUIDE('运行 `node scripts/ok.mjs，等价于 npm run verify`。') })).findings,
    ).toEqual([])
  })
})

// ── 4. 变异验证：证明断言不是永远绿的 ───────────────────────────────────────

describe('变异验证（破坏 → 红；修复 → 绿）', () => {
  it('链接：破坏后命中，修复后通过', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('[目标](./target.md)'), 'docs/target.md': '# 目标\n' })
    expect(check(root).findings).toEqual([])

    writeFileSync(join(root, 'docs/guide.md'), GUIDE('[目标](./missing.md)'))
    expect(hits(root)).toEqual(['link:./missing.md'])

    writeFileSync(join(root, 'docs/guide.md'), GUIDE('[目标](./target.md)'))
    expect(check(root).findings).toEqual([])
  })

  it('锚点：标题改名后锚点失配，同步改锚点后通过', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('[x](#安装)'), 'docs/target.md': '# 目标\n\n## 安装\n' })
    expect(check(root).findings).toEqual([])

    writeFileSync(join(root, 'docs/target.md'), '# 目标\n\n## 安装步骤\n')
    writeFileSync(join(root, 'docs/guide.md'), GUIDE('[x](target.md#安装)'))
    expect(hits(root)).toEqual(['anchor:target.md#安装'])

    writeFileSync(join(root, 'docs/guide.md'), GUIDE('[x](target.md#安装步骤)'))
    expect(check(root).findings).toEqual([])
  })

  it('退出码语义：有 finding 时 main 返回 1（runCheck 的 findings 非空即红）', () => {
    const root = makeRepo({ 'docs/guide.md': GUIDE('`docs/missing.md`') })
    expect(check(root).findings.length).toBeGreaterThan(0)
  })
})

// ── 5. 纯函数 ───────────────────────────────────────────────────────────────

describe('slug 与锚点纯函数', () => {
  it('slugify：全角括号等符号剔除、空格转连字符、大小写归一', () => {
    expect(slugify('需求回归（强制要求）')).toBe('需求回归强制要求')
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('`code` and **bold**')).toBe('code-and-bold')
    expect(slugify('A（B）C')).toBe('abc')
  })

  it('slugify 非折叠模式：多个空格保留多个连字符', () => {
    expect(slugify('a  b', false)).toBe('a--b')
    expect(slugify('a  b', true)).toBe('a-b')
  })

  it('anchorsOfContent：ATX / setext / HTML 锚点 / {#custom} / 重复标题', () => {
    const content = [
      '# 标题',
      '',
      'Setext 标题',
      '---',
      '',
      '<a name="html-anchor"></a>',
      '',
      '## 自定义 {#custom-id}',
      '',
      '## 重复',
      '',
      '## 重复',
    ].join('\n')
    const anchors = anchorsOfContent(content)
    expect(anchors.has('标题')).toBe(true)
    expect(anchors.has('setext-标题')).toBe(true)
    expect(anchors.has('html-anchor')).toBe(true)
    expect(anchors.has('custom-id')).toBe(true)
    expect(anchors.has('重复')).toBe(true)
    expect(anchors.has('重复-1')).toBe(true)
  })

  it('anchorsOfContent 忽略代码块里的 # 注释', () => {
    const anchors = anchorsOfContent(['# 真标题', '', '```bash', '# 不是标题', '```'].join('\n'))
    expect(anchors.has('真标题')).toBe(true)
    expect(anchors.has('不是标题')).toBe(false)
  })

  it('skillFromPath：仓库内 / .reasonix / 全局 / 上级相对路径都能提取 skill 名', () => {
    expect(skillFromPath('skills/plugin-upgrade/SKILL.md')).toBe('plugin-upgrade')
    expect(skillFromPath('.reasonix/skills/quality-gates/SKILL.md')).toBe('quality-gates')
    expect(skillFromPath('../../.reasonix/skills/testing-standards/SKILL.md')).toBe('testing-standards')
    expect(skillFromPath('~/Documents/skills/npm-ops/scripts/x.py')).toBe('npm-ops')
    expect(skillFromPath('docs/guide.md')).toBe(null)
  })
})

// ── 6. 真实仓库自检（空 home = CI 等价环境）────────────────────────────────

describe('真实仓库自检', () => {
  it('当前仓库在「无全局 skill」环境下也无失效引用（白名单足以让本地/CI 一致）', () => {
    const result = runCheck({ root: REPO_ROOT, home: join(tmpdir(), 'check-links-no-such-home') })
    expect(result.findings).toEqual([])
  })
})
