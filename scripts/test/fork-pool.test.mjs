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
function runCli(args, { tmpRoot, env } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(tmpRoot ? { FORK_POOL_TMP: tmpRoot } : {}), ...(env ?? {}) },
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
  it('默认 8 步，且必须包含基线校验与 hooks 安装', () => {
    const ids = planCreateSteps({ hooks: true, nodeModules: 'symlink' }).map((s) => s.id)
    expect(ids).toEqual(['clone', 'remote', 'fetch', 'baseline', 'branch', 'exclude', 'node_modules', 'hooks'])
  })

  it('--no-hooks 去掉 hooks 步；--node-modules none 去掉就位步', () => {
    expect(planCreateSteps({ hooks: false }).map((s) => s.id)).not.toContain('hooks')
    expect(planCreateSteps({ nodeModules: 'none' }).map((s) => s.id)).not.toContain('node_modules')
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

  it('基线确认过期 / node_modules 被误暂存 → 阻断推送', () => {
    const stale = buildCheckItems({ ...healthy, baseline: evaluateBaseline('abc12345', 'def67890') })
    expect(renderCheckReport({ forkDir: '/tmp/x', items: stale }).ok).toBe(false)
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

  it('前置失败时可诊断：源仓库无效会明确说清原因，而不是静默退出', () => {
    // create 依赖网络（fetch + ls-remote），CI 里跑不了完整路径 —— 但"失败必须说人话"
    // 这一条是离线可测的：源仓库解析不出来时，脚本要在**动手之前**给出明确原因。
    const fake = mkdtempSync(join(tmpdir(), 'fork-pool-test-'))
    try {
      const { code, out } = runCli(['create', 'fail1'], {
        tmpRoot: fake,
        env: { FORK_POOL_MAIN: '/nonexistent-repo-xyz' },
      })
      expect(code).toBe(1)
      expect(out).toContain('无法从主工作区 origin 解析')
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
