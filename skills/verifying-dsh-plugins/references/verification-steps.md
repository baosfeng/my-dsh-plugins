# 取证步骤（探针 / 浏览器 / 清理 / 留档）

> 本文件是 [SKILL.md](../SKILL.md)「步骤 2–5」的完整细节。前置：隔离实例已按 [isolation-instance.md](isolation-instance.md) 起好。

## 步骤 2：真实模型调用 —— fetch 探针（对照组 + 实验组）

单测/mock 证明不了线上请求真的带了头。用 `NODE_OPTIONS=--import` 在 DSH 入口**之前**包住最内层 `globalThis.fetch`，抓真实出站请求头：

```bash
PROBE="$PWD/skills/verifying-dsh-plugins/scripts/fetch-probe.mjs"
rm -f /tmp/probe-control.jsonl /tmp/probe-test.jsonl
# 对照组（复现问题）
NODE_OPTIONS="--import $PROBE" PROBE_LOG=/tmp/probe-control.jsonl PROBE_MATCH=opencode.ai \
  DSH_HOME=/tmp/dsh-verify-headless dsh --profile headless "只回复 PONG，不要调用任何工具"
# 实验组（证明修复）
NODE_OPTIONS="--import $PROBE" PROBE_LOG=/tmp/probe-test.jsonl PROBE_MATCH=opencode.ai \
  DSH_HOME=/tmp/dsh-verify-headless dsh --profile headless-verify "只回复 PONG，不要调用任何工具"
cat /tmp/probe-control.jsonl /tmp/probe-test.jsonl     # JSONL：{url,hasSessionHeader,sessionHeader,hasAuthorization}
```

实测样例（`dsh-my-opencode-session-header@0.1.0`）：

| 组               | CLI 结果                                                    | 探针记录                                                                                                          |
| ---------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 对照组（无插件） | `INVALID_REQUEST: 400 {"type":"MissingSessionID"…}`，exit 1 | `hasSessionHeader=false`（同时证明 DSH 自身不发该头）、`hasAuthorization=true`                                    |
| 实验组（有插件） | 模型真实返回 `PONG`，exit 0                                 | `hasSessionHeader=true`、`sessionHeader="66a65b32-…"`（裸 UUID，`valueMode: uuid` 生效）、`hasAuthorization=true` |

判读要点：

- **对照组必须先跑**：没有对照组，"实验组通过"只能证明"这次没报错"，不能证明是插件的功劳。
- 同时看 `hasAuthorization=true`：补头不能挤掉/覆盖鉴权。
- 只能靠真实网关暴露的问题（网关校验、路由、限流），到这一层才算验证过。
- 真实事件流（非模型调用）同理：探针思路可换成包住事件入口/HTTP 服务，或读真实会话日志核对事件序列。

## 步骤 3：浏览器验证（client UI / 插件联动 / 易碎场景）

独立端口 + 真实浏览器（本机用 `agent-browser` CLI；也可用插件自带 `plugins/<name>/test/e2e-cdp.mjs` 这类 CDP 脚本）：

```bash
agent-browser open http://127.0.0.1:3099/     # 指向隔离端口，不是 3080
agent-browser snapshot                        # 可访问性树，确认页签/面板渲染
agent-browser click <sel>                     # 交互；用 @ref 引用 snapshot 里的节点
agent-browser eval "console.error"            # 读 console 报错（应无未捕获错误）
agent-browser screenshot /tmp/verify-3099.png # 截图留档（README 效果图同源）
agent-browser close --all                     # 收尾关闭
```

| 功能级验收点   | 怎么算过                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| 核心功能走通   | 插件主功能在真实 GUI 里跑完整一次（真实数据、真实交互），不是只看页面能打开        |
| 易碎场景       | 重启实例后配置/数据回读一致；刷新浏览器后 client bundle 重载正常；会话隔离不串数据 |
| client UI 正常 | 页签/预览器/设置页按预期渲染 + 交互生效，Snapshot 无报错、console 无未捕获异常     |
| 插件间联动不崩 | 隔离实例复用生产配置组合（dump-config 全量 id 无重复），相邻插件共存、无注册冲突   |
| 环境已清理     | 见步骤 4 的五步复查全部通过                                                        |

补强（推荐）：新功能/新插件用**盲测子 agent**（不了解实现的独立上下文）以真实用户视角操作 GUI，输出问题分级清单。

## 步骤 4：收尾清理（强制，防残留污染）

多插件/多 agent 并行时，验证残留会互相干扰（本仓库已踩坑）。按顺序做完并**复查**：

```bash
lsof -ti :3099 | xargs kill                                   # ① 停实例
for i in 1 2 3 4 5; do lsof -ti :3099 >/dev/null 2>&1 || break; sleep 1; done
rm -rf /tmp/dsh-verify-real-3099 /tmp/dsh-verify-headless     # ② 删隔离目录
ls -d /tmp/dsh-verify-real-3099 2>&1 || echo "目录已删除"      # ③ 复查：删完再看一眼
ps aux | grep -c "[d]sh --profile headless"                   # ④ 无残留进程（应为 0）
pgrep -fl "choose folder"                                     # ⑤ 无遗留的原生目录对话框进程（应为空）
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:3099/  # 应无响应
```

- **只杀自己起的端口/只删自己的目录**：`/tmp/dsh-verify-*` 下可能有别的 agent 正在用的实例，误删会打断别人的验证。
- 端口释放 ≠ 进程已退出：进程退出过程中会重建子目录（实测删完又出现只剩 `guard/` 的目录），所以删除后要再 `ls` 一次。
- **原生目录对话框进程也要清**：验证过程中若出现过「选择工作区」弹出的 `osascript … choose folder`，收尾时用 `pgrep -fl "choose folder"` 复查并按需 `kill`——它会一直占着用户桌面、干扰后续 agent。
- **不要重启/杀主实例**（3080）：验证全部在隔离实例里做。

## 步骤 5：报告留档

清单文件由 `--checklist` 生成；功能级项验证后把 `[ ]` 改成 `[x]`。报告结构：

```markdown
# 发版前功能级验证清单 — <插件>@<版本>

验证时间 / 验证环境（端口、DSH_HOME、浏览器）

## 自动验证项（脚本勾选，4 条）

## 功能级验证项（验证者勾选，5 条）

## 验证记录（手写证据：命令与输出、探针 JSONL、退出码、环境限制）
```

- `--check` 只解析 `## 功能级验证项` 段（到下一个 `## ` 为止），所以证据可以尽情写在后面的 `## 验证记录` 里。
- **`## 验证记录` 段是你自己的地盘**：脚本重跑只动「自动验证项」，人工段与勾选**逐字节不变**（`--refresh-header` 也只刷新头部两行）—— 写在这里的证据（命令与输出、探针 JSONL、未覆盖项与环境限制）不会被下一次 `--checklist` 抹掉。
- 如实记录**未验证项与环境限制**（无凭据、无 agent 事件、权限被拒等），不要把没跑过的写成通过。
- 清单随发版 commit 提交（历史留痕在 git；下次发版生成新文件后旧清单即可删除，见 `verification/README.md`）。
