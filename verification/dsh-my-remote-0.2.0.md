# 发版前人工自测清单 — dsh-my-remote@0.2.0

- 本次发版内容（0.1.5 → 0.2.0，本插件首个带 client 半的版本）：
  1. **设置页**（设置 → 插件 → 远程控制）：可视化编辑 `apiToken`（密码型，留空则不修改）/ `askTimeoutMs` / `approvalTimeoutMs` / `webhooks[]`（列表增删改），保存写回 profile 层 `cordis.patch.yml` 并立即生效（#385）
  2. 路由注册改由常驻 root 承载（`ctx.root.inject([webServer], …)`）+ 重复 apply 去重：修「插件 fiber 被回收 / webServer 晚就绪导致 `/remote/api` 恒 404」
  3. 新增 client 半（`exports` 的 `./client` 条件 + `dsh.client`），仅承载设置页签
  4. 测试基础设施修复：测试曾整文件覆盖真实 `~/.dsh/profiles/web/cordis.patch.yml`，改为三层防线（cucumber/vitest 提前隔离 `DSH_HOME` + 写入前 fail-closed 断言 + 防回归用例）
- 验证环境：用户本人运行中的 DSH 实例（宿主 0.2.1-rc.5）
- 确认依据：用户本人在对话中指示「继续发版」（2026-11-01）

## 功能级验证项（逐条勾选）

- [ ] 设置 → 插件 → **远程控制**页签出现，字段与当前 `cordis.patch.yml` 一致
- [ ] 改 `askTimeoutMs` 保存后：`cordis.patch.yml` 对应行更新、**其他行原样保留**（不是整文件重写）、刷新页面值回读一致
- [ ] `apiToken` 留空保存 → 不修改原值；填入新值保存 → 生效且输入框仍为密码型
- [ ] `webhooks[]` 增 / 删 / 改各一次，保存后配置与界面一致
- [ ] `/remote/api` 不再 404：重启宿主后直接请求可返回 200（修复前 fiber 回收 / webServer 晚就绪会 404）
- [ ] 浏览器 DevTools Console 无未捕获异常

## 风险提示（发版前请特别留意）

- 该插件会**写 profile 配置**：保存设置有落盘副作用，手工验证时建议先备份一份 `cordis.patch.yml` 再操作
- 本插件此前从未有 verification 清单，本次是首份

## agent 侧已做（非浏览器）

- `cd plugins/dsh-my-remote && npm test` 全绿（含 `test/host-home-isolation.mjs` 防回归）
- `npm run verify` 全量门禁覆盖

## 未验证项（如实记录）

- [ ] 上述界面项未由 agent 代跑（仓库规则：真实浏览器验证归用户本人）
- [ ] 未验证「多窗口同时编辑同一份 patch 文件」的冲突行为
