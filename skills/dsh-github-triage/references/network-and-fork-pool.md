# 网络前置、Dependabot 复查与 fork 池（dsh-github-triage references）

> 承接 [../SKILL.md](../SKILL.md)：本机到 GitHub 的通路实测、已关闭 Dependabot 告警复查、fork 池隔离方案与手工 5 步兜底。
> 全部结论与数字来自本仓库**实测**（含真实事故复盘），不是通用建议。

## 网络前置（必读，实测）

本机到 GitHub 的**唯一可靠通路是「代理 + HTTP/1.1」**，其它通路都会卡死——**并发派发子代理前必须先跑本节的自检**，否则典型症状是「开 2~3 个子代理后 GitHub 操作全部不可用」（实测数据）：

| 通路                    | 实测结果                                                                   | 判定            |
| ----------------------- | -------------------------------------------------------------------------- | --------------- |
| https 直连              | ~10 KB/s（codeload 拉 217 KB 耗时 20s）                                    | ❌ 不可用       |
| https + 代理 + HTTP/2   | `fatal: Error in the HTTP2 framing layer`                                  | ❌ git 直接失败 |
| https + 代理 + HTTP/1.1 | 单并发 53s / 3 并发 78s（浅克隆）                                          | ✅ 下行主力     |
| SSH `git@github.com`    | 上行 push 正常（秒级），**下行 clone 180s 超时 / `unexpected disconnect`** | ✅ 仅用于 push  |
| 代理带宽                | 273 KB/s（4 路混合并发实测总耗时 4s）                                      | 重负载需节制    |

**分流是本方案的核心**（代理不稳定时仍能干活）：`fetch` 走 https+代理（快），`push` 走 SSH（**完全不经过代理**）。每个仓库设一次：

```bash
git remote set-url origin https://github.com/<owner>/<repo>.git       # fetch：https + 代理
git config remote.origin.pushurl git@github.com:<owner>/<repo>.git    # push：SSH，代理挂了照样能推
```

`ghops push` 内部就是 `git push origin`（SSH 无需 token），对该分流透明。只读操作（fork 派生、log、测试）走 `git clone --local` **零网络**，代理挂掉完全不受影响；`ghops` 的 API 层另有内建降级（探测失败自动直连并提示一次）。

三层配置缺一层就退化为卡死，全部在 `~/.dsh/secrets/github-proxy` 与 git 全局配置里持久化：

```bash
# 1) git：强制 HTTP/1.1 + 走代理（缺这层 → HTTP2 framing 崩溃）
git config --global http.version HTTP/1.1
git config --global http.proxy http://127.0.0.1:7890
git config --global http.lowSpeedLimit 1000 && git config --global http.lowSpeedTime 60

# 2) ghops：代理写文件（缺这层 → API 直连 10 KB/s，多子代理并发即集体卡死）
printf 'http://127.0.0.1:7890' > ~/.dsh/secrets/github-proxy && chmod 600 ~/.dsh/secrets/github-proxy

# 3) 自检（派发前跑，3 秒出结论）
gh-net check                             # 一键自检（见下）；没有该脚本时用后两行
ghops proxy                              # 期望：当前代理 http://127.0.0.1:7890 / 可用性：正常
git ls-remote origin refs/heads/main     # 期望：<10s 返回 SHA
```

**代理不稳定时的四层保障**：本机装有 `~/.local/bin/gh-net`（即上文配置的固化版 + 两条应急通路，`gh-net help` 看全集）：

| 命令                               | 作用                                                                                                                                    | 何时用                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `gh-net check`                     | 3 秒自检：代理端口 / HTTP 探测 / git 配置 / ghops / 本地镜像                                                                            | **派发子代理前必跑**                |
| `gh-net status`                    | 详细状态：代理与直连的**实测下载速率**、git 配置、远端分流、镜像清单                                                                    | 怀疑变慢时                          |
| `gh-net fix`                       | 按探测结果重配；**代理挂掉时自动清空 `http.proxy` 与 ghops 代理文件退回直连**（慢但不会全挂），代理恢复后再跑一次即回到代理通路（幂等） | 报 framing / Empty reply / 无响应时 |
| `gh-net fetch-mirror [owner/repo]` | 建立 / 增量更新**本地裸镜像**（`~/.cache/dsh/git-mirrors/`）                                                                            | 代理不稳、想彻底摆脱网络依赖时      |
| `gh-net rescue <owner/repo> [dir]` | **加速站应急只读拉取**：自动测速选站、不走代理，拉完自动把 remote 修正回 GitHub（fetch 走代理 / push 走 SSH）                           | 代理全挂、急需一份代码时            |

