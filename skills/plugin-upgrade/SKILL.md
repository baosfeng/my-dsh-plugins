---
name: plugin-upgrade
description: 使用当 需要处理 DSH 宿主或插件的版本升级时——四种模式：只读检查可用更新（inspect）、升级已安装插件（update）、把插件源码仓迁移到新宿主版本（author-migrate）、审计两个 DSH 版本之间仓库外消费者可观察的一切变化（audit：npm 公共 API / dsh CLI / 线上协议 / 会话落盘数据 / 模型可见面，产出 UPGRADE-ADAPTATION.md 并判定"更多改动"还是"回滚"）。含 pre-flight 七类触点预检、幽灵宿主检查、运行时精确版本验证与升级排障。用户意图不明确时先确认模式，不要从“帮我看看更新”自行滑入安装或改代码。
---

# plugin-upgrade

安全完成四类任务：只读更新检查、已安装插件升级、DSH 宿主版本兼容迁移、两版本间兼容性审计。若用户意图不明确，先确认模式；不要从“帮我看看更新”自行滑入安装或改代码。

## 第 0 步：选择模式

| 模式               | 用户意图                                      | 允许的默认动作                                             |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------- |
| A · inspect        | 检查更新、判断是否受某版 DSH 影响             | 只读调查与报告；完成后停止                                 |
| B · update         | 把已安装插件升级到明确版本                    | 先计划和确认，再改 composition/依赖                        |
| C · author-migrate | 插件作者把自己源码仓适配到新版 DSH 宿主       | 先跑基线、扫七类触点，再实施已授权迁移                     |
| D · audit          | 审计两个 DSH 版本之间仓库外消费者可观察的变化 | 只读；物化两棵树 → 立共享事实 → 并行面扫描 → 核验 → 写报告 |

本 skill 不负责“只升级 DSH core 且不处理插件”；也不允许修改 DSH core 来掩盖插件兼容问题。

## 全局 DSH 宿主升级（代理纪律）

升级 dsh 宿主本身（`npm install -g @deepseek-ai/dsh@…`）不属于模式 B/C 的插件工作——而且当发起请求的代理本身就运行在 dsh 会话**内部**时，这是结构性致命操作：会话就是宿主进程，npm 会拆除它正在执行的包树，宿主在安装中途死亡（工具调用不会有结果返回），中断的安装留下「包内容在、shim 未重新生成」的残缺状态——`dsh` 命令本身失效，只能靠外部钉版本的重新安装修复。绝不要在运行于该宿主上的会话内部执行全局宿主升级；把外部流程交给用户：

1. 完全停止所有 dsh 进程（运行中的宿主持有原生模块文件锁 → EBUSY；刷新浏览器不等于停止宿主）；
2. 在**外部**终端执行钉版本的安装 `npm install -g @deepseek-ai/dsh@<精确版本>`（裸包名会解析到 `latest` dist-tag，可能静默降级到旧线）；
3. 重启 `dsh web`、浏览器硬刷新，核验版本标记与插件。

因为 npm 运行前宿主已完全停止，安装中途不会有任何进程崩溃——升级过程中的崩溃是做错了的标志，而不是需要容忍的风险。若安装已被中断：在外部 shell 重跑钉版本的正式安装修复（绝不手动复制包目录或手写 shim）。

## 通用只读准备

