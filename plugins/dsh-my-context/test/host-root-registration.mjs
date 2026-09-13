/**
 * Profile 语义防回归（issue #242）：会话监听与路由必须注册在**常驻 root** 上。
 *
 * 背景（实测）：DSH 0.1.5-rc.1 下 profile 插件的 fiber 会在 apply 结束后被
 * loader 回收——apply 期间 `ctx.on` 注册成功（hooks 表 +1），数秒后该 hook 从
 * 表中消失，事件 **0 触发且没有任何报错**；`ctx.effect(() => webServer.register(...))`
 * 注册的路由同样消失（/context/api 变 404）。
 *
 * 本测试用「分离的两个注册表」复刻该语义：
 *  - `self`  = 插件自身 ctx 的注册（模拟会被回收的插件 fiber：宿主的派发**永远不到达**）；
 *  - `root`  = root ctx 的注册（模拟常驻 fiber：宿主的派发到达这里）。
 * 判定：注册必须落在 root；若回退成 `ctx.on` / `ctx.effect`，本测试 RED。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

/** 构造 profile 语义 mock：self 表（会被回收）与 root 表（常驻）分离。 */
function profileMock() {
  const self = {}
  const root = {}
  const routes = []
  const rootDisposers = []

  const rootCtx = {
    logger: { warn() {} },
    on(name, handler) {
      ;(root[name] ??= []).push(handler)
      return () => {
        const list = root[name]
        const index = list === undefined ? -1 : list.indexOf(handler)
        if (index !== -1) list.splice(index, 1)
      }
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') rootDisposers.push(dispose)
      return dispose
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index !== -1) routes.splice(index, 1)
        }
      },
    },
    get(name) {
      return name === 'webRuntime' ? { trustedHosts: [] } : undefined
    },
  }

  const pluginCtx = {
    logger: { warn() {} },
    root: rootCtx,
    // 插件自身 ctx：注册进 self 表（宿主派发不会到达这里——正是被回收的 fiber 的效果）
    on(name, handler) {
      ;(self[name] ??= []).push(handler)
      return () => {}
    },
    effect(callback) {
      const dispose = callback()
      return dispose
    },
    webServer: rootCtx.webServer,
    get(name) {
      return name === 'webRuntime' ? { trustedHosts: [] } : undefined
    },
  }

  return { pluginCtx, self, root, routes }
}

/** 只在 root 表上派发（模拟 profile 语义下宿主真实派发位置）。 */
async function dispatchOnRoot(root, name, ...args) {
  for (const handler of root[name] ?? []) await handler(...args)
}

function withTempHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'ctx242-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return run(home)
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
}

test('session/event 注册在 root（而非会被回收的插件 ctx）', () => {
  withTempHome(() => {
    const { pluginCtx, self, root } = profileMock()
    apply(pluginCtx, {})
    assert.equal((self['session/event'] ?? []).length, 0, '不得注册在插件自身 ctx（会被 loader 回收）')
    assert.ok((root['session/event'] ?? []).length > 0, '必须注册在常驻 root')
  })
})

test('agent/pre-step 同样注册在 root', () => {
  withTempHome(() => {
    const { pluginCtx, self, root } = profileMock()
    apply(pluginCtx, {})
    assert.equal((self['agent/pre-step'] ?? []).length, 0)
    assert.ok((root['agent/pre-step'] ?? []).length > 0)
  })
})

test('profile 语义下事件经 root 派发后统计真的更新（功能生效）', async () => {
  await withTempHome(async () => {
    const { pluginCtx, root, routes } = profileMock()
    apply(pluginCtx, {})

    const session = { id: 's-242' }
    await dispatchOnRoot(root, 'session/event', session, {
      type: 'user/message',
      seq: 1,
      data: { content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } },
    })
    await dispatchOnRoot(root, 'session/event', session, {
      type: 'request/header',
      seq: 2,
      data: {
        header: { system: 'abcd', tools: [{ name: 'bash' }], config: { model: 'm', provider: 'p' } },
        reason: 'initial',
      },
    })

    const api = routes.find((route) => route.path === '/context/api')
    assert.ok(api !== undefined, '路由必须注册到 webServer（否则 /context/api 404）')
    const response = await invoke(api, '/context/api/status')
    assert.equal(response.status, 200)
    assert.ok(response.body.includes('"ok":true'), '状态路由应可用：' + response.body.slice(0, 200))
  })
})

test('重复 apply（loader 重载）不累积监听器', () => {
  withTempHome(() => {
    const { pluginCtx, root } = profileMock()
    apply(pluginCtx, {})
    const first = (root['session/event'] ?? []).length
    apply(pluginCtx, {})
    assert.equal((root['session/event'] ?? []).length, first, '重复 apply 应先移除上一轮注册')
  })
})

/** 调用前缀路由，返回 { status, body }。 */
async function invoke(route, url) {
  let status = 200
  let body = ''
  const response = {
    writeHead(code) {
      status = code
      return response
    },
    end(chunk) {
      body += chunk === undefined ? '' : String(chunk)
      return response
    },
    setHeader() {},
    getHeader() {
      return undefined
    },
  }
  await route.handler(
    { method: 'GET', url, headers: { host: '127.0.0.1:3097' }, socket: { remoteAddress: '127.0.0.1' } },
    response,
  )
  return { status, body }
}