镜像的价值：建立后 `git clone --local ~/.cache/dsh/git-mirrors/<owner>_<repo>.git /tmp/work` 可**零网络、0 秒**派生工作副本（实测 18M 镜像 → 派生 0s；增量更新 2s），fork 池也可以镜像为源而不占用主工作区。`rescue` 实测自动选中 `gh-proxy.com`（149 KB/s）——仅用于公开仓库（内容经第三方转发，git 对象 SHA 校验保证不被篡改）。

**排障对照**：`git clone` 报 `HTTP2 framing layer` → 第 1 层丢失；`ghops` 命令长时间无响应 → 第 2 层丢失；`git ls-remote` 报 `Empty reply from server` → 代理进程没起（`lsof -nP -iTCP:7890 -sTCP:LISTEN` 确认）或跑 `gh-net fix`。

**并发预算**：克隆/推送是唯一重负载。fork 池用 `git clone --local` **本地派生**（零网络，正是为本节问题设计的）——**不要在 fork 内 clone 远程仓库**，也不要把多条 `git fetch` 并发堆在一起。

### Dependabot 已关闭告警必须单独复查（假阴性防线，issue #214）

**为什么**：GitHub 对 npm **development scope** 的告警（含传递依赖）默认开启 auto-dismiss，公开仓库 on-by-default。被自动关闭的告警**不在 open 视图里**，于是「报了但被自动关闭」与「根本没报」表面上无法区分——本仓库就出现过两条 `qs` 告警被静默关闭、多日后才在人工排查里偶然发现的情形，并导致过「Dependabot 未覆盖该链路」的错误结论。**只看 `--state open` 会漏报。**

**怎么查（一条命令，只读）**：

```bash
cd <仓库工作区>
bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh baosfeng/my-dsh-plugins .
```

它做三件事：① 列出**全部已关闭**的 Dependabot 告警（`fixed` / `dismissed` / `auto_dismissed` 都算）；② 逐个核对告警对应依赖是否**仍以受影响版本留在本地 lockfile**（并指出由哪个包引入）；③ 把「已关闭但依赖仍在受影响范围」的单列出来；退出码 1 = 需人工判读，0 = 干净。脚本不可用时的手工等价两步：

```bash
ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot                   # 先人看：状态/包名/严重级
ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot --json > /tmp/db-closed.json
python3 skills/dsh-github-triage/scripts/check-dependabot-closed.py /tmp/db-closed.json --repo-dir .
```

**判读规则**：