1. 阅读目标仓库的 `AGENTS.md` / `CLAUDE.md` 等规则；检查 branch、HEAD、working tree、submodule。发现陌生修改或未跟踪文件就停止并报告，不自动 stash/reset/clean/checkout。
2. 分开记录代码来源与安装身份：registry 包、Git checkout、workspace/junction 或复制安装；记录来源仓库/URL、Git SHA、实际包名、插件自身版本、declared/resolved DSH 依赖 cohort 与当前 DSH/Node 版本。插件发版版本（如 `0.6.4 → 0.7.0-alpha.0`）不是 DSH 宿主走廊（形如 `<fromTag> → <toTag>` 的宿主版本对）。GitHub owner/repo 与 registry scope/package 是独立坐标，不能从前者推导或改写后者。
3. 区分文件所有权：`package.json` / lockfile 是包与依赖；`cordis.patch.yml` / 历史 `cordis.yml` 是 profile composition（`agent.cordis.yml` 机制已移除，不在 composition 类型内）；resolved config 是运行时组合结果，只用于核对，不整对象回写。官方 manifest 只有 `package.json` 下的 `dsh.bundle` / `dsh.profile` / `dsh.client`；社区标准 manifest `dsh-plugin.json` 是**可选社区产物、非官方**，仅在目标仓库确实采用时才列入清单。
4. 核对目标版本来源、tag/包名、兼容范围、release notes、安装脚本与已知 breaking changes。不读取、打印或提交 token、`.npmrc` 内容、凭据或会话日志。
5. 记录回滚基线：当前 HEAD/包版本、lockfile 与将改配置的 hash/路径；说明失败后如何恢复本次明确路径，不要承诺回滚第三方安装脚本的任意副作用。

## 模式 A · inspect（只读）

输出：当前/可用版本、来源、兼容范围、breaking changes、建议目标、风险与验证计划。不得改文件、安装依赖、执行 lifecycle script、`git pull` 或切换版本。用户若决定执行，再进入模式 B 或 C 并单独确认。

## 模式 B · update（升级已安装插件）

1. 按实际解析的包身份与安装轨选择唯一更新方式；有 lockfile 时只使用对应包管理器，不混用 npm/pnpm/bun，也不为匹配 GitHub owner 而改写 registry 包名。
2. 生成变更计划：精确目标版本、将执行的命令、会改的文件、可能执行的生命周期脚本、配置迁移和回滚步骤。
3. 任何写入或安装前取得用户明确确认；即使没有 breaking change 也一样。
4. 在独立 branch/worktree 中做最小修改；配置用路径级 patch，保留未知字段。Git 来源先 fetch/比较明确 tag 或 commit，不对脏工作区直接 `git pull`。
5. 安装依赖成功不等于 DSH 已启用插件；核对目标 profile 的 composition 确实解析到目标包，若存在则移除本次升级拥有的旧来源行，并确认运行时 entry active。
6. 按“验证与报告”执行；失败时只恢复本次拥有的路径并报告残留副作用。

## 模式 C · author-migrate（插件作者升级源码仓）

0. 先跑 baseline：在仓库自身依赖状态（不 pin 目标、不设目标 env）运行机械套件（build / typecheck / tests；属运行包脚本，先按安全边界展示将执行的命令并取得确认），记录 pre-existing 失败为豁免清单。迁移不得新增或恶化失败。
1. 用精确 tag 确认 from/to；起点早于任何可得一手来源时标为 unsupported gap，改用精确 tag 源码、packed 声明与可复现测试取证，不假装有覆盖。
2. 按 [pre-flight.md](references/pre-flight.md) 扫七类触点：源码 patch、内部事件名、内部服务探针、宿主目录直读写、内部 UI 与命令注册、自建 HTTP/WS/RPC/DOM/CSS 通道、子进程与 stdout/stderr 解析。可先运行只读的 [migration planner](scripts/plan-migration.mjs) 生成路径/行号与计划草稿，但结果仍是启发式；零命中仍须查依赖/导入并跑构建与真实挂载。
3. 按目标 tag 的源码与 packed 声明为每个命中触点取证；缺 API 坐标时标 unsupported/待确认，不凭记忆改。
4. 生成按 Host / Web Client seam 分组的迁移计划，列命中文件、目标行为与测试；取得确认后再在独立 branch/worktree 实施。`package.json` 与 lockfile 必须保持精确且同一 DSH cohort；安装成功但旧新 peer 混装不算完成。selector 或 callback 意外变成 `any` 时，临时用 `skipLibCheck: false` 做一次诊断，并把实际声明所有者补成直接依赖。
5. 兼容修改通过后，单独确定并修改插件自身 SemVer；核对 packed 文件名和 packed manifest 都是该插件版本，不能误把宿主 DSH 版本当成插件发版版本。
6. 落地后按“验证与报告”逐层验证，把未取证项与残留风险写进报告。

