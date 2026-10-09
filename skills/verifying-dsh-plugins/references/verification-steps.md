# 人工自测步骤（真实调用 / 浏览器走查 / 清理 / 填清单）

> 本文件是 [SKILL.md](../SKILL.md)「步骤 2–5」的完整细节。前置：隔离实例已按 [isolation-instance.md](isolation-instance.md) 起好。

## 步骤 2：真实模型 / 真实网关调用

单测 / mock 证明不了线上请求真的带了该带的头。需要这一层证据时，用真实 CLI 跑一次**对照组 + 实验组**：

```bash
# 对照组（无插件，复现问题）：shipped 模板本身
DSH_HOME=/tmp/dsh-verify-headless dsh --profile headless "只回复 PONG，不要调用任何工具"; echo "exit=$?"
# 实验组（有插件）：派生子 profile 并挂上待验插件
DSH_HOME=/tmp/dsh-verify-headless dsh --profile headless-verify "只回复 PONG，不要调用任何工具"; echo "exit=$?"
```

判读要点：

- **对照组必须先跑**：没有对照组，"实验组通过"只能证明"这次没报错"，不能证明是插件的功劳。
- 需要看出站请求头 / 请求体时，用浏览器 DevTools 的 Network 面板或宿主日志核对；**不要**为了一次性取证往仓库里加探针脚本。
- 只能靠真实网关暴露的问题（网关校验、路由、限流），到这一层才算验证过。
- 真实事件流（非模型调用）同理：读真实会话日志 / 落盘数据核对事件序列。

## 步骤 3：浏览器人工走查（client UI / 插件联动 / 易碎场景）

用**浏览器**打开隔离端口（不是 3080）：`http://127.0.0.1:3099/?token=…`（token 见 `$DSH_HOME/dsh-web.log` 就绪行）。
打开 DevTools（Console + Network）配合走查：

| 功能级验收点   | 怎么算过                                                                             |
| -------------- | ------------------------------------------------------------------------------------ |
| 核心功能走通   | 插件主功能在真实 GUI 里跑完整一次（真实数据、真实交互），不是只看页面能打开          |
| 易碎场景       | 重启实例后配置 / 数据回读一致；刷新浏览器后 client bundle 重载正常；会话隔离不串数据 |
| client UI 正常 | 页签 / 预览器 / 设置页按预期渲染 + 交互生效，Console 无未捕获异常                    |
| 插件间联动不崩 | 隔离实例复用生产配置组合，相邻插件共存、无注册冲突                                   |
| 环境已清理     | 见步骤 4 的五步复查全部通过                                                          |

- **页签不出现先查禁用位**（见 [isolation-instance.md](isolation-instance.md) 的两处来源），再查插件代码。
- client 侧渲染崩溃（如 `Element type is invalid`）发生在浏览器运行时、server 日志未必留痕 —— Console 面板是唯一证据来源。
- 需要截图时用浏览器 / 系统截图存到 `plugins/<插件>/assets/`，并在插件 README 里引用（release.mjs 3b 校验引用的截图存在）。
- 补强（推荐）：请**不了解实现**的人（或独立上下文的子 agent）以真实用户视角操作一遍，输出问题分级清单。

## 步骤 4：收尾清理（强制，防残留污染）

多插件 / 多 agent 并行时，验证残留会互相干扰（本仓库已踩坑）。按顺序做完并**复查**：

```bash
lsof -ti :3099 | xargs kill                                   # ① 停实例
for i in 1 2 3 4 5; do lsof -ti :3099 >/dev/null 2>&1 || break; sleep 1; done
rm -rf /tmp/dsh-verify-real-3099 /tmp/dsh-verify-headless     # ② 删隔离目录
ls -d /tmp/dsh-verify-real-3099 2>&1 || echo "目录已删除"      # ③ 复查：删完再看一眼
ps aux | grep -c "[d]sh --profile headless"                   # ④ 无残留进程（应为 0）
pgrep -fl "choose folder"                                     # ⑤ 无遗留的原生目录对话框进程（应为空）
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:3099/  # 应无响应
```

- **只杀自己起的端口 / 只删自己的目录**：`/tmp/dsh-verify-*` 下可能有别人的实例，误删会打断别人的验证。
- 端口释放 ≠ 进程已退出：进程退出过程中会重建子目录（实测删完又出现只剩 `guard/` 的目录），所以删除后要再 `ls` 一次。
- **原生目录对话框进程也要清**：验证过程中若出现过「选择工作区」弹出的 `osascript … choose folder`，收尾时用 `pgrep -fl "choose folder"` 复查并按需 `kill` —— 它会一直占着用户桌面、干扰后续操作。
- **不要重启 / 杀主实例**（3080）：验证全部在隔离实例里做。

## 步骤 5：填清单 + 声明完成

把结果写进 `verification/<插件>-<版本>.md`（**版本 = 本次发版目标版本**；模板与 3c 门禁口径见 `verification/README.md`）。结构：

```markdown
# 发版前人工自测清单 — <插件>@<版本>

- 验证环境：DSH_HOME=… / 端口 … / 浏览器 …
- 待验插件处于启用态：是 / 否

## 功能级验证项（逐条勾选）

## 未验证项与环境限制
```

- 如实记录**未验证项与环境限制**（无凭据、无 agent 事件、权限被拒等），不要把没跑过的写成通过。
- 声明完成：`node scripts/release.mjs <插件> --confirm-manual-tested`（发版时再加 `--push`）。
  3c 门禁**不会**替你判断清单内容 —— 它只认这个显式标志（未带即阻断）。
- 清单随发版 commit 提交（`--push` 时若文件存在则入列），历史留痕在 git。
