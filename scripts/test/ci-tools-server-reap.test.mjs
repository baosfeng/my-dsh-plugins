/**
 * ci-tools-server-reap.test.mjs —— 「测试辅助长驻进程不得留孤儿」的防回归测试。
 *
 * 缺陷形态（实测到的真实泄漏，2026-09-25）：scripts/test/ci-tools-server.mjs 是
 * secret-scan.test.mjs 的**下载用例**用来提供 tarball 的独立 http 服务（见该文件 246-264 行），
 * 回收**只**依赖 afterAll 里的 server.kill('SIGKILL')（280-286 行）。一旦父进程树被强杀
 * （单步/整体超时、CI 取消、IDE 停止、宿主超时），afterAll 没有任何机会执行 ——
 * 于是服务进程被 init 收养（PPID=1）**永久存活**：实测残留 PID 53223 活了 2h44m、
 * 仍 LISTEN 127.0.0.1:56751，并让 verify 的隔离 TMPDIR（verify-isolated-tmp-BjA8ox）无法被常规清理。
 *
 * ⚠️ spawn 出来的普通子进程**不会**随父进程死亡而消失（Node 无自动回收）：
 *   父被 SIGKILL → 子被 init 收养 → 只有子进程自己「发现父已死并自退」才可能被回收。
 * 本测试钉住三件事，每件都能独立变红：
 *   ① 父进程被 SIGKILL（超时/取消形态）→ 服务进程必须在有界时间内自退（**红线**）；
 *   ② 父进程正常退出但没 kill 它 → 同样必须自退（覆盖 afterAll 未执行 / 提前退出）；
 *   ③ 父进程活着时**不得**自退（看门狗不得掐掉正常工作路径）。
 *
 *
 * ⚠️ **验证方式（必读）**：本测试必须在 `npm run test:scripts` **全量并行**下验证，**单文件精跑绿不足以证明可用**。
 *   本文件曾因此翻车：`keepAlive=false` 用例用「固定 150ms 后父进程退出」与「服务就绪」两个独立时钟赛跑 ——
 *   单跑（就绪 ~60ms）必绿，而 44 个测试文件并行时 node 冷启动被拖长（实测并发 40 个 node 冷启动
 *   p50=145ms / max=160ms，11/40 超过 150ms）→ 父进程先退出、测试干等 15s 超时假红。
 *   结论：改这里必须**在全量并行下取证**；就绪判定与父进程退出都必须挂在事件上，**禁止固定延时**。
 * 判据是**有界 + 相对**的（只要求「有限时间内死掉」），不是绝对耗时断言：
 * 上界给到 10s（默认识别间隔的 20 倍），并发负载高时也不会假红。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SERVER = fileURLToPath(new URL('./ci-tools-server.mjs', import.meta.url))
/** 孤儿回收的有界上界：只要求有限时间自退，不锁绝对耗时。 */
const REAP_DEADLINE_MS = 10_000
/** 「父活着时不许自退」的观察窗口：≥ 3 倍默认识别间隔。 */
const KEEP_ALIVE_OBSERVE_MS = 1_800

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 进程是否仍然「活且非僵尸」。 */
function pidAlive(pid) {
  const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
  const stat = (r.stdout ?? '').trim()
  return stat !== '' && !stat.startsWith('Z')
}

function hardKill(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* 已经退出了 */
  }
}

/** 测试自身起的进程也必须在每个用例结束时清掉（否则本测试自己就成了孤儿制造者）。 */
const spawned = []
afterEach(() => {
  for (const pid of spawned.splice(0)) hardKill(pid)
})

/**
 * 起一个「调用方进程」：它按 secret-scan.test.mjs:262 的**真实形态** spawn 服务进程
 * （stdin 忽略 / stdout、stderr 管道），就绪后打印 SERVER=<pid> 供本测试观察。
 * keepAlive=false 时模拟「父进程正常退出但忘了 kill 子进程」。
 */
