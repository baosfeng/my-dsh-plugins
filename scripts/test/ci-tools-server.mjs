#!/usr/bin/env node
/**
 * ci-tools-server.mjs — 回归测试专用的静态文件 http 服务（issue #324）。
 *
 * 为什么需要它（而不是在测试进程里起 http server）：测试用 spawnSync 跑被测 CLI，
 * **spawnSync 会阻塞父进程的事件循环**，同进程内的 server 因此收不到请求，双方互等到超时
 * （开发期实测：下载用例 126s 后 ETIMEDOUT，服务端零命中）。所以把服务放到独立进程。
 *
 * 用法：node scripts/test/ci-tools-server.mjs <要提供的文件>
 * 就绪时在 stderr 打印 `PORT=<端口>`（stdout 留给调试输出）。
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/test/ci-tools-server.mjs <文件>')
  process.exit(2)
}
const size = statSync(file).size
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': size })
  createReadStream(file).pipe(res)
})
server.listen(0, '127.0.0.1', () => {
  console.error(`PORT=${server.address().port}`)
})

/**
 * 父进程死亡看门狗 —— 保证本进程**必然**被回收（实测教训：残留 PID 53223 存活 2h44m 成孤儿）。
 *
 * 为什么必须自己看门（不能只靠调用方 kill）：调用方（scripts/test/secret-scan.test.mjs
 * 的 afterAll）只在**正常路径**回收；父进程树被 SIGKILL（单步/整体超时、CI 取消、IDE 停止、
 * 宿主工具超时）时，afterAll 与 exit 钩子一律不执行，本进程被 init 收养（PPID=1）后
 * **永久存活**并继续占端口。Node 不会因父死回收子进程，所以只能由子进程自己发现父已死并退出。
 *
 * 判据（双保险，任一成立即自退；父进程存活期间绝不自退，否则会掐掉正常工作路径）：
 *   · `process.ppid` 变了（父死 → 被 reparent，实测 Node 26 上该值实时更新）；
 *   · 父 pid 已不存在（`kill(ppid, 0)` → ESRCH）—— 兜底 ppid 被缓存/复用等情形。
 */
const PARENT_PID = process.ppid
/** 识别间隔：500ms 下每次仅一次 getppid/kill 探测（实测 CPU 0.0%）。测试可用环境变量缩短。 */
const WATCHDOG_MS = Number(process.env.CI_TOOLS_SERVER_WATCHDOG_MS ?? 500)

/** 父进程是否已消失。 */
function parentGone() {
  if (process.ppid !== PARENT_PID || process.ppid === 1) return true
  try {
    process.kill(PARENT_PID, 0)
    return false
  } catch {
    return true
  }
}

let watchdog = null
function shutdown() {
  if (watchdog !== null) clearInterval(watchdog)
  watchdog = null
  server.close()
  process.exit(0)
}
watchdog = setInterval(() => {
  if (parentGone()) shutdown()
}, WATCHDOG_MS)
// 定时器本身不保活（listen 句柄才是保活来源），行为与既有实现一致
watchdog.unref()
