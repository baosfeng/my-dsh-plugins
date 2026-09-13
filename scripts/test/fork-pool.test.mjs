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
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

describe('CLI 端到端（离线）', () => {
  it('clean 拒绝非 gh-fork-* 路径（退出码 1）', () => {
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
    try {
      const { code, out } = runCli(['clean', '/Users/bsfeng/IdeaProjects/my-dsh-plugins', '--yes'], { tmpRoot: fake })
      expect(code).toBe(1)
      expect(out).toContain('拒绝删除')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('clean 缺 --yes 时退出码 2（要求显式确认）', () => {
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
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
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
    try {
      const { code, out } = runCli(['clean', 'nope'], { tmpRoot: fake })
      expect(code).toBe(2)
      expect(out).toContain('--yes')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('clean 幂等：目录不存在也算通过', () => {
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
    try {
      const { code, out } = runCli(['clean', 'nope', '--yes'], { tmpRoot: fake })
      expect(code).toBe(0)
      expect(out).toContain('幂等通过')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('clean --yes 只删目标 fork，不动同目录其它 fork', () => {
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
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

  it('list 能列出 fork 并标注 hooks 状态', () => {
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
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
