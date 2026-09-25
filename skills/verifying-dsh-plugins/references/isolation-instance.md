# 起隔离实例（独立 DSH_HOME + 独立端口）

> 本文件是 [SKILL.md](../SKILL.md)「步骤 1」的完整细节。功能级验证的一切都在**隔离实例**里做，绝不碰主实例（web 默认 3080）。

## 端口与目录约定

先确认端口空闲：`lsof -ti :3099 || echo 空闲`。**不要**用主实例端口，也不要重复用别人的验证端口。

## 前置（硬性）：两处禁用来源 —— 隔离实例可能"继承"生产的插件禁用名单

**禁用位有两处独立来源**，只处理其一不等于干净：

| 来源                | 位置                                                            | `verify-real-profile.mjs` 复刻时  |
| ------------------- | --------------------------------------------------------------- | --------------------------------- |
| dshmarket 启停开关  | `<profile>/.dsh-market/state.json`（`{"disabled":[...]}`）        | 已剥离并打印提示                  |
| profile 的 patch 行 | `<profile>/cordis.patch.yml` 里 `- id: <插件>` + `disabled: true` | **不剥离** → 被原样复刻进隔离实例 |

```bash
cat ~/.dsh/profiles/<profile>/.dsh-market/state.json | head -c 300    # 来源 1
grep -B1 'disabled: true' ~/.dsh/profiles/<profile>/cordis.patch.yml  # 来源 2
```

被禁用的插件**被加载但不运行**：client bundle 不进 `window.__DSH_BOOT__.entries`、侧边栏页签不出现、API 404 —— 与"插件坏了"表现一样，排查方向却完全相反：**先查这里，再查插件代码**。

### 正确做法：在隔离副本内去掉 `disabled`，生产配置不动

功能级验证要求待验插件**处于启用态**。修法**只在隔离副本里**做（`~/.dsh/profiles/` 一个字节都不改）：

```bash
# 1) 起隔离实例（副本目录 /tmp/dsh-verify-real-<port>）；--keep 让它留存
node scripts/verify-real-profile.mjs --addons plugins/<名> --port 3099 --keep
# 2) 只在副本的 patch 里删掉待验插件那一行的禁用位（生产不动）
perl -0pi -e 's/^- id: <插件id>\n  disabled: true\n/- id: <插件id>\n/m' \
  /tmp/dsh-verify-real-3099/profiles/web/cordis.patch.yml
grep -A1 '^- id: <插件id>' /tmp/dsh-verify-real-3099/profiles/web/cordis.patch.yml  # 确认已无 disabled
```

- 隔离实例的 `watchUserPatches` **热重载** patch 改动，不必重启实例；页签/client 席位随即出现。
- **3c 门禁已对禁用位 fail-closed**：`--addons` 的插件若在组合配置里带 `disabled: true`，`dump-config` 阶段直接判失败，原因点名「在组合配置中被禁用（entry id=… ）—— 插件被加载但不会真正运行」，不会再静默通过。判据只针对**本次 `--addons` 的那几个插件**，dump 里别的插件被故意禁用不受影响。
- 排查口径判定见 [docs/踩坑/README.md](../../../docs/踩坑/README.md)。**验证环境的"少加载"与插件的"坏掉"表现一样，排查方向却完全相反。**

## 前置（硬性）：工作区 —— 没有工作区 = 合成器禁用 = 可能卡死

隔离实例 / 新会话**没有工作区**时，GUI 合成器处于**禁用**态（占位文案「选择工作区」、发送按钮 `disabled`）。此时去点「添加工作区 / 选择工作区」会命中宿主 `@deepseek-ai/dsh-host-directory-picker-auto`：它在 macOS 桌面会话判定为 `native` → 弹**原生 macOS 目录对话框**（`osascript … choose folder with prompt "Select Workspace Directory"`）。`agent-browser` / CDP 只能驱动页面 DOM，**无法操作原生弹窗** → agent 静默卡死（实测可卡数天，`ps` 里积累多个 `choose folder` 进程）。完整记录见 [docs/踩坑/README.md](../../../docs/踩坑/README.md)。

修法（按优先级）：

1. **优先让用户事先选好工作区**（用用户已有的目录）——涉及 GUI 的验证任务，不要把「需要人点原生对话框」的步骤留给无人值守的 agent；需要工作区就直接问用户，不要自建空工作区。
2. 隔离实例必须**预置工作区状态**，二选一：
   - **预置落盘状态（推荐用现成入口）**：`node scripts/verify-real-profile.mjs --addons plugins/<插件> --port 3099 --workspace <目录> --keep` 会写好 `storages/workspace.json` 并回读校验。手工写时的硬约束：`unit` 必须是 `{ name: 'workspace', version: 2 }`，`global.initialized: true` 且 `global.workspaceIds` 收录该 uuid，`tables.workspaces.<uuid> = { path, title, sessionIds, createdAt, updatedAt }`；**`path` 必须是 realpath（macOS 上写 `/tmp/...` 会 `session/workspace-attach-failed`，`/tmp` 是 `/private/tmp` 的软链）、`createdAt`/`updatedAt` 必须是 ISO 字符串**（写数字时间戳 → 隐性 Zod 校验失败 → 实例**启动即失败**）；
   - **替换 picker**：`--patch` overlay 把 `directory-picker` 那一行换成 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览，浏览器可驱动；替换该行而非并存）。

派发验证 agent 时，prompt 必须写明**工作区从哪来**（谁提供、路径、是否已预置）。

## A. web 实例（client UI / 浏览器验证，推荐）