## 模式 D · audit（两版本间兼容性审计）

固定问题：**相对 `from` 而言，`to` 是否有更多改动或回滚？**"更多改动" = 外部可见的破坏（导出删除、线上错误码改名、数据格式拒读）；"回滚" = `from` 中存在的行为在区间内被 revert 蓄意撤回。两者都要证据：commit message 与子代理摘要只是**主张**，只有对两棵树（源码文件或已发布包）读过之后的结论才是证据。外部兼容 = 仓库外消费者能观察到的一切（npm 公共 API / `dsh` CLI / 线上协议 SDK JSON-RPC、网关、ACP、hooks / 会话落盘数据 / 模型可见面）；内部重构只作背景，聚合计数即可。[audit-playbook.md](references/audit-playbook.md) 含六面目标路径清单、侦察派发模板与报告骨架。

**输入与模式**（按特异性从高到低）：① 用户点名的 deepseek-harness 检出；② `DSH_SOURCE_PATH`（可选 `DSH_NPM_REGISTRY`）；③ CWD 就是该检出；④ 都没有 → **npm 模式**（默认）：下载两版已发布包。npm 模式两条边界：**npm 版本集 ≠ git tag 集**（打了 tag 未发布的版本，物化脚本带已发布清单退出——把缺口摆给用户，不要自行替换版本对）；CLI 闭包不含全部可发布包（SQLite 存储/查询后端以补充包安装，当前是 `@deepseek-ai/dsh-storage-sqlite` 与 `@deepseek-ai/dsh-session-query-sqlite`）。

**输出契约**：全部落在 `tmp/<fromNorm>-to-<toNorm>/`（规范化：去 `dsh-v`、预发布段去点）；源码模式建在检出内，npm 模式建在当前项目内。目录已存在多半是先前手工报告——**先停下问，不要覆盖**。产物：`commits.txt`/`reverts.txt`、`files.txt`/`diffstat.txt`/全量 `.diff`（npm 模式换成 `manifest-diff.txt` + `a/`、`b/` 已发布树）、`CHANGELOG.md`（**必须有 Reverts 分节**）、`UPGRADE-ADAPTATION.md`（两模式同骨架，头部记模式与版本出处）。报告语言跟随用户语言。

