---
title: 子 agent 工作区缺失导致 GUI 验证卡死
description: 新会话/隔离实例没有工作区时 GUI 合成器被禁用，点「选择工作区」会命中宿主原生 macOS 目录对话框（osascript choose folder），浏览器自动化无法驱动原生弹窗 → agent 静默卡住数天；修法是让用户事先选好工作区，或为隔离实例预置工作区落盘状态 / --patch 换 browse 后端
created: 2026-09-12
updated: 2026-09-12
---

# 子 agent 工作区缺失导致 GUI 验证卡死

## 现象（2026-09-12 实测）

新会话 / 隔离实例**没有工作区**时，GUI 合成器（composer）处于禁用态；一旦去点「选择工作区」，宿主会弹**原生 macOS 目录对话框**——浏览器自动化无法驱动原生弹窗，agent 就此**静默卡死**。

隔离实例（`DSH_HOME=/tmp/dsh-verify-191`、profile `web-191`、端口 3098）启动完全正常（`http=401` 就绪、启动日志 0 error、`--dump-config` 无重复 loader id），但 GUI 里：

- 合成器被**禁用**：占位文案「选择工作区」、发送按钮 `disabled`；
- `agent-browser` 点击「添加工作区 / 选择工作区」后 DOM **没有任何菜单项**（快照里 `选择工作区 [expanded=true]` 却没有 listbox）；
- 进程侧可见 `osascript -e set selectedFolder to choose folder with prompt "Select Workspace Directory"`——**原生弹窗在等用户点击**，而自动化进程无法触达它。

**危害**：agent 会停在这一步反复重试或空转，表现为「没进展」而不是「报错」，实测可静默卡住数天（`ps` 中一度积累 4 个 `choose folder` 进程，其中 2 个早于当轮，说明此前已有 agent 卡在这里）。

## 根因

- 该 profile 使用宿主 `@deepseek-ai/dsh-host-directory-picker-auto`（`dsh-web-app` 的 `cordis.patch.yml` 里 `- id: directory-picker` 就是它）；
- 它在启动时判定一次宿主处境，macOS 桌面会话判定为 **native** → 挂原生后端，走**系统目录对话框**（实证：`dsh-host-directory-picker-native/lib/index.js:234,236` 的 `osascript` + `choose folder`），而不是 Web 内的选择器；
- 浏览器自动化（`agent-browser` / CDP）只能驱动页面 DOM，**无法操作原生系统弹窗** → 死锁。

## 修法（强制，派发前逐条确认）

1. **优先使用用户已有的工作区**：涉及 GUI 的验证/自动化任务，**先让用户把工作区选好**（用用户自己的项目目录），不要把「需要人点原生对话框」的步骤留给无人值守的 agent。
2. **没有工作区时，问用户要**——不要自己新建一个空工作区就往下跑；空工作区同样让合成器处于禁用态。
3. **隔离实例必须预置工作区状态**（二选一）：
   - **预置落盘状态**：在隔离 `DSH_HOME` 内预写 `storages/workspace.json`（工作区列表是落盘状态，见主 `~/.dsh/storages/workspace.json`）——三段式 `{ unit, global, tables }`，`unit` 必须是 `{ name: 'workspace', version: 2 }`，`global.initialized: true` 且 `global.workspaceIds` 收录该 uuid，`tables.workspaces.<uuid> = { path, title, sessionIds, createdAt, updatedAt }`。**`path` 必须写 realpath（macOS 上写 `/tmp/...` 会 `session/workspace-attach-failed`，`/tmp` 是 `/private/tmp` 的软链），`createdAt`/`updatedAt` 必须是 ISO 字符串（写数字时间戳 → 隐性 Zod 校验失败 → 实例启动即失败）**——现成做法：`node scripts/verify-real-profile.mjs --addons plugins/<插件> --workspace <目录>`（脚本自动取 realpath + 回读校验，不再手工试错）；
   - **替换 picker**：用 `--patch` overlay 把 `directory-picker` 那一行换成非 native 后端 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览，可被浏览器自动化驱动）——是**替换**该行而非并存（选择器与某个后端同时挂载会报重复 `directoryPicker`）。
4. **派发前自检**：任务 prompt 里必须写明「工作区从哪来」（谁提供、路径是什么、是否已预置），不能留给子 agent 现场摸索。
5. **收尾必查残留**：验证结束检查并清理遗留的 `choose folder` 进程，避免它继续占着用户桌面、干扰后续 agent。

## 排查命令

```bash
# 是否有卡住的原生目录对话框（注意：ps | grep -c 会把 grep 自身算进去，用 pgrep）
pgrep -fl "choose folder"
ps -Ao pid,ppid,lstart,command | grep -v grep | grep "choose folder"
```

## 原则（这不是代码缺陷）

该卡点由 issue #191 的端到端验证首次精确定位（验证 agent 在隔离实例上真实复现）；它不是代码缺陷，而是**验证流程的环境前置缺失**——因此按本仓库习惯，规则要固化到派发 prompt 与 `skills/verifying-dsh-plugins/SKILL.md` 的隔离实例步骤里，而不是只写在这里。同类教训：环境前置缺失会被误读成「功能失败」或「没进展」（另见 [多 agent 并行测试资源冲突](多agent并行测试资源冲突.md)）。

## 相关

- `skills/verifying-dsh-plugins/SKILL.md`（隔离实例 + 浏览器验证流程 —— 已补「工作区预置」硬性前置与收尾清理）
- `scripts/verify-real-profile.mjs --workspace <目录>`（预置工作区状态的现成入口：自动 realpath + ISO 时间戳 + 写入后回读校验，见 issue #220 附带项）
- `skills/dsh-github-triage/SKILL.md`（子 agent 派发 —— fork 池即「显式工作区」）
- [多 agent 并行测试资源冲突](多agent并行测试资源冲突.md)（同类：并行/环境前置缺失导致的假失败）
