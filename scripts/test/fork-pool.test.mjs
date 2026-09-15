/**
 * fork 池回归测试（scripts/fork-pool.mjs + scripts/lib/fork-pool.mjs，issue #240）。
 *
 * 覆盖三层：
 *  1. **纯函数契约**——参数解析、路径/分支推导、owner/repo 解析、基线判定、清理护栏。
 *     清理护栏是重点：clean 会执行 rm -rf，判据一旦写松，一个打错的路径就能删掉主工作区。
 *  2. **流程完整性**——planCreateSteps 必须包含基线校验与 hooks 安装两步。
 *     这两步正是 issue #240 的核心：缺 hooks → fork 内提交/推送完全不跑本地门禁
 *     （PR #239 的 prettier 红盘根因）；缺基线校验 → fork 拿过期基线起分支。
 *  3. **CLI 端到端（离线可跑）**——list / clean 的安全护栏与幂等 / 参数错误退出码，
 *     全部在临时目录里构造，不依赖 GitHub 网络（CI 里也必须能跑）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirSync } from 'tmp'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  branchNameFor,
  buildCheckItems,
  evaluateBaseline,
  evaluateWorkspaceLinks,
  excludeAppendContent,
  planWorkspaceLinks,
  fetchRemoteFor,
  forkDirFor,
  formatMs,
  isSafeToClean,
  isValidForkId,
  normalizePath,
  parseForkPoolArgs,
  parseOwnerRepo,
  isLocalRemote,
  planCreateSteps,
  pushRemoteFor,
  renderCheckReport,
  resolveTargetDir,
} from '../lib/fork-pool.mjs'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'fork-pool.mjs')

/** 在临时目录里跑一次 CLI，返回 { code, out }。 */
function runCli(args, { tmpRoot } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(tmpRoot ? { FORK_POOL_TMP: tmpRoot } : {}) },
    timeout: 60_000,
  })
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/**
 * 建一个真正的迷你 git 仓库模拟 fork 目标。
 * 为什么不用假目录：`git -C <dir> config` 对"只有 .git 目录、没有对象库"的目录会直接失败，
 * 断言就退化成"永远走失败分支"，测不出真实行为（第一版就是这么写的，被这条测试抓出来了）。
 */
function makeFakeFork(tmpRoot, id, { hooksPath = null } = {}) {
  const dir = join(tmpRoot, `gh-fork-${id}`)
  mkdirSync(dir, { recursive: true })
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { encoding: 'utf8' })
  if (hooksPath) spawnSync('git', ['-C', dir, 'config', 'core.hooksPath', hooksPath], { encoding: 'utf8' })
  return dir
}

/**
 * 造一个可被 `git clone --local` 的"origin"仓（`create` 端到端用例用）。
 * 为什么不用 makeFakeFork：它没有 commit，clone 出来拿不到 `origin/main`，基线校验必然失败。
 */
function makeOriginRepo(tmpRoot, id = 'origin') {
  const dir = join(tmpRoot, id)
  mkdirSync(dir, { recursive: true })
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { encoding: 'utf8' })
  writeFileSync(join(dir, 'README.md'), '# origin\n')
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' })
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], {
    encoding: 'utf8',
  })
  // issue #346：origin 必须是**本地**远端。原先写死 `https://github.com/o/r.git`，
  // 于是 create 流程里的 `git ls-remote` 会去连 github.com —— 本机网络不可达时该用例必红，
  // 而它测的是 exclude 写入/软链拒绝，跟网络毫无关系。
  spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', dir], { encoding: 'utf8' })
  spawnSync('git', ['-C', dir, 'fetch', '-q', 'origin', 'main'], { encoding: 'utf8' })
  return dir
}

describe('excludeAppendContent（.git/info/exclude 幂等追加，CodeQL #18）', () => {
  it('已含 node_modules 行 → null（不重复写、不破坏原文件）', () => {
    expect(excludeAppendContent('node_modules\n')).toBeNull()
    expect(excludeAppendContent('# 注释\nnode_modules\n')).toBeNull()
    expect(excludeAppendContent('node_modules')).toBeNull()
  })

  it('缺 node_modules → 保留原内容并补一行（无尾随换行的文件也补齐）', () => {
    expect(excludeAppendContent('')).toBe('\nnode_modules\n')
    expect(excludeAppendContent('# 注释\n')).toBe('# 注释\nnode_modules\n')
    expect(excludeAppendContent('# 注释')).toBe('# 注释\nnode_modules\n')
  })

  it('子串不算命中（node_modules_backup 仍要补 node_modules）', () => {
    expect(excludeAppendContent('node_modules_backup\n')).toBe('node_modules_backup\nnode_modules\n')
  })
})