1. **物化两棵树**：源码模式先验纯度——`git merge-base <from> <to>` 必须等于 `from` 本身，否则基线漂移，**停下报告**，不能对着移动的基线做 diff（源码模式的物化脚本已裁剪，无检出时直接用 npm 模式）。npm 模式 `node skills/plugin-upgrade/scripts/materialize-npm.mjs <from> <to> tmp/<pair>`：解析两版、以 `--ignore-scripts` 把闭包装进 `a/`/`b/`、逐包 manifest diff、并从公开 GitHub 富化 `commits.txt`/`reverts.txt`（所以无源码检出也能做回滚检测）；`from` 落在 SQLite 包拆分之前时用 `--packages` 指定该版本实际发布的旧包名。包计数与 manifest-diff 覆盖面一律以 [`lib/npm-tree.mjs`](scripts/lib/npm-tree.mjs) 为准：它递归**所有层级**的 `node_modules/@deepseek-ai/`（子包大量嵌在 `@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下）；只读顶层 scope 目录会让包计数低一个数量级、`manifest-diff.txt` 只剩顶层交集，据此得出的「包增删」结论不可引用。
2. **定侦察规模**：≤40 个非合并 commit → 按面清单单跑内联；40–250 → 合并 3–4 个面；更多 → 全量六面。密度对比翻**上一对**的 `commits.txt`——按**时间序**取紧邻前一对，永远不要只抓 `tmp/` 里最新的目录。
3. **先立共享事实**（跑一次喂给每个子代理，免得各自重复推导）：① **格式守卫**——源码模式读两个 tag 的 `SESSION_FORMAT_VERSION` 与两个 SQLite 守卫（`STORAGE_SQLITE_SCHEMA_VERSION`、`SESSION_QUERY_SQLITE_SCHEMA_VERSION`），npm 模式从 `dsh-session` 与补充包的已发布 `lib/*.js` grep 同名常量；**`from` 落在 SQLite 落盘简化之前时守卫来自一个已删除的独立持久化补充包**（包名与 schema 路径都与 to 侧不同，按该版本发布清单取证，不要套 to 侧路径）。守卫跳号且无迁移路径 = **硬数据破坏，放报告最前面**。② **回滚清单**——`git log --grep='[Rr]evert' <from>..<to>`，npm 模式用富化的 `reverts.txt`；没有富化 = 回滚*意图*不可检测，明说，只做 from→to 差量审计。③ **Python SDK**——源码模式 diff `python/`，npm 模式一句话说明超出工件范围。
4. **并行面扫描**：每面派一个只读侦察代理，带第 3 步共享事实与 playbook 的输出契约（分节 REMOVED 在前 / CHANGED / ADDED / RENAMED，每条带包路径、符号字段、影响面类别，结尾一行判定）。
5. **发布前核验**（**侦察输出是线索，不是发现**）：每条 REMOVED、回滚与线上声明都亲自复核——`git show <tag>:<path>`/`git ls-tree`，或读两棵已发布树。真实教训：侦察代理曾把 alpha.1 里就存在的包报成"alpha.2 新增"。无法核验的标 `[INFERENCE]` 或删掉。
6. **写 `UPGRADE-ADAPTATION.md`**：头部 → **Verdict**（直接回答比较性问题）→ §1 回滚 → 按消费者影响排序的破坏分节（删除项在前，每条标"谁被破坏" + **Adapt:** 行）→ Confirmed unchanged（成立的部分与破坏同等重要）→ 边界签名表（`API surface | from | to | changed?`）→ 编号迁移清单。

**护栏**：只读（npm 模式只写自己的 `tmp/<pair>/` 且以 `--ignore-scripts` 装在该目录，**绝不把 dsh 包装进宿主项目的 `node_modules`**）；优先树级事实（已发布文件、双 tag 读取），不信日志推导的叙事；内部无关 churn（测试、notes、i18n、样式）聚合成一个计数；如实记录 npm 模式局限（无富化即无 git 历史、CLI tarball 只发 `lib/`、Python SDK 超范围）；**20 个 commit 的区间不要全量扇出，500 个 commit 的区间不要内联——规模判错是审计变陈旧或变浅的主因**。

本模式产出**宿主版本间的兼容性证据**；模式 C 消费这类证据执行单个插件迁移——给迁移卡补"实战批注"时引用报告目录，不要凭记忆转述。

## 安全边界

- 所有写文件、安装、拉取/切换版本、运行包脚本的动作都要先展示并确认；
- 不自动 stash/reset/clean/强制更新，不覆盖用户或其他 Agent 的工作；
- 不泄露凭据；诊断只报告是否配置及非敏感版本/来源；
- 不把未知 `gateway/internal` 或其他失败默认重试；仅在错误可重试、操作幂等且策略允许时重试；
- 迁移方式不能由一手来源或可复现行为高置信确定时，停止自动修改并标「待确认」；
- 本地观察与一手来源冲突时并列记录、复现并上报，不静默选择一方。

## 验证与报告

至少按适用层级验证：

1. 依赖解析：对应包管理器、lockfile 与依赖图只发生预期变化；扫描完整 lockfile 中的旧 DSH cohort 和已删除包，不能只看顶层依赖。
2. 依赖安全：任何依赖变更后跑一次官方 registry 的 audit（本地默认镜像没有 advisories 端点，裸 `npm audit` 必然失效；必须钉官方源并禁止 registry 重写）——`HTTPS_PROXY=<代理> npm_config_registry=https://registry.npmjs.org npm_config_replace_registry_host=never npm audit --audit-level=moderate`，期望 0 vulnerabilities；确认方式与本地门禁见 [构建与测试.md](../../docs/开发指南/构建与测试.md)「依赖漏洞审计」，盲区复盘见 [踩坑](../../docs/踩坑/README.md)。
3. 启用解析：目标 profile 的 composition 指向预期包身份，且无旧来源或重复 row。
4. 静态：build、typecheck、插件测试。
5. 运行时：真实 DSH profile 冷启动、entry activate、依赖/提供的 Cordis service 不停在 pending——[verify-runtime.mjs](scripts/verify-runtime.mjs) 在隔离 profile 里端到端执行该层并输出失败归因（plugin-code / dependency-resolution / profile-config / dsh-runtime / environment-construction）；Web Client 插件还要用打印出的 token URL 换 Cookie，读取宿主 boot manifest，请求宿主公告的客户端产物并证明注册/挂载，不能把裸 HTTP 200 当完成。**本仓库插件的兼容性结论不要取自 directory route**：该 route 把插件复制到隔离位置，而本仓库 link 形态依赖（`dsh-shared`）的源码在仓库内、不在任何 `node_modules` 里，副本必须靠链接回指才能解析；源码被冻结出仓库（`git archive`、或只把 `plugins/` 复制到 `/tmp` 再 link）时必然 failed to import——这是 link 形态的固有性质，与宿主版本无关。脚本把这类失败判为 `env-repo-local-dependency` / environment-construction（环境不适用），绝不归因 plugin-code；取兼容性结论改用**同构 profile 批量探测**或 **`npm pack` tarball** 形态。
6. 行为：执行一条插件核心路径；宿主迁移至少完成一次消息→工具→回复，或等价专用流程。
7. 包装器：核对退出码、stdout、stderr、取消与 teardown。

报告固定分为：

- **pre-existing**（模式 C 且已跑 baseline 时；其余模式注明「未采集」）：来自 baseline 的失败清单（未触碰、不归因于本次迁移）；
- **已完成**：版本、文件、命中触点的取证与验证；
- **跳过**：未命中或不适用及依据；
- **未核验**：本次没读的面（协议面 JSON-RPC/SDK/网关/ACP/hooks/错误码/HTTP 路由、资产与配置 schema 面）——未列出的面会被读成「无变化」，不得默认安全；[audit-playbook.md](references/audit-playbook.md) 给出这两面的读取入口；
- **待确认/残留风险**：缺来源、未跑平台、生命周期脚本副作用；
- **回滚**：已记录基线与可恢复路径；
- **建议**：可选能力与迁到公开 seam 的后续工作。

## 参考材料

| 文件                                                                       | 内容                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [references/README.md](references/README.md)                               | 按需加载材料的索引与新增迁移卡的最小约定                                                                      |
| [references/pre-flight.md](references/pre-flight.md)                       | 七类触点自查、版本走廊、ghost host 与摘要模板                                                                 |
| [references/troubleshooting.md](references/troubleshooting.md)             | 迁移后症状 → 最可能根因速查                                                                                   |
| [references/migration-hygiene.md](references/migration-hygiene.md)         | 与版本无关的工具链坑                                                                                          |
| [references/pre-flight-patterns.json](references/pre-flight-patterns.json) | 触点扫描正则的定义源                                                                                          |
| [references/audit-playbook.md](references/audit-playbook.md)               | 模式 D：六面侦察目标清单、派发模板、核验规则与 UPGRADE-ADAPTATION.md 骨架                                     |
| [scripts/plan-migration.mjs](scripts/plan-migration.mjs)                   | 只读 migration planner：扫描目标仓库、输出触点命中的计划草稿                                                  |
| [scripts/verify-runtime.mjs](scripts/verify-runtime.mjs)                   | 隔离 profile 端到端运行时验证（失败归因：plugin-code / dependency-resolution / profile-config / dsh-runtime / environment-construction） |
| [scripts/ghost-host-check.mjs](scripts/ghost-host-check.mjs)               | 宿主幽灵进程检查（升级前确认无残留 dsh 进程）                                                                 |
| [scripts/materialize-npm.mjs](scripts/materialize-npm.mjs)                 | 模式 D：物化两版已发布包树 + manifest diff + GitHub 富化回滚清单                                              |

规范背景：[dsh-community-standard](https://github.com/oh-my-dsh/dsh-community-standard) 负责 manifest、契约坐标与协商；本 skill 处理现有插件的实际升级，引用其分类而不重定义规范语义。
