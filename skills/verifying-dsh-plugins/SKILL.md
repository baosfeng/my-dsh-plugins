---
name: verifying-dsh-plugins
description: 使用当 需要做 DSH 插件的发版前功能级验证（issue #67 门禁：隔离实例 + 真实浏览器/真实模型调用），或要复现并证明"只在真实网关、真实事件流、真实浏览器下出现"的问题时。覆盖独立 DSH_HOME 起隔离实例、NODE_OPTIONS=--import fetch 探针做对照组/实验组取证、client UI 与插件联动验收、verification/<插件>-<版本>.md 清单勾选，以及验证后清理环境（防残留污染）。
---

# 发版前功能级验证（verifying-dsh-plugins）

启动成功 ≠ 功能可用。本 skill 是 issue #67 门禁的执行手册：**功能级项必须在隔离实例 + 真实浏览器/真实模型中验证**，勾选 `verification/<插件>-<版本>.md` 才能发版。

## 何时必须做

| 场景                                                    | 要求                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发版（`node scripts/release.mjs <插件名>`，含 dry-run） | release.mjs 3c 强制：自动验证通过后校验功能级清单全勾选，未全勾选**阻断发版**（跳过须 `--skip-real-verify --skip-reason "<理由>"`）                                             |
| 修复"只在真实环境出现"的问题                            | 对照组复现 + 实验组证明修复，两者缺一不可                                                                                                                                       |
| UI / 交互 / 截图变更                                    | 真实浏览器走通 + 重新截图（release.mjs 3b 校验 README 引用的截图存在）。确无用户可见 UI 的插件按 `package.json` 的 `dsh.ui=false` + `dsh.uiReason` 显式豁免，并在发版输出中可见 |
| 插件联动/生命周期相关改动                               | 隔离实例（复用生产配置组合）+ 相邻插件共存验证                                                                                                                                  |

## 门禁机制（release.mjs 3c 实际做什么）

```bash
# 3c 内部执行（bump 后自动跑）：
node scripts/verify-real-profile.mjs --addons plugins/<name> --port <空闲端口> \
  --checklist verification/<name>-<version>.md --plugin <name> --version <version>
# 再执行门禁校验：功能级项必须全部 [x]，否则 exit 1
node scripts/verify-real-profile.mjs --check verification/<name>-<version>.md
```

- **版本约定**：清单文件名里的版本 = bump 后的 next 版本（当前 package.json 版本 +1）。手动预验证时 `--version` 必须与之一致，文件名对不上会被当成新清单重新生成（已勾选状态丢失 → 阻断）。
- 自动项 4 条（配置组合唯一 / 实例就绪 / 日志无 error / API 冒烟）由脚本勾选；**功能级 5 条由验证者勾选**。
- 脚本重跑不覆盖已勾选项（按文案合并），所以可以先预验证再发版。
- 非 bundle 插件（agent preset 等）按自身安装方式验证，手写同格式清单并注明验证方式。

## 步骤 1：起隔离实例（独立 DSH_HOME + 独立端口）

先确认端口空闲：`lsof -ti :3099 || echo 空闲`。**不要**用主实例端口（web 默认 3080），也不要重复用别人的验证端口。

### 前置（硬性）：工作区 —— 没有工作区 = 合成器禁用 = 可能卡死

隔离实例 / 新会话**没有工作区**时，GUI 合成器处于**禁用**态（占位文案「选择工作区」、发送按钮 `disabled`）。此时去点「添加工作区 / 选择工作区」会命中宿主 `@deepseek-ai/dsh-host-directory-picker-auto`：它在 macOS 桌面会话判定为 `native` → 弹**原生 macOS 目录对话框**（`osascript … choose folder with prompt "Select Workspace Directory"`）。`agent-browser` / CDP 只能驱动页面 DOM，**无法操作原生弹窗** → agent 静默卡死（实测可卡数天，`ps` 里积累多个 `choose folder` 进程）。完整记录见 [docs/踩坑/子agent工作区缺失导致卡死.md](../../docs/踩坑/子agent工作区缺失导致卡死.md)。

