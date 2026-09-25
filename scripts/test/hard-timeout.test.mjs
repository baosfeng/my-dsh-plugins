/**
 * hard-timeout.test.mjs —— 「命令级硬超时」的防回归测试（钉住 test:scripts 的时间上限真的会生效）。
 *
 * 钉住四件事，每件都能独立变红：
 *   ① 声明落在权威执行点：package.json 的 `test:scripts` 必须经由 `scripts/run-with-timeout.mjs`，
 *      不存在「裸 vitest」的无上限调用路径（此前上限只写在 verify-local 的默认值里，直调即无上限）；
 *   ② 到点真的杀：整组（含孙进程）SIGKILL，退出码 124，耗时 ≈ 阈值而不是跑到天荒地老；
 *   ③ 未到点不干预：子命令退出码原样透传（门禁结论不被包装器改写）；
 *   ④ 关闭必须是显式选择：默认上限存在且 > 0，`--timeout 0` 必须打印显式警告。
 *
 * 为什么这样验证等价于「单步跑到 1023s 那个场景」：那个场景的形态是「子进程树里有阻塞调用、
 * 事件循环里的定时器打不穿它」。这里用 `node -e "setTimeout(() => {}, 60000)"` 复刻同一形态
 * （长跑子进程 + 孙进程 + 同一进程组），只把时间尺度从 1023s 缩到 2~3s —— 机制相同、代价可忽略。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const WRAPPER = fileURLToPath(new URL('../run-with-timeout.mjs', import.meta.url))
const WRAPPER_SOURCE = readFileSync(WRAPPER, 'utf8')
const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

/** 一个长跑子进程：保持事件循环 60s（阻塞形态，任何软超时都打不穿它）。 */
const LONG_RUNNING = 'setTimeout(() => {}, 60000)'

/** 同步轮询延时（不占 CPU，避免测试自己引入固定 sleep 语义）。 */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 进程是否仍然“活且非僵尸”（被整组杀掉后应变为 false）。 */
function pidAlive(pid) {
  const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
  const stat = (r.stdout ?? '').trim()
  return stat !== '' && !stat.startsWith('Z')
}

function runWrapper(args, { timeout = 20_000 } = {}) {
  const startedAt = Date.now()
  const r = spawnSync(process.execPath, [WRAPPER, ...args], { encoding: 'utf8', timeout })
  return { ...r, elapsed: Date.now() - startedAt }
}

describe('test:scripts 的硬超时（声明落在权威执行点）', () => {
  it('package.json 的 test:scripts 经由包装器执行，且带显式阈值（不存在无上限的裸 vitest 路径）', () => {
    const script = PKG.scripts['test:scripts']
    expect(script).toContain('scripts/run-with-timeout.mjs')
    expect(script).toMatch(/--timeout \d+/)
    expect(script).toContain('vitest run --coverage --config scripts/test/vitest.config.mjs')
  })

  it('默认上限存在且 > 0（关闭只能是显式选择，不能是默认）', () => {
    expect(WRAPPER_SOURCE).toMatch(/const DEFAULT_TIMEOUT_SEC = \d+/)
    const value = Number(WRAPPER_SOURCE.match(/const DEFAULT_TIMEOUT_SEC = (\d+)/)[1])
    expect(value).toBeGreaterThan(0)
  })
})

describe('到点真的杀（整组，含孙进程）', () => {
  it('超过阈值即被 SIGKILL：退出码 124、耗时 ≈ 阈值（而不是跑到 60s 的子进程自然结束）', () => {
    const r = runWrapper(['--timeout', '2', '--label', 'test:scripts', '--', process.execPath, '-e', LONG_RUNNING])
    expect(r.status).toBe(124)
    expect(r.elapsed).toBeGreaterThanOrEqual(1900)
    expect(r.elapsed).toBeLessThan(15_000)
    expect(r.stderr).toContain('超过硬上限 2s')
  })

  it('孙进程一起被杀（不留孤儿占 CPU / coverage 目录）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hard-timeout-'))
    const pidFile = join(dir, 'grandchild.pid')
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      "const fs = require('node:fs')",
      `const g = spawn(process.execPath, ['-e', ${JSON.stringify(LONG_RUNNING)}])`,
      "console.log('GRANDCHILD=' + g.pid)",
      'fs.writeFileSync(process.argv[1], String(g.pid))',
      LONG_RUNNING,
    ].join(';')

    const r = runWrapper(['--timeout', '2', '--', process.execPath, '-e', parentScript, pidFile])
    expect(r.status).toBe(124)

    const reported = r.stdout.match(/GRANDCHILD=(\d+)/)
    expect(reported, `孙进程必须先真的启动过（stdout: ${r.stdout}）`).not.toBeNull()
    const grandchildPid = Number(reported[1])
    expect(grandchildPid).toBe(Number(readFileSync(pidFile, 'utf8')))

    const deadline = Date.now() + 5000
    while (pidAlive(grandchildPid) && Date.now() < deadline) sleepSync(50)
    const stillAlive = pidAlive(grandchildPid)
    rmSync(dir, { recursive: true, force: true })
    expect(stillAlive, `孙进程 ${grandchildPid} 仍存活（未被整棵树终止）`).toBe(false)
  })

  it('包装器不自立进程组：子进程留在调用方的组里（上层按组 SIGKILL 才能连带整条链）', () => {
    const printPgid =
      "const{execSync}=require('node:child_process');console.log('PGID='+execSync('ps -o pgid= -p '+process.pid).toString().trim())"
    const r = runWrapper(['--timeout', '30', '--', process.execPath, '-e', printPgid])
    expect(r.status).toBe(0)
    const childPgid = Number((r.stdout.match(/PGID=(\d+)/) ?? [])[1])
    const ownPgid = Number(
      spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim(),
    )
    expect(childPgid).toBeGreaterThan(0)
    expect(childPgid).toBe(ownPgid)
  })
})

describe('未到点不干预 / 关闭必须显式', () => {
  it('未超时：子命令退出码原样透传（0 与非 0 都不被改写）', () => {
    expect(runWrapper(['--timeout', '30', '--', process.execPath, '-e', 'process.exit(0)']).status).toBe(0)
    expect(runWrapper(['--timeout', '30', '--', process.execPath, '-e', 'process.exit(7)']).status).toBe(7)
  })

  it('--timeout 0 表示显式关闭，并打印显式警告（不是静默无上限）', () => {
    const r = runWrapper(['--timeout', '0', '--', process.execPath, '-e', 'process.exit(3)'])
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('硬超时已显式关闭')
  })

  it('缺少 `--` 或阈值非法 → 用法错误（exit 2），不静默当成功', () => {
    expect(runWrapper([process.execPath, '-e', 'process.exit(0)']).status).toBe(2)
    expect(runWrapper(['--timeout', 'abc', '--', process.execPath, '-e', 'process.exit(0)']).status).toBe(2)
  })
})