describe('参数解析', () => {
  it('create 解析编号、分支、基线、hooks 与 node_modules 策略', () => {
    const o = parseForkPoolArgs([
      'create',
      '240',
      '--branch',
      'perf/240',
      '--base',
      'dev',
      '--no-hooks',
      '--node-modules',
      'copy',
    ])
    expect(o.command).toBe('create')
    expect(o.id).toBe('240')
    expect(o.branch).toBe('perf/240')
    expect(o.baseRef).toBe('origin/dev')
    expect(o.hooks).toBe(false)
    expect(o.nodeModules).toBe('copy')
    expect(o.errors).toEqual([])
  })

  it('缺编号 / 未知命令 / 非法 node-modules 都进 errors（不静默吞掉）', () => {
    expect(parseForkPoolArgs(['create']).errors.join()).toContain('缺少 fork 编号')
    expect(parseForkPoolArgs(['destroy', '1']).errors.join()).toContain('未知命令')
    expect(parseForkPoolArgs(['create', '1', '--node-modules', 'magic']).errors.join()).toContain('--node-modules')
  })

  it('clean 默认不带 --yes（写操作默认拒绝）', () => {
    expect(parseForkPoolArgs(['clean', '240']).yes).toBe(false)
    expect(parseForkPoolArgs(['clean', '240', '--yes']).yes).toBe(true)
    expect(parseForkPoolArgs(['clean', '240', '-y']).yes).toBe(true)
  })
})

describe('路径与分支推导', () => {
  it('fork 目录固定为 <tmp>/gh-fork-<编号>，非法编号抛错', () => {
    expect(forkDirFor('240')).toBe('/tmp/gh-fork-240')
    expect(forkDirFor('240b', '/var/tmp')).toBe('/var/tmp/gh-fork-240b')
    expect(() => forkDirFor('../etc')).toThrow()
    expect(() => forkDirFor('a/b')).toThrow()
    expect(isValidForkId('240')).toBe(true)
    expect(isValidForkId('')).toBe(false)
  })

  it('分支默认 fix/<编号>，可覆盖，非法覆盖抛错', () => {
    expect(branchNameFor('240')).toBe('fix/240')
    expect(branchNameFor('240', 'perf/240-dx')).toBe('perf/240-dx')
    expect(() => branchNameFor('240', 'a..b')).toThrow()
  })

  it('resolveTargetDir 同时接受编号、绝对路径与"当前目录"', () => {
    expect(resolveTargetDir('240')).toBe('/tmp/gh-fork-240')
    expect(resolveTargetDir('/tmp/gh-fork-240')).toBe('/tmp/gh-fork-240')
    expect(resolveTargetDir('240', '/tmp', '/x/gh-fork-9')).toBe('/x/gh-fork-9')
    // 在 fork 里直接跑 `fork-pool check`（或 check .）是最顺手的用法，必须落到 cwd
    expect(resolveTargetDir('.', '/tmp', null, '/tmp/gh-fork-240')).toBe('/tmp/gh-fork-240')
    expect(resolveTargetDir(undefined, '/tmp', null, '/tmp/gh-fork-240')).toBe('/tmp/gh-fork-240')
    expect(resolveTargetDir('./plugins', '/tmp', null, '/tmp/gh-fork-240')).toBe('/tmp/gh-fork-240/plugins')
  })

  it('check 可省略目标（默认当前目录），clean 必须显式给目标', () => {
    expect(parseForkPoolArgs(['check']).errors).toEqual([])
    expect(parseForkPoolArgs(['clean']).errors.join()).toContain('clean：缺少')
  })

  it('normalizePath 吃掉 . 与 ..，避免护栏被路径穿越绕过', () => {
    expect(normalizePath('/tmp//gh-fork-1/')).toBe('/tmp/gh-fork-1')
    expect(normalizePath('/tmp/gh-fork-1/../../etc')).toBe('/etc')
  })
})