修法（按优先级）：

1. **优先让用户事先选好工作区**（用用户已有的目录）——涉及 GUI 的验证任务，不要把「需要人点原生对话框」的步骤留给无人值守的 agent；需要工作区就直接问用户，不要自建空工作区。
2. 隔离实例必须**预置工作区状态**，二选一：
   - **预置落盘状态（推荐用现成入口）**：`node scripts/verify-real-profile.mjs --addons plugins/<插件> --port 3099 --workspace <目录> --keep` 会写好 `storages/workspace.json` 并回读校验。手工写时的硬约束：`unit` 必须是 `{ name: 'workspace', version: 2 }`，`global.initialized: true` 且 `global.workspaceIds` 收录该 uuid，`tables.workspaces.<uuid> = { path, title, sessionIds, createdAt, updatedAt }`；**`path` 必须是 realpath（macOS 上写 `/tmp/...` 会 `session/workspace-attach-failed`，`/tmp` 是 `/private/tmp` 的软链）、`createdAt`/`updatedAt` 必须是 ISO 字符串**（写数字时间戳 → 隐性 Zod 校验失败 → 实例**启动即失败**）；
   - **替换 picker**：`--patch` overlay 把 `directory-picker` 那一行换成 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览，浏览器可驱动；替换该行而非并存）。

派发验证 agent 时，prompt 必须写明**工作区从哪来**（谁提供、路径、是否已预置）。

### A. web 实例（client UI / 浏览器验证，推荐）

```bash
# 复刻生产 profile 配置组合到 /tmp/dsh-verify-real-3099（独立 DSH_HOME），--keep 让实例保持运行
node scripts/verify-real-profile.mjs --addons plugins/<name> --port 3099 --keep \
  > /tmp/dsh-verify-real-3099.console.log 2>&1
# 健康检查：新版无 token 时根路径返回 401 也算已就绪（脚本同样只要求有任何 HTTP 响应）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/
```

- `--keep` 的 stdout 提示"日志见 /tmp/dsh-verify-real-<port>.log"——**该文件当前不落盘**，要日志就自己重定向（上面已加）。
- 隔离 DSH_HOME 会复制生产 profile 的 `.credentials.yaml`（真实凭据），验证后必须删目录。
- 加 `--api-path /<路由>` 可对 server 端路由做 200 冒烟（纯事件型插件无路由，不加）。
- 需要工作区状态时加 `--workspace <目录>`：脚本自动取 realpath 并写入隔离 `DSH_HOME` 的 `storages/workspace.json`（该文件有隐性 Zod 校验，手工写极易启动失败，见下「前置」）。

**前置检查（issue #220，硬性）：先确认 realpath 解析到的是工作区版本，而不是主工作区旧版**

```bash
readlink /tmp/dsh-verify-real-3099/profiles/web/node_modules/<插件>   # 软链原始目标
realpath /tmp/dsh-verify-real-3099/profiles/web/node_modules/<插件>   # 期望 = 待验工作区路径
```

- 期望形如 `/private/tmp/<fork>/plugins/<插件>`；若指向 `/Users/<you>/IdeaProjects/my-dsh-plugins/...`（主工作区），**验的是主工作区旧版**，结论无效（假通过会把未验证的修复发出去，假失败会让人去改本来正确的代码）——完整复盘见 [docs/踩坑/隔离实例复用主工作区插件软链导致假验证.md](../../docs/踩坑/隔离实例复用主工作区插件软链导致假验证.md)；
- 脚本自 #220 起在**实例启动前**打印并校验该路径（`--addons` 显式优先于复用生产 profile 软链，不一致直接 exit 1）。输出里没有这两行、或指向主工作区 → **先修脚本/环境再验**，不要手工 `rm` 软链绕过（绕过只救本次，下个 agent 照样踩）。

### B. headless 实例（真实模型调用 / 真实事件流，无浏览器）