| 判据                                                     | 结论                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_dismissed` 且 `dismissed_by`/`dismiss_reason` 为空 | 系统自动关闭（非人工），**必须按事实复核**，不能当成已修复                                                                              |
| 脚本报 `⚠ 仍受影响`                                      | 关闭理由与事实不符 → 升级依赖消除漏洞，按「安全告警」类问题派发                                                                         |
| 脚本报 `✔ 已升到修复版` / `✔ 已不在依赖树`               | 确已修复，无需动作（汇总里记一笔即可）                                                                                                  |
| `state` 是 `fixed` 而查不到 `auto_dismissed_at`          | 依赖升到修复版后 GitHub 会把 auto_dismissed 覆盖成 fixed 并**清空** `auto_dismissed_at`；查不到 ≠ 没发生过，历史只在告警详情页 timeline |

**派发本类问题的 prompt 必带**：巡检脚本原始输出（告警编号/依赖/受影响范围/修复版本）+「先判断是误关还是真已修复」+「修复后复跑同一脚本确认退出码变 0」。

### fork 池（隔离方案，必须遵守）

主 agent 按派发顺序**逐个**准备 fork（不提前批量派生），子 agent **只在自己被分配的 fork 内工作**。

**主路径（一条命令，issue #240）**：

```bash
node scripts/fork-pool.mjs create <编号>            # 等价于下面手工 5 步 + node_modules 就位 + 装 hooks，实测 3.3s
cd /tmp/gh-fork-<编号>                              # 子 agent 从这里开始工作
node scripts/fork-pool.mjs check                    # 推送前自检：hooks / 工具链 / 基线 SHA / 误暂存，四项 yes/no
node scripts/fork-pool.mjs clean <编号> --yes       # 收尾清理（只允许删 /tmp/gh-fork-*）
```

它比手工多做三件事（都是踩过坑才补的）：**基线 SHA 校验**、**node_modules 逐包软链且不漏隐藏的 `.bin`**、
**默认装 hooks**（不装则 commit/push 完全不跑本地门禁，见
[踩坑：fork 池钩子与工具链未就绪](../../docs/踩坑/README.md)）。
可用 `--no-hooks` 关闭装钩子、`--node-modules symlink|copy|none` 换就位策略、`--branch` 换分支名。

**兜底（脚本不可用时的手工 5 步，与脚本等价）**：

```
git -C <主工作区> fetch origin && git -C <主工作区> merge --ff-only origin/main   # ① 先同步主工作区本地 main（fetch 只更新 origin/main 引用、不移动本地 main）
git clone --local <主工作区> /tmp/gh-fork-<编号>               # ② 本地派生 fork：零网络、秒级（实测 ~1.4s）
git -C /tmp/gh-fork-<编号> remote set-url origin https://github.com/baosfeng/my-dsh-plugins.git      # ③ fetch 走 https+代理
git -C /tmp/gh-fork-<编号> config remote.origin.pushurl git@github.com:baosfeng/my-dsh-plugins.git   #    push 走 SSH（不经代理，代理挂了也能推）
git -C /tmp/gh-fork-<编号> fetch origin main                   # ④ 显式从 GitHub 拉一次 main（clone --local 带进来的是主工作区本地 main）
git -C /tmp/gh-fork-<编号> checkout -b fix/<编号> origin/main  # ⑤ 从远程最新 main 建分支（子 agent 直接在其上工作）
```

> ⚠️ **用 `ghops clone` 直接克隆（不走本节 ②③ 流程）时，第 ③ 步不能省**：`ghops clone` 只配 https 的 fetch/push URL，而 https 推送无凭据（实测报 `Invalid username or token. Password authentication is not supported`）。补一条即可（实测）：
>
> ```bash
> git -C /tmp/gh-fork-<编号> remote set-url --push origin git@github.com:baosfeng/my-dsh-plugins.git
> ```
>
> 判据：`git -C /tmp/gh-fork-<编号> remote -v` 的 push 行是 `git@github.com:...`（与主工作区一致）。

> ⚠️ **fork 内 pre-commit / commit-msg / pre-push 钩子默认不生效**（clone 不会跑 `npm install` → `npm prepare` → `husky` 未执行 → `core.hooksPath` 未设置、husky v9 的钩子目录未生成）。后果：lint-staged 不会自动 prettier/eslint 你的改动，门禁要到 CI `quality` job 才暴露——**每个子 agent 都会踩，白烧一轮 CI**（实测：`test/persist-race.mjs` 未格式化 → CI format 红）。一行启用（实测有效：探针提交被 lint-staged 正常拦截）：
>
> ```bash
> git -C /tmp/gh-fork-<编号> config core.hooksPath '<husky 钩子目录绝对路径>'
> ```
>
> 其中 `<husky 钩子目录绝对路径>` = 主工作区 `git config core.hooksPath` 的输出（husky v9 生成，位于主工作区仓库根的钩子目录下）。判据：`git -C /tmp/gh-fork-<编号> config core.hooksPath` 有输出；不想配 hook 的兜底是提交前手动跑 `npx prettier --check . && npx eslint plugins/`。
>
> **更好的一行**（等价且自洽，推荐）：`cd /tmp/gh-fork-<编号> && ./node_modules/.bin/husky` —— 它会生成 `.husky/_` 并写好 `core.hooksPath`。有脚本时直接 `node scripts/fork-pool.mjs check` 即可一眼看出装没装。

规则：

- **每个修复类子任务拥有且仅拥有一个 fork**（`/tmp/gh-fork-<编号>`）；主工作区（`/Users/bsfeng/IdeaProjects/my-dsh-plugins`）与任何其他 fork 都不得被该子任务操作
- fork 用 `git clone --local` **本地派生**：不重复走网络、也不调用 REST API（无速率限制），秒级完成；**不是**远程克隆，主工作区未提交改动不会混入 fork（只含已提交内容）
- **本地派生的 origin 默认指向主工作区本地路径，必须重设为 GitHub 远程**（`set-url` 设 https 给 fetch + `config remote.origin.pushurl` 设 SSH 给 push，理由见上方「网络前置」），否则 push 会推到本地路径（静默失败/污染）
- **基线坑（必读）**：`git clone --local <主工作区>` 的 `origin/main` 取的是**主工作区本地 main**——clone 只把源的 `refs/heads/*` 映射为目标 `refs/remotes/origin/*`，**不复制** remote-tracking refs；而主工作区 `git fetch` 只更新 `origin/main` 引用、**不移动本地 main**。因此 ① 的 `merge --ff-only` 与 ④ 的 fork 内 `git fetch origin main` 缺一不可。**判据**：`git -C /tmp/gh-fork-<编号> log --oneline -1` 与 `git ls-remote origin refs/heads/main` 的 SHA 一致（详见 [踩坑](../docs/踩坑/README.md)）
- **`git cherry` 判不了 squash 合并**：squash 后 patch-id 必然不同，`git cherry -v <main> <branch>` 会对已合并的提交全部标 `+`（假阴性），据此判定「遗留工作未落地」是错的。正确判法：先查 main 历史里的 squash 提交/PR 号（`git log --oneline --grep="#<PR>"`），再比对 `git diff <base>...<branch> | git patch-id --stable` 与 `git show <squash-commit> | git patch-id --stable` 的**第一列**（详见 [踩坑](../docs/踩坑/README.md)）
- **不要让多个子 agent 同时跑全插件测试**：`node scripts/verify-local.mjs --fast` 并发时会 `EXIT=124`（资源竞争，实测两个 agent 同轮都超时），不是代码问题——同一插件同一时刻只允许一个测试进程，以 CI 结果为准或在无竞争时段重跑（见 [多 agent 并行测试资源冲突](../docs/踩坑/README.md)）
- **fork 里跑工具链的依赖软链不要 `git add -A`**：`ln -s <主工作区>/node_modules /tmp/gh-fork-<编号>/node_modules` 之后，`.gitignore` 的 `node_modules/` 规则**不匹配符号链接**，`git add -A` 会把它当新文件暂存（误提交/体积事故）——只 add 自己改动的文件，或先把 `node_modules` 写进 `.git/info/exclude`（本地生效、不进仓库）
- 子 agent 工作流：fork 内修改 → `git commit`（fork 是完整独立 .git，工作区/index/HEAD/分支与其他 fork 及主工作区**物理隔离**，互不可见）→ `ghops push --dir /tmp/gh-fork-<编号> --branch fix/<编号>` → `ghops pr create`
- fork 是完整克隆（不共享对象库），隔离比 worktree 更彻底：两个子任务改动同一文件也互不影响；PR 合并阶段的冲突由后合并方 rebase 最新 main 解决
- 多个子任务可并行（fork 物理隔离保证安全），但**派发必须按编号从小到大**，主 agent 按序验收汇总
- 汇总后主 agent 统一清理：`rm -rf /tmp/gh-fork-<编号>`；已 push 的分支保留在远程，PR 合并后自动删除
- fork 数量 = 修复类问题数量，**完成后必须清理**，避免 /tmp 堆积
- **分析类子任务（只读、不改码）无需 fork**，可在本地主工作区只读操作（git log/config 等）
- **信息严重不足的 BUG issue**（无复现步骤/无报错信息）：不派修复类，直接按分析类派发——先评论索要补充信息；调研中确认根因不在本仓库的同样转分析类，不硬修