describe('owner/repo 与远端分流', () => {
  it('https 与 SSH 两种写法都能解析（仓库 fetch 走 https、push 走 SSH）', () => {
    expect(parseOwnerRepo('https://github.com/baosfeng/my-dsh-plugins.git')).toEqual({
      owner: 'baosfeng',
      repo: 'my-dsh-plugins',
    })
    expect(parseOwnerRepo('git@github.com:baosfeng/my-dsh-plugins.git')).toEqual({
      owner: 'baosfeng',
      repo: 'my-dsh-plugins',
    })
    expect(parseOwnerRepo('https://github.com/a/b')).toEqual({ owner: 'a', repo: 'b' })
    expect(parseOwnerRepo('')).toBeNull()
    expect(parseOwnerRepo('not-a-remote')).toBeNull()
  })

  it('fetch 用 https+代理、push 用 SSH（代理挂掉也能推）', () => {
    expect(fetchRemoteFor('o', 'r')).toBe('https://github.com/o/r.git')
    expect(pushRemoteFor('o', 'r')).toBe('git@github.com:o/r.git')
  })
})

describe('基线判定', () => {
  it('一致 → ok', () => {
    expect(evaluateBaseline('abc12345', 'abc12345').ok).toBe(true)
  })

  it('不一致 → stale（阻断推送）', () => {
    const r = evaluateBaseline('abc12345', 'def67890')
    expect(r.ok).toBe(false)
    expect(r.stale).toBe(true)
    expect(r.reason).toContain('过期')
  })

  /**
   * issue #346：**查不到 ≠ 过期**。远端查询失败（网络不通/代理挂）时 `remoteHeadSha`
   * 返回空串 → 这里必须是 `stale: null`（"无法比对"），不能判成"基线过期"——否则网络问题
   * 会被伪装成"你的分支该 rebase 了"，把人引到错误方向。
   */
  it('远端查不到（网络不可达）→ stale=null 且理由说清是"无法比对"', () => {
    for (const missing of ['', '   ', null, undefined]) {
      const r = evaluateBaseline('abc12345', missing)
      expect(r.ok).toBe(false)
      expect(r.stale, `${String(missing)} 不该被判成"过期"`).toBeNull()
      expect(r.reason).toContain('无法比对')
    }
  })

  it('查不到远端 SHA → stale=null（只警告，不当成过期）', () => {
    const r = evaluateBaseline('abc12345', '')
    expect(r.ok).toBe(false)
    expect(r.stale).toBeNull()
  })
})

describe('clean 安全护栏（rm -rf 的最后一道闸）', () => {
  it('只放行 <tmp>/gh-fork-* 直接子目录', () => {
    expect(isSafeToClean('/tmp/gh-fork-240')).toBe(true)
    expect(isSafeToClean('/private/tmp/gh-fork-240', '/private/tmp')).toBe(true)
    expect(isSafeToClean('/Users/bsfeng/IdeaProjects/my-dsh-plugins')).toBe(false)
    expect(isSafeToClean('/tmp/gh-fork-240/plugins')).toBe(false)
    expect(isSafeToClean('/tmp/gh-fork-240/../..')).toBe(false)
    expect(isSafeToClean('/tmp/other-dir')).toBe(false)
    expect(isSafeToClean('/tmp')).toBe(false)
  })
})

describe('create 步骤清单（流程完整性）', () => {
  it('默认 9 步，且必须包含基线校验 / workspace 重指向 / hooks 安装', () => {
    const ids = planCreateSteps({ hooks: true, nodeModules: 'symlink' }).map((s) => s.id)
    expect(ids).toEqual([
      'clone',
      'remote',
      'fetch',
      'baseline',
      'branch',
      'exclude',
      'node_modules',
      'workspace-links',
      'hooks',
    ])
  })

  it('--no-hooks 去掉 hooks 步；--node-modules none 同时去掉就位与重指向步', () => {
    expect(planCreateSteps({ hooks: false }).map((s) => s.id)).not.toContain('hooks')
    const none = planCreateSteps({ nodeModules: 'none' }).map((s) => s.id)
    expect(none).not.toContain('node_modules')
    expect(none).not.toContain('workspace-links')
  })
})

/**
 * issue #240：workspace 内部包（dsh-shared 等）必须指向**本 fork**。
 * 指向主工作区 = 「在 fork 里验证」读到旧包 = 假验证（比"没验证"更糟）。
 */
