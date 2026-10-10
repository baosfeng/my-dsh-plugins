#!/usr/bin/env node
/**
 * 依赖解析一致性门禁 —— scripts/check-dep-resolution.mjs
 *
 * 拦的假绿形态（规范第十四节「本地无、CI 有」的镜像：**本地绿、CI 红**）：
 * 插件目录里残留的 node_modules/<workspace 包> **实体副本**会遮蔽仓库工作区源码，
 * 于是本地测试测的是旧副本、CI 只跑根 npm ci（插件目录没有自己的 node_modules）
 * 测的是真源码 —— 同一断言在两侧判两份代码。
 *
 * 真实事故（2026-10-10，两次 push 均红）：
 *   plugins/dsh-my-notify/node_modules/dsh-shared 与
 *   plugins/dsh-task-reliability/node_modules/dsh-shared 是 registry 陈旧副本
 *   dsh-shared@0.1.4（Sep 14 安装、被 .gitignore 忽略、不在 lockfile 里），
 *   遮蔽了 workspace 0.1.6 → 本地 test/config-store.mjs:220 绿、CI 红（apiToken 空对象）。
 *   该遮蔽同时**掩盖**了 parseConfigBlock 把无值键建成空对象的真实回归。
 *
 * 判据（详见 scripts/lib/dep-resolution.mjs 文件头）：
 *   每个插件声明的、名字属于本仓 workspace 包的依赖，解析结果 realpath 必须落在
 *   plugins/<pkg>/ 内（npm workspace link 形态）；落在任何 node_modules/ 里即判红，
 *   并打印**遮蔽路径 + 副本版本 + 版本漂移**。
 *
 * 本门禁**只读**：不删、不装、不修（写操作 fail-closed），只把路径与版本摆出来。
 *
 * 用法：
 *   node scripts/check-dep-resolution.mjs              # 门禁判定（默认，仓库根）
 *   node scripts/check-dep-resolution.mjs --json       # 机器可读
 *   node scripts/check-dep-resolution.mjs --root <dir> # 指定仓库根（自测用）
 *
 * 退出码：0 通过；1 发现遮蔽 / 解析失败；2 用法错误。
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDependencyResolution, renderViolations } from './lib/dep-resolution.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

if (argv.includes('--help')) {
  console.log('用法：node scripts/check-dep-resolution.mjs [--json] [--root <dir>]')
  process.exit(0)
}

/** 取 --root <dir>；缺值即用法错误（静默用错根会得出错误结论）。 */
function rootArg() {
  const idx = argv.indexOf('--root')
  if (idx === -1) return join(here, '..')
  const value = argv[idx + 1]
  if (typeof value !== 'string' || value === '') {
    console.error('x --root 需要一个目录参数')
    process.exit(2)
  }
  return resolve(value)
}

const root = rootArg()
const asJson = argv.includes('--json')
const { checked, violations, plugins } = checkDependencyResolution(root)

if (asJson) {
  console.log(JSON.stringify({ root, checked, plugins: plugins.length, violations }, null, 2))
  process.exit(violations.length === 0 ? 0 : 1)
}

if (violations.length > 0) {
  console.error(renderViolations(violations, root))
  console.error(
    '依赖解析一致性门禁失败：' +
      violations.length +
      ' 处遮蔽/解析失败（共检查 ' +
      checked +
      ' 条「插件 → workspace 包」解析）',
  )
  process.exit(1)
}

console.log(
  '依赖解析一致性门禁通过：' +
    plugins.length +
    ' 个插件目录，' +
    checked +
    ' 条「插件 → workspace 包」解析全部指向工作区源码',
)
