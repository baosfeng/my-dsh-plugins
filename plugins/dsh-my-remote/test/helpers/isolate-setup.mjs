/**
 * vitest 全局 setup：整个测试进程的 DSH_HOME 从**第一个用例之前**就指向隔离目录。
 *
 * 为什么需要（真实事故）：`dsh-shared` 的 `patchFileOf` 在 `DSH_HOME` 为空时回退
 * `~/.dsh`；插件测试一旦在该窗口写 patch，就会**整文件覆盖用户真实配置**。用例内部
 * 自行设置的 DSH_HOME 只能覆盖「设置之后」的窗口 —— 首次设置之前的窗口由本文件封死。
 *
 * 与 `isolated-home.mjs` 的 fail-closed 断言（拒绝写 ~/.dsh / 临时目录之外的路径）
 * 构成双保险。
 */
import { afterAll, beforeAll } from 'vitest'
import { isolatedHome } from './isolated-home.mjs'

let suite = null

beforeAll(() => {
  suite = isolatedHome('dsh-my-remote-suite-')
})

afterAll(() => {
  if (suite !== null) {
    suite.restore()
    suite = null
  }
})
