# 发版前人工自测清单 — dsh-my-skill-manager@0.2.1

- **版本说明**：`v0.2.0` 从未打 tag / 发布过（仓库里只有 CHANGELOG 段与人工自测清单），本次` v0.2.1 `一并发布 **0.2.0 的界面与实现重写** 与 **本次 CodeQL #121 修复**。
- 本次新增内容（0.2.1）：SKILL.md 详情读取改用同一个 fd（`open → handle.stat() → handle.read`），消除 CodeQL `js/file-system-race` 的 TOCTOU 窗口；行为对外不可见（同样的内容、同样的 256KB 截断）。
- 验证环境：用户本人运行中的 DSH 实例（宿主 0.2.1-rc.5）；0.2.0 的大改版人工自测见 `verification/dsh-my-skill-manager-0.2.0.md`（逐条清单仍有效）。
- 确认依据：用户本人在对话中指示「继续发版」（2026-11-01）。

## 本次需要回归的（#121 影响面很窄，只验详情预览）

- [ ] 打开任意技能详情 → **SKILL.md 预览内容正确**（首行、换行、中文不乱码）
- [ ] 预览一个大文件（> 256KB 的 SKILL.md）→ 截断提示出现，且不出现乱码尾巴
- [ ] 技能不存在 / 名字非法 → 仍是 404 / 400 语义的错误提示，不出现 500
- [ ] 其余 0.2.0 界面项（列表、搜索、筛选、批量启停、诊断台）行为不变

## 机器门禁（agent 执行，已通过）

- [x] `cd plugins/dsh-my-skill-manager && npm test`：vitest 9 文件 66 用例 + cucumber 6 场景全绿（含新增 `test/server-detail-toctou.mjs` 6 例）
- [x] 反证：把产物退回 PR 前实现 → 新用例 3 条失败（证明用例真能抓 TOCTOU）
- [x] `npm run typecheck`、`prettier --check`、`node scripts/check-commit-messages.mjs` 均通过
- [x] PR #507 CI：32 个 check 通过 31 / 失败 0 / 跳过 1；CodeQL `Analyze (javascript-typescript)` 通过

## 未验证项（如实记录）

- [ ] 浏览器走查未由 agent 代跑（仓库规则：真实浏览器验证归用户本人）
- [ ] 告警 #121 在 GitHub 侧需合并后对 main 重扫才会自动关闭，合并前仍显示 open
