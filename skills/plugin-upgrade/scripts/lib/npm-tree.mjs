/**
 * 已发布安装树 → `@deepseek-ai/*` 包清单（materialize-npm.mjs 用）。
 *
 * 为什么单独成模块：宿主机脚本 materialize-npm.mjs 顶层直接跑 npm view/install，
 * import 它就产生副作用，不适合当测试宿主（与 ./manifest-diff.mjs、./commit-lines.mjs、
 * ./github-repo.mjs 同样的理由）。
 *
 * 为什么必须在**所有层级**递归 `node_modules/@deepseek-ai/`（见 scripts/test/npm-tree.test.mjs）：
 * dsh 闭包把子包装在 `@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下，只在顶层 scope
 * 目录取包的实现会把整批嵌套子包漏掉——包计数与 manifest-diff 覆盖面因此严重偏低，
 * 审计据此得出的「包增删」结论不可引用。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const SCOPE = '@deepseek-ai'

/** 读一个包目录的完整名（name 字段优先，缺失时按 scope 目录拼）。 */
function readPackageName(pkgDir, shortName) {
  try {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    if (typeof manifest.name === 'string' && manifest.name) return manifest.name
  } catch {
    /* 无 package.json 或不可解析：按目录名兜底 */
  }
  return `${SCOPE}/${shortName}`
}

/** 枚举安装树里的全部 `@deepseek-ai/*` 包：包名 → 实例目录，同名取最浅实例。 */
export function deepseekPackages(root) {
  const packages = new Map()
  const depths = new Map()
  const visited = new Set()

  function record(pkgDir, shortName, depth) {
    const manifest = join(pkgDir, 'package.json')
    if (!existsSync(manifest)) return
    const name = readPackageName(pkgDir, shortName)
    if (!name.startsWith(`${SCOPE}/`)) return
    const prevDepth = depths.get(name)
    if (
      prevDepth === undefined ||
      depth < prevDepth ||
      (depth === prevDepth && pkgDir.length < packages.get(name).length)
    ) {
      packages.set(name, pkgDir)
      depths.set(name, depth)
    }
  }

  /** 扫描一个 node_modules 目录，并深入每个包自带的 node_modules（任意层级）。 */
  function scanModules(modules, depth) {
    if (visited.has(modules) || !existsSync(modules)) return
    visited.add(modules)
    let entries
    try {
      entries = readdirSync(modules, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === '.bin') continue
      if (entry.name.startsWith('@')) {
        // scope 目录：其下每个包都在本层，必须逐个深入各自的 node_modules——
        // 停在这一层正是漏计 @deepseek-ai/dsh/node_modules/@deepseek-ai/* 的原因。
        const scopeDir = join(modules, entry.name)
        let scoped
        try {
          scoped = readdirSync(scopeDir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const pkg of scoped) {
          if (!pkg.isDirectory() || pkg.isSymbolicLink()) continue
          const pkgDir = join(scopeDir, pkg.name)
          record(pkgDir, pkg.name, depth)
          scanModules(join(pkgDir, 'node_modules'), depth + 1)
        }
      } else {
        const pkgDir = join(modules, entry.name)
        record(pkgDir, entry.name, depth)
        scanModules(join(pkgDir, 'node_modules'), depth + 1)
      }
    }
  }

  scanModules(join(root, 'node_modules'), 0)
  return packages
}
