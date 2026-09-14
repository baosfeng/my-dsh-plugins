/**
 * Git tool tests: formatCommitMessage / parseCommitRequest pure functions
 * plus real temporary git repos for status/diff/commit flows.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  COMMIT_TYPES,
  formatCommitMessage,
  parseCommitRequest,
  isGitRepo,
  gitStatus,
  gitDiff,
  gitCommit,
} from '../lib/git.js'

const tmpDirs = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createRepo() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-obs-git-' }).name
  tmpDirs.push(dir)
  git(dir, 'init')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test Runner')
  return dir
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

test('formatCommitMessage covers all shapes', () => {
  assert.equal(formatCommitMessage({ type: 'feat', description: 'add widget' }), 'feat: add widget')
  assert.equal(formatCommitMessage({ type: 'fix', scope: 'store', description: 'fix leak' }), 'fix(store): fix leak')
  assert.equal(
    formatCommitMessage({
      type: 'docs',
      scope: '',
      description: 'update readme',
      body: 'line1\nline2',
    }),
    'docs: update readme\n\nline1\nline2',
  )
})

test('parseCommitRequest validates type/scope/description', () => {
  const ok = parseCommitRequest({
    type: 'feat',
    scope: 'panel',
    description: '  add timeline  ',
    body: '  body  ',
  })
  assert.deepEqual(ok, { type: 'feat', scope: 'panel', description: 'add timeline', body: 'body' })
  assert.equal(parseCommitRequest({ type: 'nope', description: 'x' }), undefined, 'unknown type rejected')
  assert.equal(parseCommitRequest({ type: 'feat', description: '   ' }), undefined, 'empty description rejected')
  assert.equal(
    parseCommitRequest({ type: 'feat', scope: 'Bad Scope!', description: 'x' }),
    undefined,
    'bad scope rejected',
  )
  assert.equal(parseCommitRequest({ type: 'feat', scope: 'ok-scope1', description: 'x' }).scope, 'ok-scope1')
  assert.equal(parseCommitRequest(null), undefined, 'null rejected')
  assert.equal(parseCommitRequest({ type: 'feat', description: 'x', body: 42 }), undefined, 'non-string body rejected')
})

test('COMMIT_TYPES is the conventional commits set', () => {
  assert.deepEqual(COMMIT_TYPES, ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'])
})

test('isGitRepo distinguishes real repos from plain dirs', async () => {
  const repo = createRepo()
  const plain = dirSync({ unsafeCleanup: true, prefix: 'dsh-obs-plain-' }).name
  tmpDirs.push(plain)
  assert.equal(await isGitRepo(repo), true, 'git repo accepted')
  assert.equal(await isGitRepo(plain), false, 'plain dir rejected')
  assert.equal(await isGitRepo(join(repo, 'missing')), false, 'missing path rejected')
  assert.equal(await isGitRepo(''), false, 'empty path rejected')
  assert.equal(await isGitRepo(42), false, 'non-string rejected')
})

test('gitStatus reports branch, staged/unstaged and untracked changes', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '-m', 'chore: seed')

  const clean = await awaitStatus(repo)
  assert.equal(clean.clean, true, 'clean repo detected')

  writeFileSync(join(repo, 'a.txt'), 'two\n')
  writeFileSync(join(repo, 'b.txt'), 'new\n')
  git(repo, 'add', 'b.txt')

  const dirty = await awaitStatus(repo)
  assert.equal(dirty.clean, false)
  assert.equal(dirty.stagedCount, 1, 'b.txt staged')
  assert.equal(dirty.unstagedCount, 1, 'a.txt modified unstaged')
  const b = dirty.changes.find((c) => c.path === 'b.txt')
  assert.equal(b.staged, true)
  const a = dirty.changes.find((c) => c.path === 'a.txt')
  assert.equal(a.staged, false)
  assert.ok(dirty.branch !== '', 'branch parsed')
})

async function awaitStatus(repo) {
  const result = await gitStatus(repo)
  assert.equal(result.ok, true, result.error?.message ?? 'status ok')
  return result
}

test('gitDiff returns workspace and staged diffs', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '-m', 'chore: seed')

  writeFileSync(join(repo, 'a.txt'), 'one\n+two\n')
  const unstaged = await gitDiff(repo, false)
  assert.equal(unstaged.ok, true)
  assert.ok(unstaged.text.includes('+two'), 'unstaged diff contains the change')

  const staged = await gitDiff(repo, true)
  assert.equal(staged.ok, true)
  assert.equal(staged.text, '', 'nothing staged yet')

  git(repo, 'add', 'a.txt')
  const staged2 = await gitDiff(repo, true)
  assert.ok(staged2.text.includes('+two'), 'staged diff contains the change')
})

test('gitCommit performs a typed commit and returns hash + message', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'feature.js'), 'export const x = 1\n')
  const result = await gitCommit(repo, {
    type: 'feat',
    scope: 'panel',
    description: 'add replay timeline',
    body: 'with filters',
  })
  assert.equal(result.ok, true, result.error?.message ?? 'commit ok')
  assert.match(result.hash, /^[0-9a-f]{7,40}$/, 'hash extracted')
  assert.equal(result.message, 'feat(panel): add replay timeline\n\nwith filters')
  assert.ok(result.summary.includes('feat(panel): add replay timeline'), 'summary carries message')
  const log = git(repo, 'log', '-1', '--format=%B').trim()
  assert.equal(log, 'feat(panel): add replay timeline\n\nwith filters', 'commit message persisted')
})

test('gitCommit rejects invalid requests and non-repos', async () => {
  const repo = createRepo()
  const bad = await gitCommit(repo, { type: 'nope', description: 'x' })
  assert.equal(bad.ok, false)
  assert.ok(bad.error.message.includes('invalid commit request'))

  const plain = dirSync({ unsafeCleanup: true, prefix: 'dsh-obs-plain2-' }).name
  tmpDirs.push(plain)
  const notRepo = await gitCommit(plain, { type: 'feat', description: 'x' })
  assert.equal(notRepo.ok, false)
  assert.ok(notRepo.error.message.includes('not a git repository'))
})

test('gitCommit with nothing to commit surfaces the git error', async () => {
  const repo = createRepo()
  const result = await gitCommit(repo, { type: 'chore', description: 'nothing to commit' })
  assert.equal(result.ok, false, 'empty commit fails')
  assert.ok(result.error.message !== '', 'git error message surfaced')
})
