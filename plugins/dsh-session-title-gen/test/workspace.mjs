/**
 * dsh-session-title-gen — workspace-name resolution tests.
 *
 * 工作区名 = 会话 cwd 的项目根 basename（findProjectRoot 向上找 .git）。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceNameOf } from '../lib/workspace.js'

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'stg-ws-'))
  const repo = join(dir, 'repo')
  mkdirSync(join(repo, 'sub', 'deep'), { recursive: true })
  mkdirSync(join(repo, '.git'))
  return { dir, repo }
}

describe('workspaceNameOf', () => {
  it('返回最近 .git 祖先目录的 basename', async () => {
    const { dir, repo } = tempRepo()
    try {
      expect(await workspaceNameOf(join(repo, 'sub', 'deep'))).toBe('repo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cwd 本身是项目根时返回其 basename', async () => {
    const { dir, repo } = tempRepo()
    try {
      expect(await workspaceNameOf(repo)).toBe('repo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无 .git 祖先时返回 cwd 自身 basename', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stg-ws-'))
    try {
      expect(await workspaceNameOf(dir)).toBe(dir.split('/').at(-1))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('空/非字符串 cwd 返回空串', async () => {
    expect(await workspaceNameOf('')).toBe('')
    expect(await workspaceNameOf(undefined)).toBe('')
    expect(await workspaceNameOf(null)).toBe('')
  })
})
