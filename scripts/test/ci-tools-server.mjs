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
