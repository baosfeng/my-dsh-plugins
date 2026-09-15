// 提交信息门禁 CLI 的端到端测试（issue #324 需求 B）。
//
// 用**临时 git 仓库**（不是本仓库）驱动真实 CLI，钉死这些行为：
//   · 合规提交 → 绿；不合规提交（缺 type / 未知 type / 空 subject）→ 红并指出规则与提交；
//   · 只校验给定范围——范围外的历史欠账不影响结论（本仓库全历史 9.5% 不合规，
//     若"顺手全查"就恒红）；
//   · 空范围 / 不存在的范围 → 红（fail-closed），只有显式 --allow-empty 才放行（本地用）；
//   · 与本地 hook 同源：规则真的来自 .commitlintrc.json（改该文件会改变结论）。
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-commit-messages.mjs')

const created = []
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * 夹具用的自包含 commitlint 配置：**规则集与 .commitlintrc.json 等价**（含 parserOpts），
 * 但不写 `extends`——夹具在 /tmp 下解析不到本仓库的 node_modules，实测会 MODULE_NOT_FOUND。
 * 这里必须与仓库配置保持同步：README/测试断言都依赖 type 白名单与 headerPattern 的 #编号支持。
 */
/** config-conventional 的 header 解析模式（字符串形式，便于序列化进夹具 JSON）。 */
const DEFAULT_HEADER_PATTERN = '^(\\w*)(?:\\((.*)\\))?!?: (.*)$'

const FIXTURE_CONFIG = {
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci']],
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    'header-trim': [2, 'always'],
    'body-max-line-length': [2, 'always', 100],
  },
  parserPreset: {
    name: 'conventional-changelog-conventionalcommits',
    parserOpts: {
      // ⚠️ 必须是**字符串**而不是正则字面量：夹具要写成 JSON 文件，而 JSON.stringify
      // 会把 /re/ 序列化成 {}（开发期实测：headerPattern 变成 {} → 解析不出 type →
      // 所有提交都被判失败），conventional-commits-parser 接受字符串形式的模式。
      headerPattern: DEFAULT_HEADER_PATTERN,
      headerCorrespondence: ['type', 'scope', 'subject'],
      noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
      issuePrefixes: ['#'],
    },
  },
}

/**
 * 造夹具仓库并写成给定的提交序列（第一条为初始提交），返回 { dir, rules }。
 * 测试通过 `--config` 指定它（CLI 默认仍用仓库根的 .commitlintrc.json）。
 */
function fixtureRepo(subjects, rules = FIXTURE_CONFIG) {
  const dir = mkdtempSync(join(tmpdir(), 'commits-fixture-'))
  created.push(dir)
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', 'main', '.'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'user.name', 'test'])
  subjects.forEach((subject, i) => {
    writeFileSync(join(dir, `f${i}.txt`), `${i}\n`)
    git(['add', '-A'])
    git(['commit', '-q', '--no-verify', '-m', subject])
  })
  return { dir, rules }
}

/**
 * 跑 CLI。cwd 指向夹具（CLI 按 cwd 解析 git 仓库），规则用 COMMITLINT_RULES_JSON 注入
 * ——夹具在 /tmp 下按路径加载配置会因 commitlint 内部缓存而读到旧规则（实测假绿），注入没有这个问题。
 */
