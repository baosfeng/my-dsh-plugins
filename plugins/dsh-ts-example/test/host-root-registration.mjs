/**
 * Profile 语义防回归（issue #242）：注册必须落在**常驻 root**。
 *
 * 实测：DSH 0.1.5-rc.1 下 profile 插件的 fiber 会被 loader 回收——
 * \`ctx.effect(() => ctx.webServer.register(...))\` 的注册会**静默消失**
 * （路由 404 + 空 body，无任何报错）。本测试用「self 表（模拟会被回收的插件
 * fiber：effect 不执行、派发永不到达）+ root 表（常驻）」复刻该语义；
 * 若把实现回退成 ctx.effect / ctx.on，本测试 RED。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function profileMock() {
  const self = { on: [], effects: [] }
  const root = { on: [], routes: [] }
  const rootCtx = {
    on(name, handler) {
      root.on.push({ name, handler })
      return () => {}
    },
    effect(callback) {
      return callback()
    },
    webServer: {
      register(route) {
        root.routes.push(route)
        return () => {
          const index = root.routes.indexOf(route)
          if (index !== -1) root.routes.splice(index, 1)
        }
      },
    },
  }
  const ctx = {
    on(name, handler) {
      self.on.push({ name, handler })
      return () => {}
    },
    // 模拟被回收的插件 fiber：effect 回调**不执行**（注册即丢失）
    effect(callback) {
      self.effects.push(callback)
      return () => {}
    },
    webServer: rootCtx.webServer,
    root: rootCtx,
  }
  return { ctx, self, root }
}

test('路由与事件监听注册在常驻 root（profile 语义）', () => {
  const { ctx, self, root } = profileMock()
  apply(ctx, {})
  assert.equal(self.effects.length, 0, '不得再用 ctx.effect 持有路由注册（会被 fiber 回收带走）')
  assert.ok(
    root.routes.some((r) => r.path === '/ts-example/api'),
    '路由必须注册在 root 的 webServer',
  )
  assert.ok(
    root.on.some((e) => e.name === 'session/start'),
    'session/start 必须注册在 root',
  )
  assert.equal(self.on.length, 0, '不得注册在插件自身 ctx')
})

test('重复 apply 不累积注册（loader 会多次 apply 同一插件）', () => {
  const { ctx, root } = profileMock()
  apply(ctx, {})
  const first = root.routes.length
  apply(ctx, {})
  assert.equal(root.routes.length, first, '重复 apply 应先移除上一轮注册')
})
