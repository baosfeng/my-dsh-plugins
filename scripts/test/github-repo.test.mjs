// skills/dsh-upgrade-audit/scripts/lib/github-repo.mjs 的回归测试（CodeQL #13 的修复）。
//
// 这是**安全判据**：判定通过就真去请求 https://api.github.com/repos/<owner>/<repo>。
// 原实现是 `repository.includes('github.com')`——子串判定会放行 "任意 host + 路径里塞
// github.com" 的 URL（CodeQL js/incomplete-url-substring-sanitization）；下面每个
// 「伪造 host」用例都是那类输入，必须返回 null。
import { describe, expect, it } from 'vitest'
import { parseGithubRepo } from '../../skills/dsh-upgrade-audit/scripts/lib/github-repo.mjs'

const REAL = { owner: 'deepseek-ai', repo: 'deepseek-harness' }

describe('parseGithubRepo', () => {
  it('接受 npm 上真实出现的各种形态（https / git+ / git / ssh / scp 式 / 无 scheme，尾部 .git 忽略）', () => {
    for (const url of [
      'https://github.com/deepseek-ai/deepseek-harness',
      'https://github.com/deepseek-ai/deepseek-harness.git',
      'git+https://github.com/deepseek-ai/deepseek-harness.git', // npm view @deepseek-ai/dsh repository.url 的真实值
      'git://github.com/deepseek-ai/deepseek-harness',
      'ssh://git@github.com/deepseek-ai/deepseek-harness',
      'git+ssh://git@github.com/deepseek-ai/deepseek-harness.git',
      'git@github.com:deepseek-ai/deepseek-harness.git',
      'github.com/deepseek-ai/deepseek-harness',
    ]) {
      expect(parseGithubRepo(url), url).toEqual(REAL)
    }
  })

  it('拒绝「任意 host + 路径/查询串里塞 github.com」的伪造形态（原 includes 判据的绕过面）', () => {
    for (const url of [
      'https://evil.example/github.com/deepseek-ai/dsh',
      'https://evil-github.com/deepseek-ai/dsh',
      'https://github.com.evil.example/deepseek-ai/dsh',
      'https://evil.example/?x=github.com/deepseek-ai/dsh',
      'https://gitlab.com/github.com/deepseek-ai/dsh',
      // host 白名单只认 github.com 本身：www 前缀即便"看起来像"GitHub 也不放行（失败方向是少一份
      // enrichment，而不是向非 GitHub host 发请求）。
      'https://www.github.com/deepseek-ai/dsh',
    ]) {
      expect(parseGithubRepo(url), url).toBeNull()
    }
  })

  it('路径形态不符 / 空值 → null（不猜）', () => {
    for (const value of [
      'https://github.com',
      'https://github.com/deepseek-ai',
      'https://github.com/deepseek-ai/dsh/tree/main',
      '',
      '   ',
      null,
      undefined,
      {},
    ]) {
      expect(parseGithubRepo(value), String(value)).toBeNull()
    }
  })
})