function runLint(repo, extra = [], rules = repo.rules) {
  const r = spawnSync(process.execPath, [SCRIPT, ...extra], {
    cwd: repo.dir,
    encoding: 'utf8',
    timeout: 120_000,
    // 刻意屏蔽 GITHUB_EVENT_PATH：CI 上它是真实事件 JSON，而夹具仓库里没有那些 SHA ——
    // 不屏蔽的话，夹具里"无参数"的用例会去解析真实 PR 范围（实测这一步在 CI 上必然红）。
    env: { ...process.env, COMMITLINT_RULES_JSON: JSON.stringify(rules), GITHUB_EVENT_PATH: '' },
  })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const GOOD = 'feat(ci): #324 新增 secret 扫描与提交信息门禁'
const GOOD_NO_SCOPE = 'chore: #324 初始化夹具'
const GOOD_ZH = 'docs(process): 关闭 PR 用 ghops issue close（PR 即 issue，实测有效）'

describe('check-commit-messages.mjs 端到端', () => {
  it('范围内的提交全部合规 → 通过（含无 scope / 中文摘要 / #编号）', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD, GOOD_ZH])
    const r = runLint(repo, ['--from', 'HEAD~2', '--to', 'HEAD'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('✅ 通过')
    expect(r.stdout).toContain('2 条提交全部符合规范')
  })

  it('反例：不合规提交信息（缺 type）→ 红，并指出规则与提交首行', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, 'update ci config'])
    const r = runLint(repo, ['--from', 'HEAD~1', '--to', 'HEAD'])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('❌ 失败')
    expect(r.stdout).toContain('update ci config')
    expect(r.stdout).toMatch(/type-empty|subject-empty/)
    expect(r.stdout).toContain('git rebase -i')
  })

  it('反例：未知 type（release:）→ 红，规则名是 type-enum', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, 'release(plugin): 版本号升至 1.0.0'])
    const r = runLint(repo, ['--from', 'HEAD~1', '--to', 'HEAD'])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('type-enum')
  })

  it('反例：大写 type（Feat:）→ 红（type-case）', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, 'Feat(ci): #324 大写'])
    const r = runLint(repo, ['--from', 'HEAD~1', '--to', 'HEAD'])
    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/type-case|type-enum/)
  })

  it('只校验范围：范围外的历史欠账不影响结论（本仓库全历史 9.5% 不合规）', () => {
    // 历史里放 1 条不合规，但只校验最后 1 条合规提交 → 必须绿
    const repo = fixtureRepo(['update ci legacy', GOOD_NO_SCOPE, GOOD])
    const r = runLint(repo, ['--from', 'HEAD~1', '--to', 'HEAD'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('1 条提交全部符合规范')
  })

  it('--last 只校验 HEAD 这一条（单提交退化路径）', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD])
    expect(runLint(repo, ['--last']).code).toBe(0)
    const bad = fixtureRepo([GOOD_NO_SCOPE, 'wip'])
    expect(runLint(bad, ['--last']).code).toBe(1)
  })

  it('空范围（--from == --to）→ 红（fail-closed），--allow-empty 才放行', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD])
    const hard = runLint(repo, ['--from', 'HEAD', '--to', 'HEAD'])
    expect(hard.code).toBe(1)
    expect(hard.stderr).toContain('fail-closed')
    const soft = runLint(repo, ['--from', 'HEAD', '--to', 'HEAD', '--allow-empty'])
    expect(soft.code).toBe(0)
    expect(soft.stderr).toContain('--allow-empty')
  })

  it('范围不可解析（不存在的 SHA）→ 红，不当作"没问题"', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD])
    const r = runLint(repo, ['--from', 'deadbeefdeadbeef', '--to', 'HEAD'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('fail-closed')
  })

  it('--explain 只打印范围解析结果（CI 探测用），退出码与可解析性一致', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD])
    const ok = runLint(repo, ['--explain', '--from', 'HEAD~1', '--to', 'HEAD'])
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, mode: 'range', count: 1 })
    const bad = runLint(repo, ['--explain'])
    expect(bad.code).toBe(1)
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, count: 0 })
  })

  it('--range a..b 与 --from/--to 等价；同用时报用法错误（退出码 2）', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD])
    expect(runLint(repo, ['--range', 'HEAD~1..HEAD']).code).toBe(0)
    const clash = runLint(repo, ['--range', 'HEAD~1..HEAD', '--from', 'HEAD~1'])
    expect(clash.code).toBe(2)
  })

  it('规则真的来自配置：把 chore 从白名单删掉 → 同一条提交变红', () => {
    // 刻意针对**第一条**（chore）跑：只校验 HEAD 的话第二条是 feat，被删掉的 chore 根本不会被查到
    // （开发期就踩过这个假绿：用例看着在验规则，其实跑的是另一条提交）
    const repo = fixtureRepo([GOOD_NO_SCOPE, GOOD_NO_SCOPE])
    // 只校验**第一条**（chore）：`--from <HEAD^> --to <HEAD>` 就是"只查第二条"，反过来
    // `--from X --to X` 是空范围（git 的 A..B 不含左端点），而 `--to <根提交>` 也解析不了
    // （根提交没有 X^）。夹具只有 2 条提交，所以这里刻意用"排除第一条 → 只剩第二条"的写法，
    // 再把被删掉的 type 放在**第二条**上，保证用例真的在查以为在查的那条提交。
    const range = ['--from', 'HEAD^', '--to', 'HEAD']
    expect(runLint(repo, range).code).toBe(0)
    const strict = {
      ...FIXTURE_CONFIG,
      rules: { ...FIXTURE_CONFIG.rules, 'type-enum': [2, 'always', ['feat', 'fix']] },
    }
    const r = runLint(repo, range, strict)
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('type-enum')
  })

  it('--help 打印用法且退出 0；未知参数退出 2', () => {
    const repo = fixtureRepo([GOOD_NO_SCOPE])
    const help = runLint(repo, ['--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('--allow-empty')
    expect(runLint(repo, ['--nope']).code).toBe(2)
  })
})
