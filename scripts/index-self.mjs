#!/usr/bin/env node
/**
 * 本仓库自身知识图谱索引的「重建 / 新鲜度检查」入口。
 *
 * 为什么需要它：AGENTS.md 规定「代码查询走知识图谱」，但索引会**静默过期**——实测
 * 2026-08-27 建的索引到 09-17 已落后 515 个提交，且节点数只有 full 模式的 1/7
 * （3736 vs 26122）→ `search_graph` 对**真实存在**的函数返回 0 结果，agent 据此
 * 得出「没有这个函数/这个 API 不存在」的错误否定结论，然后把时间花在错误的排查方向上。
 *
 * 用法：
 *   node scripts/index-self.mjs           重建本仓库索引（full 模式；必须 full，fast 会过滤掉实现文件）
 *   node scripts/index-self.mjs --status  只看状态与新鲜度，不重建
 *
 * 索引对象是 **git 主工作区**（worktree 里 `--show-toplevel` 指向 worktree，而 agent 查询
 * 用的 project 名以主工作区路径为准）。用 `--repo-path` 可覆盖。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOME = process.env.HOME ?? ''
const CBM_BIN = process.env.CBM_BIN || join(HOME, '.local/bin/codebase-memory-mcp')
const CACHE_DIR = join(HOME, '.cache/codebase-memory-mcp')
const argv = process.argv.slice(2)
const flags = new Set(argv)
const repoFlag = argv.indexOf('--repo-path')

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

/** 主工作区根目录：`--git-common-dir` 在 worktree 里仍指向主仓库的 .git。 */
function mainRepoRoot() {
  if (repoFlag >= 0 && argv[repoFlag + 1]) return resolve(argv[repoFlag + 1])
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return dirname(resolve(commonDir))
}

/** codebase-memory 的 project 名 = 绝对路径去掉前导 `/` 后把 `/` 换成 `-`。 */
function projectName(root) {
  return root.replace(/^\//, '').replace(/\//g, '-')
}

function dbPath(name) {
  return join(CACHE_DIR, `${name}.db`)
}

function fmtTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 索引节点数（图谱后端权威值）；取不到就返回 null，不影响主流程。 */
function nodeCount(name) {
  if (!existsSync(CBM_BIN)) return null
  try {
    const out = execFileSync(CBM_BIN, ['cli', 'index_status', '--project', name], { encoding: 'utf8' })
    return JSON.parse(out.slice(out.indexOf('{'))).nodes ?? null
  } catch {
    return null
  }
}

function status(root) {
  const name = projectName(root)
  const db = dbPath(name)
  if (!existsSync(db)) {
    console.log(`[index-self] 尚未建立索引（project ${name}）`)
    console.log(`[index-self] 重建：node scripts/index-self.mjs`)
    return
  }
  const dbMs = statSync(db).mtimeMs
  const commits = git(root, 'log', '-1', '--format=%h|%ct|%s').split('|')
  const headMs = Number(commits[1]) * 1000
  const behind = Number(git(root, 'rev-list', '--count', 'HEAD', `--since=${new Date(dbMs).toISOString()}`))

  console.log(`[index-self] project  ${name}`)
  console.log(`[index-self] 索引     ${db}（${fmtTime(dbMs)}${nodeCount(name) ? `，${nodeCount(name)} 节点` : ''}）`)
  console.log(`[index-self] 仓库     ${commits[0]}（${fmtTime(headMs)}）${commits[2]}`)

  if (behind > 0) {
    console.log(``)
    console.log(`⚠  索引落后 ${behind} 个提交：这些提交里的新符号**查不到**，`)
    console.log(`   search_graph / search_code 会返回 0 结果 —— 那不是「不存在」的证据。`)
    console.log(`   重建：node scripts/index-self.mjs`)
    process.exitCode = 1
    return
  }
  console.log(``)
  console.log(`✔ 索引不早于最后提交，可放心用 search_graph / search_code 的否定结论。`)
}

function reindex(root) {
  if (!existsSync(CBM_BIN)) {
    console.error(`[index-self] 未找到 ${CBM_BIN}（用 CBM_BIN 指定路径）`)
    process.exitCode = 1
    return
  }
  console.log(`[index-self] full 模式重建索引 → ${root}（fast 会过滤实现文件，必须 full）`)
  execFileSync(CBM_BIN, ['cli', 'index_repository', '--repo-path', root, '--mode', 'full'], { stdio: 'inherit' })
  status(root)
}

function main() {
  const root = mainRepoRoot()
  if (flags.has('--status')) status(root)
  else reindex(root)
}

// 仅在直接执行时运行：被 import（如测试）时不得触发重建。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
