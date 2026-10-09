# 起隔离实例（独立 DSH_HOME + 独立端口，人工）

> 本文件是 [SKILL.md](../SKILL.md)「步骤 1」的完整细节。功能级验证的一切都在**隔离实例**里做，绝不碰主实例（web 默认 3080）。

## 端口与目录约定

先确认端口空闲：`lsof -ti :3099 || echo 空闲`。**不要**用主实例端口，也不要重复用别人的验证端口。

## 前置（硬性）：两处禁用来源 —— 隔离实例可能"继承"生产的插件禁用名单

**禁用位有两处独立来源**，只处理其一不等于干净：

| 来源               | 位置                                                             |
| ------------------ | ---------------------------------------------------------------- |
| dshmarket 启停开关 | `<profile>/.dsh-market/state.json`（`{"disabled":[...]}`）       |
| profile 的 patch 行 | `<profile>/cordis.patch.yml` 里 `- id: <插件>` + `disabled: true` |

```bash
cat ~/.dsh/profiles/web/.dsh-market/state.json | head -c 300     # 来源 1
grep -B1 'disabled: true' ~/.dsh/profiles/web/cordis.patch.yml   # 来源 2
```

被禁用的插件**被加载但不运行**：client bundle 不进 `window.__DSH_BOOT__.entries`、侧边栏页签不出现、API 404 —— 与"插件坏了"表现一样，排查方向却完全相反：**先查这里，再查插件代码**。

### 正确做法：在隔离副本内去掉 `disabled`，生产配置不动

功能级验证要求待验插件**处于启用态**。修法**只在隔离副本里**做（`~/.dsh/profiles/` 一个字节都不改）：

```bash
# 只在副本的 patch 里删掉待验插件那一行的禁用位（生产不动）
perl -0pi -e 's/^- id: <插件id>\n  disabled: true\n/- id: <插件id>\n/m' \
  /tmp/dsh-verify-real-3099/profiles/web/cordis.patch.yml
grep -A1 '^- id: <插件id>' /tmp/dsh-verify-real-3099/profiles/web/cordis.patch.yml  # 确认已无 disabled
```

- 隔离实例的 `watchUserPatches` **热重载** patch 改动，不必重启实例；页签/client 席位随即出现。
- 排查口径见 [docs/踩坑/README.md](../../../docs/踩坑/README.md)。**验证环境的"少加载"与插件的"坏掉"表现一样，排查方向却完全相反。**

## 前置（硬性）：工作区 —— 没有工作区 = 合成器禁用 = 可能卡死

隔离实例 / 新会话**没有工作区**时，GUI 合成器处于**禁用**态（占位文案「选择工作区」、发送按钮 `disabled`）。此时去点「添加工作区 / 选择工作区」会命中宿主 `@deepseek-ai/dsh-host-directory-picker-auto`：它在 macOS 桌面会话判定为 `native` → 弹**原生 macOS 目录对话框**（`osascript … choose folder with prompt "Select Workspace Directory"`）。CDP / 浏览器自动化只能驱动页面 DOM，**无法操作原生弹窗** → agent 静默卡死（实测可卡数天，`ps` 里积累多个 `choose folder` 进程）。完整记录见 [docs/踩坑/README.md](../../../docs/踩坑/README.md)。

修法（按优先级）：

1. **优先让用户事先选好工作区**（用用户已有的目录）——涉及 GUI 时不要把「需要人点原生对话框」的步骤留给无人值守的 agent；需要工作区就直接问用户，不要自建空工作区。
2. 隔离实例必须**预置工作区状态**，二选一：
   - **预置落盘状态**：写 `<DSH_HOME>/storages/workspace.json`。硬约束：`unit` 必须是 `{ name: 'workspace', version: 2 }`，`global.initialized: true` 且 `global.workspaceIds` 收录该 uuid，`tables.workspaces.<uuid> = { path, title, sessionIds, createdAt, updatedAt }`；**`path` 必须是 realpath（macOS 上写 `/tmp/...` 会 `session/workspace-attach-failed`，`/tmp` 是 `/private/tmp` 的软链）、`createdAt`/`updatedAt` 必须是 ISO 字符串**（写数字时间戳 → 隐性 Zod 校验失败 → 实例**启动即失败**）；
   - **替换 picker**：`--patch` overlay 把 `directory-picker` 那一行换成 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览，可驱动；替换该行而非并存）。

## A. web 实例（client UI / 浏览器验证，推荐）

