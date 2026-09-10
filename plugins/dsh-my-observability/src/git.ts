/**
 * dsh-my-observability — structured Git operations.
 *
 * 结构化 Git 工具：类型化提交（Conventional Commits）+ 状态/差异查询。
 *  - formatCommitMessage：纯函数，生成 `<type>(<scope>): <description>` 消息
 *  - parseCommitRequest：校验提交请求（type 枚举 / scope 格式 / 描述必填）
 *  - gitStatus / gitDiff / gitCommit：execFile 执行 git（不经 shell），
 *    路径必须为存在的 git 仓库（rev-parse 校验），全部带超时与输出上限
 *
 * 提交流程：git add -A → git commit -m <完整消息>（单参数传入，消息由
 * 服务端生成，不拼接用户输入到 shell）。
 */
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { GIT_TIMEOUT_MS } from './constants.js'

/** Conventional Commits 类型枚举。 */
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore']

/** 失败结果（所有 git 操作的错误形态）。 */
export interface GitError {
  ok: false
  error: { message: string }
}

/** git 命令执行结果。 */
type RunResult = { ok: true; stdout: string; stderr: string } | GitError

/** 规整后的提交请求。 */
export interface CommitRequest {
  type: string
  scope: string
  description: string
  body: string
}

/** 仓库状态结果。 */
export interface GitStatusResult {
  ok: true
  branch: string
  changes: { status: string; path: string; staged: boolean }[]
  stagedCount: number
  unstagedCount: number
  clean: boolean
}

/** 差异文本结果。 */
export interface GitDiffResult {
  ok: true
  text: string
}

/** 提交结果。 */
export interface GitCommitResult {
  ok: true
  hash: string
  message: string
  summary: string
}

/** 生成类型化提交消息（纯函数，可独立测试）。 */
export function formatCommitMessage(input: {
  type: string
  scope?: string
  description: string
  body?: string
}): string {
  const { type, scope, description, body } = input
  const head = scope !== undefined && scope !== '' ? `${type}(${scope}): ${description}` : `${type}: ${description}`
  return body !== undefined && body !== '' ? `${head}\n\n${body}` : head
}

/** 校验并规整提交请求；非法返回 undefined（type/scope/description 规则见上）。 */
export function parseCommitRequest(payload: unknown): CommitRequest | undefined {
  if (!isObject(payload)) return undefined
  if (!COMMIT_TYPES.includes(payload.type as string)) return undefined
  const description = stringOf(payload.description).trim()
  if (description === '') return undefined
  const scope = stringOf(payload.scope).trim()
  if (scope !== '' && !/^[a-z0-9-]+$/.test(scope)) return undefined
  if (payload.body !== undefined && typeof payload.body !== 'string') return undefined
  return { type: payload.type as string, scope, description, body: stringOf(payload.body).trim() }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 路径是否为存在的 git 仓库（目录存在且 git rev-parse 成功）。 */
export async function isGitRepo(repoPath: unknown): Promise<boolean> {
  if (typeof repoPath !== 'string' || repoPath === '') return false
  try {
    if (!statSync(repoPath).isDirectory()) return false
  } catch {
    return false
  }
  const result = await runGit(repoPath, ['rev-parse', '--git-dir'])
  return result.ok
}

/** 执行 git 命令（不经 shell；超时 + 输出上限；失败返回 { ok:false, error }）。 */
function runGit(repoPath: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const message = typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : error.message
          resolve({ ok: false, error: { message } })
          return
        }
        resolve({ ok: true, stdout, stderr })
      },
    )
  })
}

/** 仓库状态：分支 + 变更清单（status --short --branch 解析）。 */
export async function gitStatus(repoPath: string): Promise<GitStatusResult | GitError> {
  if (!(await isGitRepo(repoPath))) return { ok: false, error: { message: 'not a git repository' } }
  const result = await runGit(repoPath, ['status', '--short', '--branch'])
  if (!result.ok) return result
  const lines = result.stdout.split('\n').filter((line) => line !== '')
  const branch = parseBranch(lines[0] ?? '')
  const changes = lines.slice(1).map(parseChangeLine)
  return {
    ok: true,
    branch,
    changes,
    stagedCount: changes.filter((change) => change.staged).length,
    unstagedCount: changes.filter((change) => !change.staged).length,
    clean: changes.length === 0,
  }
}

/** 分支行解析：`## main...origin/main [ahead 1]` → main。 */
function parseBranch(line: string): string {
  if (!line.startsWith('## ')) return ''
  const head = line.slice(3).split('...')[0].trim()
  return head
}

/** 变更行解析：`XY path`（X=暂存区状态，Y=工作区状态；`??`=未跟踪）。 */
function parseChangeLine(line: string): { status: string; path: string; staged: boolean } {
  const status = line.slice(0, 2)
  const path = line.slice(3)
  const staged = status[0] !== ' ' && status[0] !== '?'
  return { status, path, staged }
}

/** 差异文本：git diff（工作区）或 git diff --staged（暂存区）。 */
export async function gitDiff(repoPath: string, staged: boolean): Promise<GitDiffResult | GitError> {
  if (!(await isGitRepo(repoPath))) return { ok: false, error: { message: 'not a git repository' } }
  const args = staged ? ['diff', '--staged'] : ['diff']
  const result = await runGit(repoPath, args)
  if (!result.ok) return result
  return { ok: true, text: result.stdout }
}

/** 类型化提交：git add -A → git commit -m <消息>；返回 hash + 提交摘要。 */
export async function gitCommit(repoPath: string, request: unknown): Promise<GitCommitResult | GitError> {
  if (!(await isGitRepo(repoPath))) return { ok: false, error: { message: 'not a git repository' } }
  const parsed = parseCommitRequest(request)
  if (parsed === undefined) return { ok: false, error: { message: 'invalid commit request' } }
  const message = formatCommitMessage(parsed)
  const addResult = await runGit(repoPath, ['add', '-A'])
  if (!addResult.ok) return addResult
  const commitResult = await runGit(repoPath, ['commit', '-m', message])
  if (!commitResult.ok) return commitResult
  const hash = parseCommitHash(commitResult.stdout)
  return { ok: true, hash, message, summary: commitSummary(commitResult.stdout) }
}

/** 从 commit 输出提取 hash（`[main abc1234] ...`）。 */
function parseCommitHash(stdout: string): string {
  const match = /\[[^\]]+\s+([0-9a-f]{7,40})\]/.exec(stdout)
  return match !== null ? match[1] : ''
}

/** 提交摘要：输出首行（`[main abc1234] message`）。 */
function commitSummary(stdout: string): string {
  const first = stdout.split('\n')[0].trim()
  return first.length > 120 ? `${first.slice(0, 120)}…` : first
}
