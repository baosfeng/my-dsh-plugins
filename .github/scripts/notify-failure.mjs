#!/usr/bin/env node
/**
 * Release workflow 失败通知（issue #36）：创建 [发版失败] issue。
 *
 * 用法（由 release.yml 的 Notify failure via issue 步骤调用）：
 *   node .github/scripts/notify-failure.mjs
 *
 * 环境变量：
 *   GITHUB_TOKEN  — Actions 自动注入的 token（issues: write 权限）
 *   TAG           — 失败的 tag（如 dsh-my-memory@v0.1.0）
 *   RUN_ID        — 失败的 Actions run id
 */
const token = process.env.GITHUB_TOKEN
const tag = process.env.TAG ?? 'unknown-tag'
const runId = process.env.RUN_ID ?? ''

if (!token) {
  console.error('::warning::GITHUB_TOKEN 未提供，跳过失败通知')
  process.exit(0)
}

const body = [
  `## 发版失败：${tag}`,
  '',
  'Release workflow 执行失败（tag 已推送但 Release/npm 未完成）。',
  '',
  `- **tag**: ${tag}`,
  `- **run**: https://github.com/baosfeng/my-dsh-plugins/actions/runs/${runId}`,
  '- **失败步骤**: 见上方 run 日志',
  '',
  '## 常见失败原因与处理',
  '',
  '1. **npm ci 失败（root package-lock.json 与 package.json 不同步）**',
  '   - 处理：`git fetch` 后 `npm install` 更新 package-lock.json 并提交，再重新打 tag。',
  '2. **tag 指向错误的 commit（非当前 HEAD）**',
  '   - 处理：`git tag -d <tag> && git tag <tag> && git push origin -f <tag>`（远程 tag 指向旧 commit 时用 `-f` 覆盖，确认后再执行）。',
  '3. **测试失败（Smoke test）**',
  '   - 处理：修复插件问题后重新打 tag：`git tag -d <tag> && git tag <tag> && git push origin -f <tag>`。',
  '4. **npm publish 失败（包名被占用 / 版本已存在）**',
  '   - 处理：GitHub Release 是主交付物，npm 失败仅警告；如需补发请先确认包名与版本号后重试。',
  '5. **其他**：见上方 run 日志；修复后重新打 tag 触发 release.yml，或手动触发 Release (auto)。',
  '',
].join('\n')

const payload = JSON.stringify({
  title: `[发版失败] ${tag} Release workflow 失败`,
  body,
  labels: ['bug'],
})

// 去重：同一 tag 已存在 open 的 [发版失败] issue 时不重复创建（避免重跑重复上报）。
const issueListRes = await fetch(
  'https://api.github.com/repos/baosfeng/my-dsh-plugins/issues?state=open&labels=bug&per_page=100',
  {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  },
)
if (!issueListRes.ok) {
  // 查询失败不阻断建 issue（宁可重复也不漏报）
  console.error(`::warning::failed to list open issues: HTTP ${issueListRes.status}，继续创建 issue`)
} else {
  const issues = await issueListRes.json()
  const dup = issues.find((i) => i.title.includes(`[发版失败] ${tag}`))
  if (dup) {
    console.log(`::notice::已存在 open 的失败 issue #${dup.number}（${dup.title}），跳过重复创建`)
    process.exit(0)
  }
}

const res = await fetch('https://api.github.com/repos/baosfeng/my-dsh-plugins/issues', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: payload,
})

if (res.ok) {
  console.log(`::notice::failure issue created (HTTP ${res.status})`)
} else {
  const text = await res.text()
  console.error(`::warning::failed to create failure issue: HTTP ${res.status} ${text.slice(0, 200)}`)
  process.exit(0)
}