function startCaller(tarPath, { keepAlive }) {
  const lines = [
    "const { spawn } = require('node:child_process')",
    `const KEEP_ALIVE = ${keepAlive}`,
    'const child = spawn(process.execPath, [' +
      JSON.stringify(SERVER) +
      ', ' +
      JSON.stringify(tarPath) +
      "], { stdio: ['ignore', 'pipe', 'pipe'] })",
    'child.stdout.resume()',
    'let buf = ""',
    'let reported = false',
    'child.stderr.on("data", (d) => {',
    '  buf += d',
    '  if (reported) return',
    '  const m = /PORT=(\\d+)/.exec(buf)',
    '  if (!m) return',
    '  reported = true',
    // ⚠️ 「调用方何时退出」必须绑定**服务已就绪**这个事件，绝不能用固定延时：
    //    固定延时与就绪是两个独立时钟，并行负载下 node 冷启动会超过它（实测并发 40 个 node
    //    冷启动 max=160ms、11/40 超 150ms），于是调用方在报告 PID 之前就退出 →
    //    测试永远收不到 SERVER → 干等上限后假红（实测：44 文件并行时本用例 15s 超时）。
    '  process.stdout.write("SERVER=" + child.pid + "\\n", () => { if (!KEEP_ALIVE) process.exit(0) })',
    '})',
    keepAlive ? 'setInterval(() => {}, 1000)' : '',
  ]
  const child = spawn(process.execPath, ['-e', lines.join('\n')], { stdio: ['ignore', 'pipe', 'inherit'] })
  spawned.push(child.pid)
  const ready = new Promise((resolve, reject) => {
    let buf = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    // 上限只是**防挂死安全网**，不是判据：就绪判定本身是事件驱动的（见文件头），与负载无关。
    const timer = setTimeout(
      () => finish(reject, new Error('调用方进程未在 15s 内报告服务 PID（stdout=' + JSON.stringify(buf) + '）')),
      15_000,
    )
    child.stdout.on('data', (chunk) => {
      buf += chunk
      const m = /SERVER=(\d+)/.exec(buf)
      if (m) finish(resolve, Number(m[1]))
    })
    // 'close' 在 stdio 全部关闭后才触发：此刻残留 stdout 已处理完，可判定「调用方在报告 PID
    // 之前就退出了」这一**时序耦合回归**并立即给出根因诊断（不必干等上限）。
    child.on('close', (code, signal) =>
      finish(
        reject,
        new Error(
          '调用方进程在报告服务 PID 之前退出（code=' +
            code +
            ' signal=' +
            signal +
            '）—— 调用方退出与服务就绪存在时序耦合（负载敏感回归）；stdout=' +
            JSON.stringify(buf),
        ),
      ),
    )
    child.on('error', (error) => finish(reject, error))
  })
  return { callerPid: child.pid, ready }
}

/** 轮询等待服务进程死亡，返回是否在窗口内死掉。 */
async function waitGone(pid, deadlineMs) {
  const end = Date.now() + deadlineMs
  while (Date.now() < end) {
    if (!pidAlive(pid)) return true
    await sleep(100)
  }
  return !pidAlive(pid)
}

function tempTarball() {
  const dir = mkdtempSync(join(tmpdir(), 'ci-tools-server-reap-'))
  const file = join(dir, 'fake.tar.gz')
  writeFileSync(file, 'not-a-real-tarball')
  return { dir, file }
}

describe('ci-tools-server 不得留孤儿（父进程被强杀 / 正常退出都要自退）', () => {
  it('父进程被 SIGKILL（超时/取消形态）→ 服务进程在有界时间内自行退出', async () => {
    const { dir, file } = tempTarball()
    try {
      const { callerPid, ready } = startCaller(file, { keepAlive: true })
      const serverPid = await ready
      spawned.push(serverPid)
      expect(pidAlive(serverPid), '服务进程必须先真的起来').toBe(true)

      // 强杀调用方：afterAll / exit 钩子在这一形态下**一律不会执行**（SIGKILL 不可捕获）
      hardKill(callerPid)
      const gone = await waitGone(serverPid, REAP_DEADLINE_MS)
      expect(
        gone,
        '调用方被 SIGKILL 后，服务进程 ' + serverPid + ' 在 ' + REAP_DEADLINE_MS + 'ms 内仍存活（孤儿）',
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('父进程正常退出（未 kill 子进程）→ 服务进程同样自行退出', async () => {
    const { dir, file } = tempTarball()
    try {
      const { callerPid, ready } = startCaller(file, { keepAlive: false })
      const serverPid = await ready
      spawned.push(serverPid)
      const gone = await waitGone(serverPid, REAP_DEADLINE_MS)
      expect(gone, '调用方正常退出后，服务进程 ' + serverPid + ' 在 ' + REAP_DEADLINE_MS + 'ms 内仍存活（孤儿）').toBe(
        true,
      )
      expect(pidAlive(callerPid), '调用方本应已自行退出').toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('父进程存活期间服务进程不得自退（看门狗不得掐掉正常工作路径）', async () => {
    const { dir, file } = tempTarball()
    try {
      const { callerPid, ready } = startCaller(file, { keepAlive: true })
      const serverPid = await ready
      spawned.push(serverPid)
      await sleep(KEEP_ALIVE_OBSERVE_MS)
      expect(pidAlive(callerPid), '调用方应仍在运行').toBe(true)
      expect(pidAlive(serverPid), '父进程存活时服务进程不得自退').toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