describe('workspace 内部包指向判定（包级假验证防线）', () => {
  it('全部落在 fork 内 → 通过', () => {
    const links = [
      { name: 'dsh-shared', dir: 'dsh-shared', resolved: '/tmp/gh-fork-240/plugins/dsh-shared' },
      { name: 'dsh-md-render', dir: 'dsh-md-render', resolved: '/tmp/gh-fork-240/plugins/dsh-md-render/index.js' },
    ]
    const r = evaluateWorkspaceLinks(links, { forkDir: '/tmp/gh-fork-240' })
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('全部指向本 fork')
  })

  it('指向主工作区 → 不通过，并在 detail 里点名（这正是本次事故的指纹）', () => {
    const links = [
      { name: 'dsh-shared', dir: 'dsh-shared', resolved: '/Users/me/proj/plugins/dsh-shared' },
      { name: 'dsh-md-render', dir: 'dsh-md-render', resolved: '/tmp/gh-fork-240/plugins/dsh-md-render' },
    ]
    const r = evaluateWorkspaceLinks(links, { forkDir: '/tmp/gh-fork-240' })
    expect(r.ok).toBe(false)
    expect(r.wrong.map((w) => w.name)).toEqual(['dsh-shared'])
    expect(r.detail).toContain('dsh-shared')
  })

  it('解析失败（断链/缺失）也算不通过', () => {
    const r = evaluateWorkspaceLinks([{ name: 'dsh-shared', dir: 'dsh-shared', resolved: null }], { forkDir: '/tmp/x' })
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['dsh-shared'])
  })

  it('planWorkspaceLinks 过滤掉不完整的条目（坏 package.json 不炸流程）', () => {
    const plan = planWorkspaceLinks([{ name: 'a', dir: 'a' }, { name: '', dir: 'b' }, { name: 'c' }, null])
    expect(plan.map((p) => p.name)).toEqual(['a'])
    expect(plan[0].expectedSuffix).toBe('/plugins/a')
  })
})

describe('推送前自检结论', () => {
  const healthy = {
    forkExists: true,
    hooksPath: '.husky/_',
    hooksWired: true,
    baseline: evaluateBaseline('abc12345', 'abc12345'),
    stagedNodeModules: [],
  }

  it('全绿时首行给"可以推送"', () => {
    const report = renderCheckReport({
      forkDir: '/tmp/gh-fork-240',
      branch: 'fix/240',
      items: buildCheckItems(healthy),
      verify: { code: 0 },
    })
    expect(report.ok).toBe(true)
    expect(report.text.split('\n')[0]).toContain('✅')
  })

  it('hooks 未挂载是警告而非阻断（但仍要显式提示门禁空转）', () => {
    const items = buildCheckItems({ ...healthy, hooksWired: false, hooksPath: '' })
    const report = renderCheckReport({ forkDir: '/tmp/gh-fork-240', items, verify: null })
    expect(report.ok).toBe(true)
    expect(report.text).toContain('⚠')
    expect(report.text).toContain('不会跑本地门禁')
  })

  it('workspace 内部包指向主工作区 → 阻断推送（包级假验证防线）', () => {
    const items = buildCheckItems({
      ...healthy,
      workspaceLinks: { ok: false, detail: '指向主工作区/别处的 1 个：dsh-shared → /Users/me/proj/plugins/dsh-shared' },
    })
    const report = renderCheckReport({ forkDir: '/tmp/x', items })
    expect(report.ok).toBe(false)
    expect(report.text).toContain('dsh-shared')
    expect(report.text).toContain('假验证')
  })

  it('fork 被改写（创建时基线已不在历史中）→ 阻断推送', () => {
    const items = buildCheckItems({
      ...healthy,
      baselineIntegrity: {
        ok: false,
        detail: '创建时基线 abc12345 已不在 HEAD 历史中 —— fork 被 rebase / 强推 / 换过基点',
      },
    })
    const report = renderCheckReport({ forkDir: '/tmp/x', items })
    expect(report.ok).toBe(false)
    expect(report.text).toContain('rebase')
  })

  it('远端 main 已前进 → 只提示、不阻断（避免长期假红训练人忽略告警）', () => {
    const items = buildCheckItems({ ...healthy, baseline: evaluateBaseline('abc12345', 'def67890') })
    const report = renderCheckReport({ forkDir: '/tmp/x', items })
    expect(report.ok).toBe(true)
    expect(report.text).toContain('远端 <base> 已前进')
    expect(report.text).toContain('不影响本地推送')
    expect(report.text).toContain('·') // info 级标记
  })

  it('node_modules 被误暂存 → 阻断推送', () => {
    const dirty = buildCheckItems({ ...healthy, stagedNodeModules: ['node_modules/vitest'] })
    const report = renderCheckReport({ forkDir: '/tmp/x', items: dirty })
    expect(report.ok).toBe(false)
    expect(report.text).toContain('node_modules')
  })

  it('工具链缺 .bin → 阻断推送（"跑了但失败"不能误导成代码问题）', () => {
    const items = buildCheckItems({ ...healthy, toolchain: { ok: false, missing: ['vitest', 'depcruise'] } })
    const report = renderCheckReport({ forkDir: '/tmp/x', items })
    expect(report.ok).toBe(false)
    expect(report.text).toContain('.bin/vitest')
    expect(report.text).toContain('shell glob')
  })

  it('本地校验失败 → 结论为不可推送（fail-closed）', () => {
    const report = renderCheckReport({
      forkDir: '/tmp/x',
      items: buildCheckItems(healthy),
      verify: { code: 1, summary: '耗时 9.9s' },
    })
    expect(report.ok).toBe(false)
    expect(report.text).toContain('❌')
  })
})