```bash
# 复刻生产 profile 配置组合到 /tmp/dsh-verify-real-3099（独立 DSH_HOME），--keep 让实例保持运行
node scripts/verify-real-profile.mjs --addons plugins/<name> --port 3099 --keep \
  > /tmp/dsh-verify-real-3099.console.log 2>&1
# 健康检查：新版无 token 时根路径返回 401 也算已监听（脚本据此判"端口活着"，
# 但**就绪判定还要看日志就绪行 + 进程存活**，见 SKILL.md「门禁机制」的 fail-closed 判据）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/
```

- 实例输出自 issue #257 起**落盘**在隔离 DSH_HOME 的 `dsh-web.log`（`--keep` 时可直接读；旧的"日志见 /tmp/…"提示已失效）。
  **实例起不来 / 崩溃时，第一手证据就在这里**（`plugin tree failed to load`、cordis 栈等），脚本失败时会打印该路径与摘要 —— 不要只看脚本控制台：崩溃栈可能晚于脚本读日志才落盘。
  健康实例该文件只有一行：`dsh web: http://127.0.0.1:<port>/?token=…`。
- **凭据怎么来的**：隔离 `DSH_HOME` 是全新目录，**不落任何凭据文件**。脚本启动前做凭据自检，并把生产 `<DSH_HOME>/.credentials.yaml` 的 `refs:` 里**被 provider 段引用到**的那些作为**子进程环境变量**注入（宿主凭据层次里 inherited environment 只读且胜出），真实模型调用因此开箱可用；缺字段时**启动前就报错**并给补法，不会拖到 `MISSING_CREDENTIAL`。凭据不打印、不进日志、不写进隔离目录；`--no-credentials` 显式关闭（只做配置组合检查时用）。
- `--api-path /<路由>` 可对 server 端路由做 200 冒烟，但 **⚠️ 需要浏览器会话**：DSH web 有认证层，非交互环境拿不到访问 token，这一项会**显式失败**。
  **API 断言怎么算**：在浏览器步骤里带 token 打开实例、从 devtools/Network 或页面行为确认路由可用；**不要**因为 `--api-path` 失败就判定"插件路由异常"，也不要为此删掉检查。
  （背景：那个失败**曾经**被写成"插件 server 端未生效或路由异常"，把排查引向插件代码 —— 现已改为显式归因到脚本与凭据。）
- 需要工作区状态时加 `--workspace <目录>`：脚本自动取 realpath 并写入隔离 `DSH_HOME` 的 `storages/workspace.json`（该文件有隐性 Zod 校验，手工写极易启动失败，见上「前置」）。

**前置检查（硬性）：先确认 realpath 解析到的是工作区版本，而不是主工作区旧版**

```bash
readlink /tmp/dsh-verify-real-3099/profiles/web/node_modules/<插件>   # 软链原始目标
realpath /tmp/dsh-verify-real-3099/profiles/web/node_modules/<插件>   # 期望 = 待验工作区路径
```

- 期望形如 `/private/tmp/<fork>/plugins/<插件>`；若指向 `/Users/<you>/IdeaProjects/my-dsh-plugins/...`（主工作区），**验的是主工作区旧版**，结论无效（假通过会把未验证的修复发出去，假失败会让人去改本来正确的代码）——完整复盘见 [docs/踩坑/README.md](../../../docs/踩坑/README.md)；
- 脚本自 #220 起在**实例启动前**打印并校验该路径（`--addons` 显式优先于复用生产 profile 软链，不一致直接 exit 1）。输出里没有这两行、或指向主工作区 → **先修脚本/环境再验**，不要手工 `rm` 软链绕过（绕过只救本次，下个 agent 照样踩）。

## B. headless 实例（真实模型调用 / 真实事件流，无浏览器）

**优先用现成入口**（推荐）：凭据自检 + 注入 + 真实调用断言全在脚本里，不必手工拷凭据：

```bash
node scripts/verify-real-profile.mjs --port 3099 --probe-llm "只回复 PONG，不要调用任何工具"
```

- 自检缺字段时**启动前**就报错（点名字段 / provider route / 补法），不会延迟到 `MISSING_CREDENTIAL`；
- 凭据经**子进程环境变量**注入，不落盘（隔离目录里没有 `.credentials.yaml`），`--keep` 目录也不会留下密钥。

需要自己拼 headless 实例（挂插件、对照组实验）时，才手工给 provider 段与凭据：

```bash
export DSH_HOME=/tmp/dsh-verify-headless     # 独立 DSH_HOME
mkdir -p "$DSH_HOME"
cp ~/.dsh/settings.yaml "$DSH_HOME/"         # provider / 模型选择
cp ~/.dsh/.credentials.yaml "$DSH_HOME/"     # 凭据；验证后随目录一起删（手搓替代做法，注意 0600）
# headless 是 shipped 模板，不能作自定义 profile 目标：先派生子 profile 才挂得上插件
dsh --profile headless-verify --from-default-profile headless --dump-config
dsh plugin --profile headless-verify add link:"$PWD/plugins/<name>"
# 一次性任务：跑完即退，exit 0 = 成功
dsh --profile headless-verify "只回复 PONG，不要调用任何工具"
```

- **对照组 = `--profile headless`（不带插件）**，实验组 = `--profile headless-verify`（带插件）；其余环境完全相同。
- `--from-default-profile <x>` 的 `<x>` 必须是 shipped 模板名（`acp` / `web` / `headless` / `sdk` / `sdk-minimal`——以本机 `dsh` 版本的模板表为准），profile 名要另取一个。
