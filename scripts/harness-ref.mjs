#!/usr/bin/env node
/**
 * 官方参考源（deepseek-ai/deepseek-harness）的获取 / 更新 / 索引入口。
 *
 * 为什么需要它：`docs/官方文档/` 那批速查是从官方仓库取证写成的，官方代码演进后要能
 * 一键对齐；但本机是 **shallow clone**（`--depth 1`，140M），直接 `git pull` 会失败，
 * 必须走 `fetch --depth 1` + `reset --hard`。
 *
 * 用法：
 *   node scripts/harness-ref.mjs            更新到官方最新（首次自动 clone）
 *   node scripts/harness-ref.mjs --status   只看当前基线，不联网
 *   node scripts/harness-ref.mjs --index    更新后重建知识图谱索引（codebase-memory）
 *   node scripts/harness-ref.mjs --reclone  删掉重来（本地改动会被丢弃）
 *
 * 位置：默认 `/Users/bsfeng/IdeaProjects/deepseek-harness`，用 `DSH_HARNESS_REF` 覆盖。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'
const BRANCH = 'master'
const HOME = process.env.HOME ?? ''
const REF_DIR = process.env.DSH_HARNESS_REF || join(HOME, 'IdeaProjects/deepseek-harness')
const CBM_BIN = process.env.CBM_BIN || join(HOME, '.local/bin/codebase-memory-mcp')

const flags = new Set(process.argv.slice(2))

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts })
}

function git(...args) {
  return execFileSync('git', ['-C', REF_DIR, ...args], { encoding: 'utf8' }).trim()
}

/** 当前基线：commit、提交日期、官方包版本 —— 与 docs 里写的基线对齐用。 */
function reportBaseline() {
  const head = git('log', '-1', '--format=%h|%ad|%s', '--date=short')
  const [hash, date, subject] = head.split('|')
  let version = '(未知)'
  try {
    version = JSON.parse(readFileSync(join(REF_DIR, 'package.json'), 'utf8')).version
  } catch {
    /* 非 git 目录或缺 package.json 时保持未知 */
  }
  console.log(`\n参考源：${REF_DIR}`)
  console.log(`  分支   ${git('branch', '--show-current') || BRANCH}`)
  console.log(`  commit ${hash}（${date}）${subject}`)
  console.log(`  版本   ${version}`)
  console.log(`  深度   ${existsSync(join(REF_DIR, '.git/shallow')) ? 'shallow（--depth 1）' : '完整历史'}`)
  return { hash, date, version }
}

function clone() {
  console.log(`[harness-ref] 首次获取官方仓库（shallow）→ ${REF_DIR}`)
  run('git', ['clone', '--depth', '1', '--branch', BRANCH, REPO_URL, REF_DIR])
}

/** shallow 仓库的正确更新姿势；`git pull` 在 --depth 1 下会报错或拉不全。 */
function update() {
  console.log('[harness-ref] 拉取官方最新 …')
  run('git', ['-C', REF_DIR, 'fetch', '--depth', '1', 'origin', BRANCH])
  run('git', ['-C', REF_DIR, 'reset', '--hard', 'FETCH_HEAD'])
  run('git', ['-C', REF_DIR, 'clean', '-fd'], { quiet: true })
}

function reindex() {
  if (!existsSync(CBM_BIN)) {
    console.log(`[harness-ref] 跳过索引：未找到 ${CBM_BIN}（设 CBM_BIN 可指定）`)
    return
  }
  console.log('[harness-ref] 重建知识图谱索引（full 模式，大仓库需数分钟）…')
  run(CBM_BIN, ['cli', 'index_repository', '--repo-path', REF_DIR, '--mode', 'full'])
}

function main() {
  if (flags.has('--reclone') && existsSync(REF_DIR)) {
    console.log(`[harness-ref] 删除 ${REF_DIR} 重新克隆`)
    rmSync(REF_DIR, { recursive: true, force: true })
  }
  if (!existsSync(join(REF_DIR, '.git'))) clone()
  else if (!flags.has('--status')) update()

  const { version } = reportBaseline()
  console.log(`\n提示：docs 里的基线若与该版本不一致，以本机运行包为准（见 docs/官方文档/索引.md）。`)
  if (flags.has('--index')) reindex()
  console.log(`检索：grep -rn "关键词" ${REF_DIR}/docs --include=*.zh.md`)
  console.log(`当前官方版本 ${version}`)
}

// 仅在直接执行时运行：被 import（如测试）时不得触发 clone / fetch。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