describe('isLocalRemote（本地远端判据，issue #346）', () => {
  it('本地路径 / file:// → true（不依赖网络）', () => {
    for (const url of ['/tmp/x/gh-fork-origin', 'file:///tmp/x/origin', './relative/origin', '../up/origin']) {
      expect(isLocalRemote(url), url).toBe(true)
    }
  })

  it('http(s)/git/ssh/scp 形态 → false（要走远端规范化）', () => {
    for (const url of [
      'https://github.com/o/r.git',
      'http://example.com/o/r.git',
      'git://github.com/o/r.git',
      'ssh://git@github.com/o/r.git',
      'git@github.com:o/r.git',
    ]) {
      expect(isLocalRemote(url), url).toBe(false)
    }
    expect(isLocalRemote('')).toBe(false)
    expect(isLocalRemote(null)).toBe(false)
  })

  it('本地 origin 的 create 全流程不依赖网络（#346 的核心修复）', { timeout: 60_000 }, () => {
    // makeOriginRepo 现在把 origin 指向本地目录；若实现回退成 github.com URL，
    // 本用例在网络不可达的机器上就会失败（这正是修复前的形态）。
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const origin = makeOriginRepo(fake)
      expect(isLocalRemote(origin)).toBe(true)
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })
})

describe('CLI 端到端（离线）', () => {
  it('clean 拒绝非 gh-fork-* 路径（退出码 1）', () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const { code, out } = runCli(['clean', '/Users/bsfeng/IdeaProjects/my-dsh-plugins', '--yes'], { tmpRoot: fake })
      expect(code).toBe(1)
      expect(out).toContain('拒绝删除')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('clean 缺 --yes 时退出码 2（要求显式确认）', () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      makeFakeFork(fake, 'test1')
      const { code, out } = runCli(['clean', 'test1'], { tmpRoot: fake })
      expect(code).toBe(2)
      expect(out).toContain('--yes')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('用法错误优先于环境状态：目录不存在但缺 --yes 时仍返回 2（issue #240 防回归）', () => {
    // 反例：若把「目录是否存在」判在「--yes」之前，"clean 不存在的东西" 会以
    // "幂等通过" 返回 0，把"你忘了 --yes"这个用法错误悄悄吞掉。
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const { code, out } = runCli(['clean', 'nope'], { tmpRoot: fake })
      expect(code).toBe(2)
      expect(out).toContain('--yes')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('clean 幂等：目录不存在也算通过', () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const { code, out } = runCli(['clean', 'nope', '--yes'], { tmpRoot: fake })
      expect(code).toBe(0)
      expect(out).toContain('幂等通过')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('clean --yes 只删目标 fork，不动同目录其它 fork', () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const doomed = makeFakeFork(fake, 'test2')
      const keep = makeFakeFork(fake, 'test3')
      const { code } = runCli(['clean', 'test2', '--yes'], { tmpRoot: fake })
      expect(code).toBe(0)
      expect(existsSync(doomed)).toBe(false)
      expect(existsSync(keep)).toBe(true)
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  /**
   * #314 js/insecure-temporary-file 回归：`.git/info/exclude` 的写入不得跟随符号链接。
   * fork 落在 `os.tmpdir()`（同机其他用户可写）下，攻击者可以预置软链把"追加 node_modules"
   * 变成"往任意文件里追加内容"。修复用 mkdtemp + `wx` + rename 原子替换。
   */
  it('create 正常路径写入 .git/info/exclude（git clone 已建该文件，不能被 O_EXCL 判死）', { timeout: 60_000 }, () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      makeOriginRepo(fake)
      const { code, out } = runCli(['create', 'test9', '--dir', join(fake, 'gh-fork-test9')], { tmpRoot: fake })
      expect(code, out).toBe(0)
      const exclude = readFileSync(join(fake, 'gh-fork-test9', '.git', 'info', 'exclude'), 'utf8')
      expect(exclude).toContain('node_modules')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('exclude 位置已被软链占据 → 拒绝写入，受害者文件一字不改', { timeout: 60_000 }, () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const victim = join(fake, 'victim.txt')
      const original = 'keep-me\n'
      writeFileSync(victim, original)
      // 攻击者视角：把 fork 的 .git/info/exclude 预置成指向受害者的软链
      const forkDir = join(fake, 'gh-fork-test8')
      mkdirSync(join(forkDir, '.git', 'info'), { recursive: true })
      symlinkSync(victim, join(forkDir, '.git', 'info', 'exclude'))

      // fork 目录已存在 → create 先拒绝（不依赖本修复）；这里的价值是钉住
      // "现有路径不是普通文件时绝不写入"，配合下面的源码形态断言构成回归网。
      const { code, out } = runCli(['create', 'test8', '--dir', forkDir], { tmpRoot: fake })
      expect(code).toBe(1)
      expect(out).toContain('目录已存在')
      expect(readFileSync(victim, 'utf8')).toBe(original)
      expect(lstatSync(join(forkDir, '.git', 'info', 'exclude')).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('check：远端不可达 → 基线"无法比对"，但**不阻断**（退出码 0）', { timeout: 60_000 }, () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const dir = makeFakeFork(fake, 'net1')
      // 指向一个不存在的本地远端 → ls-remote 必然失败（等价于"网络不可达"的可复现形态）
      spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', join(fake, 'no-such-remote')], { encoding: 'utf8' })
      // --static：只做静态自检（不跑 verify-local）。退出码这里**不断言**：裸 fixture 缺
      // 工具链软链，check 本来就会因那一项 ❌ 而非零退出——与本用例要验的"基线"无关，
      // 断言输出才是有信息量的部分。
      const { out } = runCli(['check', 'net1', '--static'], { tmpRoot: fake })
      expect(out).toContain('远端基线状态')
      expect(out).toContain('无法比对')
      expect(out).not.toContain('需要 git fetch')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('check：远端可达且 SHA 真不一致 → 仍然报"过期"（真失败不被放过）', { timeout: 60_000 }, () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      const origin = makeOriginRepo(fake)
      const dir = makeFakeFork(fake, 'net2')
      spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', origin], { encoding: 'utf8' })
      // 让 fork 的 main 与 origin 的 main 分叉：origin 前进一个提交
      writeFileSync(join(origin, 'second.txt'), 'x\n')
      spawnSync('git', ['-C', origin, 'add', '-A'], { encoding: 'utf8' })
      spawnSync('git', ['-C', origin, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'second'], {
        encoding: 'utf8',
      })
      const { out } = runCli(['check', 'net2', '--static'], { tmpRoot: fake })
      // 远端可达且 SHA 真不一致 → 必须报"过期"（若被一并当成"无法比对"放过，就是掩盖真失败）
      expect(out).toContain('远端基线状态')
      expect(out).toContain('过期')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('list 能列出 fork 并标注 hooks 状态', () => {
    const { name: fake } = dirSync({ unsafeCleanup: true, prefix: 'fork-pool-test-' })
    try {
      makeFakeFork(fake, 'test4', { hooksPath: '.husky/_' })
      mkdirSync(join(fake, 'gh-fork-test4', '.husky', '_'), { recursive: true })
      const { code, out } = runCli(['list'], { tmpRoot: fake })
      expect(code).toBe(0)
      expect(out).toContain('gh-fork-test4')
      expect(out).toContain('hooks=✔')
      expect(out).toContain('分支=main')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('参数错误退出码 1 且打印原因', () => {
    const { code, out } = runCli(['bogus-command'])
    expect(code).toBe(1)
    expect(out).toContain('未知命令')
  })
})

describe('formatMs', () => {
  it('毫秒与秒两种量纲', () => {
    expect(formatMs(241)).toBe('241ms')
    expect(formatMs(3300)).toBe('3.3s')
  })
})