```bash
export DSH_HOME=/tmp/dsh-verify-real-3099          # 独立 DSH_HOME：配置、storages、日志全落这里
mkdir -p "$DSH_HOME/profiles"
cp -R ~/.dsh/profiles/web "$DSH_HOME/profiles/web" # 复刻生产配置组合（插件行 + cordis.patch.yml）
cp ~/.dsh/settings.yaml "$DSH_HOME/"               # 模型/provider 选择（按需）
dsh plugin --profile web add link:"$PWD/plugins/<name>"   # 待验插件链到工作区源码（未装过时才需要）
dsh --profile web --port 3099 --no-open            # 起实例；--port 必须避开 3080
```

- 实例日志落盘在 `$DSH_HOME/dsh-web.log`。**实例起不来 / 崩溃时第一手证据就在这里**（`plugin tree failed to load`、cordis 栈等）。健康实例该文件只有一行：`dsh web: http://127.0.0.1:<port>/?token=…`。
- **启动成功 ≠ 实例活着**：`dsh web` **先监听端口、后加载插件树**，插件 `apply` 崩掉时端口照样能回 HTTP。就绪判据必须三条同时满足——端口有 HTTP 响应 **+** 日志出现正向就绪行 **+** 进程仍存活。
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/`：新版无 token 时根路径返回 401 也算已监听（**只证明端口活着，不证明实例可用**）。
- 凭据：隔离 `DSH_HOME` 是全新目录，**不要**把生产的 `.credentials.yaml` 整份拷进去（会落盘明文）。需要真实模型调用时按 [verification-steps.md](verification-steps.md) 用**环境变量**注入，或只做不需要模型的验证。
- 浏览器打开 `http://127.0.0.1:3099/?token=…`（token 见日志就绪行），人工走查见 [verification-steps.md](verification-steps.md) 步骤 3。

**前置检查（硬性）：先确认 realpath 解析到的是工作区版本，而不是主工作区旧版**

```bash
readlink /tmp/dsh-verify-real-3099/profiles/web/node_modules/<插件>   # 软链原始目标
realpath /tmp/dsh-verify-real-3099/profiles/web/node_modules/<插件>   # 期望 = 待验工作区路径
```

- 期望形如 `/private/tmp/<fork>/plugins/<插件>`；若指向 `/Users/<you>/IdeaProjects/my-dsh-plugins/...`（主工作区），**验的是主工作区旧版**，结论无效（假通过会把未验证的修复发出去，假失败会让人去改本来正确的代码）——完整复盘见 [docs/踩坑/README.md](../../../docs/踩坑/README.md)。
- 指向主工作区时**重做副本**（`rm -rf "$DSH_HOME"` 后重来），不要手工 `rm` 软链绕过——绕过只救本次，下个 agent 照样踩。

## B. headless 实例（真实模型调用 / 真实事件流，无浏览器）

```bash
export DSH_HOME=/tmp/dsh-verify-headless     # 独立 DSH_HOME
mkdir -p "$DSH_HOME"
cp ~/.dsh/settings.yaml "$DSH_HOME/"         # provider / 模型选择
# headless 是 shipped 模板，不能作自定义 profile 目标：先派生子 profile 才挂得上插件
dsh --profile headless-verify --from-default-profile headless --dump-config
dsh plugin --profile headless-verify add link:"$PWD/plugins/<name>"
# 一次性任务：跑完即退，exit 0 = 成功
dsh --profile headless-verify "只回复 PONG，不要调用任何工具"
```

- **对照组 = `--profile headless`（不带插件）**，实验组 = `--profile headless-verify`（带插件）；其余环境完全相同。
- `--from-default-profile <x>` 的 `<x>` 必须是 shipped 模板名（`acp` / `web` / `headless` / `sdk` / `sdk-minimal`——以本机 `dsh` 版本的模板表为准），profile 名要另取一个。
- 凭据：优先用**环境变量**（宿主凭据层次里 inherited environment 只读且胜出），需要落盘时才 `cp ~/.dsh/.credentials.yaml "$DSH_HOME/"` 并 `chmod 600`；验证后随目录一起删。缺字段时报 `MISSING_CREDENTIAL`——那是**验证环境**问题，绝不是插件缺陷。

## 收尾：停实例

```bash
lsof -ti :3099 | xargs kill
```

完整五步清理复查见 [verification-steps.md](verification-steps.md) 步骤 4。