```bash
export DSH_HOME=/tmp/dsh-verify-headless     # 独立 DSH_HOME
mkdir -p "$DSH_HOME"
cp ~/.dsh/settings.yaml "$DSH_HOME/"         # provider / 模型选择（本机：opencode-go + deepseek-flash）
cp ~/.dsh/.credentials.yaml "$DSH_HOME/"     # 凭据；验证后随目录一起删
# headless 是 shipped 模板，不能作自定义 profile 目标：先派生子 profile 才挂得上插件
dsh --profile headless-verify --from-default-profile headless --dump-config
dsh plugin --profile headless-verify add link:"$PWD/plugins/<name>"
# 一次性任务：跑完即退，exit 0 = 成功
dsh --profile headless-verify "只回复 PONG，不要调用任何工具"
```

- **对照组 = `--profile headless`（不带插件）**，实验组 = `--profile headless-verify`（带插件）；其余环境完全相同。
- `--from-default-profile <x>` 的 `<x>` 必须是 shipped 模板名（headless/web/tui），profile 名要另取一个。

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

实测样例（2026-09-11，`dsh-my-opencode-session-header@0.1.0`）：

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
| 环境已清理     | 见步骤 4 的四步复查全部通过                                                        |

补强（推荐）：新功能/新插件用**盲测子 agent**（不了解实现的独立上下文）以真实用户视角操作 GUI，输出问题分级清单。

## 步骤 4：收尾清理（强制，防残留污染）

多插件/多 agent 并行时，验证残留会互相干扰（本仓库已踩坑）。按顺序做完并**复查**：

```bash
lsof -ti :3099 | xargs kill                                   # ① 停实例
for i in 1 2 3 4 5; do lsof -ti :3099 >/dev/null 2>&1 || break; sleep 1; done
rm -rf /tmp/dsh-verify-real-3099 /tmp/dsh-verify-headless     # ② 删隔离目录
ls -d /tmp/dsh-verify-real-3099 2>&1 || echo "目录已删除"      # ③ 复查：删完再看一眼
ps aux | grep -c "[d]sh --profile headless"                   # ④ 无残留进程（应为 0）
pgrep -fl "choose folder"                                     # ⑤ 无遗留的原生目录对话框进程（应为空，见「步骤 1 前置」）
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:3099/  # 应无响应（curl exit 7）
```

- **只杀自己起的端口/只删自己的目录**：`/tmp/dsh-verify-*` 下可能有别的 agent 正在用的实例，误删会打断别人的验证。
- 端口释放 ≠ 进程已退出：进程退出过程中会重建子目录（实测删完又出现只剩 `guard/` 的目录），所以删除后要再 `ls` 一次。
- **原生目录对话框进程也要清**：验证过程中若出现过「选择工作区」弹出的 `osascript … choose folder`，收尾时用 `pgrep -fl "choose folder"` 复查并按需 `kill`——它会一直占着用户桌面、干扰后续 agent（见 [docs/踩坑/子agent工作区缺失导致卡死.md](../../docs/踩坑/子agent工作区缺失导致卡死.md)）。
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
- 如实记录**未验证项与环境限制**（无凭据、无 agent 事件、权限被拒等），不要把没跑过的写成通过。
- 清单随发版 commit 归档进 `verification/`。

## 参考

| 文件                                               | 内容                                                           |
| -------------------------------------------------- | -------------------------------------------------------------- |
| [scripts/fetch-probe.mjs](scripts/fetch-probe.mjs) | `NODE_OPTIONS=--import` fetch 探针（JSONL 记录会话头/鉴权头）  |
| `scripts/verify-real-profile.mjs`                  | 隔离实例 + 配置组合检查 + 清单生成/校验（release.mjs 3c 调用） |
| `docs/开发指南/构建与测试.md`                      | issue #39 / #67 门禁说明与清单版本约定                         |
| `skills/plugin-test/SKILL.md`                      | 测试层级选择（本 skill 负责真实环境那一层）                    |
