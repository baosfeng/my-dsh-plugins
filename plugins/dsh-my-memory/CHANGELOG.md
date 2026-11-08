# Changelog

## [Unreleased]

### 新功能

- **注入只给结论（渐进式注入）**：真实记忆库实测 838 字 → 446 字（省 47%）。
  - 注入时先剥掉**解释性长括号**（>15 字且不含命令 / 路径特征），再取首句并限长；含 `--flag` / 路径 / `$$` / 脚本名的括号属于可执行信息，保留。
  - `maxDescLength` 默认 200 → **80**；完整正文仍完整存在存储里，细节用 `memory_query` / `agent_memory_read` 查。
  - 去掉注入前言（「以下是你需要始终携带的用户长期偏好…」），标题即说明。
  - `memory_save` 的描述与工具文案改为「只写结论、≤60 字、不写理由与举例」。
  - 新增 `agent_memory_search`（条目级检索，返回文件:行号 + 原文），补上「目录 → 整份 read」之间缺的定位层。
- **预算放宽（实测 1 token ≈ 2.7 字节）**：目录 100 行 / 8 KB → **300 行 / 20 KB**（≈7.4k token），本机 214 条**全量可见**；注入单条上限 80 → **200 字**；写入压缩默认**关闭**（`agentMemory.compress: false`）——预算在 1 万 token 以内，不再为省 token 牺牲信息。
- **agent 记忆写入时压缩**（`agentMemory.compress`，默认开）：超长条目交给当前会话模型压缩一次（只删解释 / 举例，保留结论 / 命令 / 路径 / 数字，条数与顺序必须一致），失败按原文写入；`compressMinChars` 默认 60。只作用于 agent 记忆——全局 / 项目记忆条目少、注入侧已做摘要，不压缩。

- **恒定（pinned）记忆（issue #518）**：全局记忆新增「恒定」维度——恒定条目不参与评分、**每轮必注入**，占用独立名额（`pinnedMaxItems`，默认 3），不挤占 `maxItems` 的评分通道。
  - 起因是实测：注入排序实际退化为**纯时效**（相关性关键字恒空 + 置信度全为 1），本机 10 条全局记忆里 5 条落选，其中包括「禁止创建 goal 任务」「必须使用知识图谱代替 grep」两条硬约束——**必须每轮生效的约束根本没进系统提示词**。人格 / 风格类偏好同属这一类，因此本次**不为记忆新增 `persona` 分类**（分类只是标签，不改变注入选择）。
  - 注入文本分两节：`### 恒定（每轮必生效）` 在前、`### 相关记忆` 在后；没有任何恒定条目时输出与旧版完全一致（不改变既有注入形状）。
  - `memory_save` 增 `pinned` 参数；`memory_query` / 保存 / 删除的输出在分类后标注「·恒定」，agent 从工具结果就能分辨「必须每轮生效」与「按评分选入」。
  - `POST /my-memory/api/memory` 的 add / update 支持 `pinned`；update **可只传 `pinned`**（desc 省略），面板切换不必回传正文。
  - 面板：条目元数据行显示「恒定」徽标，操作区一键切换（走居中确认弹层，与新增 / 编辑 / 删除同一套确认语义）。
  - 恒定条目超出 `pinnedMaxItems` 时按 `updatedAt` 倒序截断并 `warn`（写明未注入条数），绝不静默丢。
  - 旧数据兼容：无 `pinned` 字段的条目读入为 `false`，不报错、不改写现有记忆。

### 修复

- fix(prompt): 全局记忆 / 全局提示词 / agent 记忆目录三个注入段统一关闭宿主变量插值（`interpolate: false`）。此前一条含双花括号占位符的记忆会让整个 prompt 组装抛错、所有回合连败；现在这类正文按字面量进入上下文，不再被模板解析器当作变量。新增 3 条回归测试。

## [0.3.0] - 2026-11-01

### 新功能

- **面板按项目分组折叠 + 跨项目晋升建议（issue #502 后续）**：agent 记忆面板不再平铺全部文件。
  - **分组**：全局一份 + 每个项目一份（`GET /my-memory/api/agent-memory` 改为返回 `groups` / `archived` / `suggestions`，取代原 `items` 平铺）；全局恒在最前，项目按最后写入时间倒序，**默认展开全局 + 最近写入的项目**，其余折叠成「项目名 · N 条」。卡片外观 / 编辑 / 删除确认一律不变，归档区仍是独立一栏。
  - **跨项目晋升**：同一事实出现在 ≥2 个不同 project id（相似度复用 `duplicates.ts` 的 0.5 阈值，传递闭包聚簇；取最具体的一条做代表、每个项目各取最相似的一行）→ 顶部建议条 + 「晋升到 user.md」按钮。确认后追加进 `user.md` 并从涉及的项目文件删除该条（先删后写，写全局失败按快照回滚）。
  - **拒绝必须可见**：含项目专属标识（路径 / IP / 端口 / 仓库名）的条目复用 `globalScopeReject` 的判据（把涉及项目名当 cwd 传入，不改其行为），建议条上直接给原因、按钮置灰；全局层写满 / 建议已过期同样把原因回给面板。
- **agent 记忆（issue #502）**：第四套独立体系——agent 自主维护的跨会话记忆，与全局记忆 / 项目记忆 / 全局提示词完全隔离。
  - **零常驻注入**：不注册记忆正文段，正文只在 agent 主动 `agent_memory_read` 时才进入上下文，不命中则零 token；系统提示词里只有一段固定规则说明（order -80）。
  - **文件是存储、不是接口**：正文是纯 markdown（无日期、无 id、无 frontmatter），元数据（创建时间 / 最后读取 / 读取次数 / 归档）单独存 `index.json`，**agent 读不到也写不到**——时间戳与热度可篡改就等于遗忘机制失效。
  - **4 个工具**：`agent_memory_list` / `agent_memory_read` / `agent_memory_write` / `agent_memory_delete`，路径限定 `$DSH_HOME/agent-memory/` 白名单内（逃逸结构上不可能）；成功只返回 `ok`，不回显不汇报，**写入不污染上下文**。
  - **三道硬门禁**：尺寸红线（单文件 4 KB / 60 条 / 单条 100 字符，超限报错要求先整理）、敏感信息扫描（密钥 / token / 密码 / 私钥拒写）、并发写串行化。
  - **遗忘机制**：读取计数由系统独占维护；超过 `archiveDays`（默认 180 天）未读自动移入 `archive/`，不再列出。面板浏览**不计入** readCount——人肉翻看不该让死记忆续命。
  - **面板第四个 tab「Agent 记忆」**：文件视图（正文原样 + 等宽展示，可直接编辑）+ **元数据可见**（创建 / 最近读取 / 读取次数 / 归档标记），这是「给用户了解原因」的唯一落点；归档区可展开。
  - 端点 `/my-memory/api/agent-memory`（GET 列表 + 元数据、POST write/delete）；面板是用户自己的入口，写操作**不需要** confirmed 标记（与全局记忆的确认门语义相反）。
  - **冲突处理交回 agent**（系统不做查重、不设矛盾状态、不阻断写入）：写入协议新增「遇到矛盾时」——先分清真假矛盾（不同场景/不同对象用限定语共存，能共存就别删）、真矛盾写新删旧并可用「（原 X，现 Y）」留演进痕迹、写满（超限报错）时先整理再写。
  - 配置 `agentMemory: { enabled?, archiveDays? }`。

### 修复

- fix(agent-memory): **目录跨进程自愈**——目录缓存原先只在同进程内靠 `onChange` 重建，命令行脚本 / 第二个窗口 / 另一个 DSH 实例写进来的条目，本进程永远看不到、也没有任何提示（实测：宿主进程启动后写入的 `feedback.md` 9 条与本仓库新增条目在目录里一行不剩）。现在 `text()` 每次求值前做 **≤1s 节流**的磁盘指纹校验（只 `stat` 取 mtime、不读正文，代价恒定），指纹变化即同步重建；测试注入时钟与指纹，不引入 sleep。
- fix(agent-memory): **目录预算重排**——实测用户库里 67 条记忆，目录只能显示 41 条（39% 不可见），且按文件名整体排序时排在后面的项目（android-monitor 21 条）**一条都进不了目录**。三处改动：① 前缀压缩（`projects/<id>/pitfalls.md · ` 平均 29.3 字节 → `项目名/坑 · ` 约 13 字节，省 16%）② 排序改为「全局层整体优先 + 项目层轮转」，任何文件都不会被整体挤掉 ③ 上限 60 行 / 4 KB → **100 行 / 8 KB**。发版前用真实库复核：67 条时 5333 字节 / 91 条时 7176 字节，两种规模都**全量可见**（约 1.2–1.8 k token 名义，内容恒定可命中前缀缓存）；70 行 / 6 KB 的组合在库长到 91 条时已开始折叠 21 条，故随真实库上调。
- fix(agent-memory): **写入去重**（`duplicates.ts`）——提示词要求「先读再写、已有同主题就合并」只覆盖同一份文件；实测 67 条里仍有跨层重复（`user.md` 与本项目 `pitfalls.md` 写了同一句 Request Entity Too Large）。新增确定性护栏：字符级 trigram Jaccard ≥ 0.5 即拒写，并指出重复在哪份文件；同一次写入内部重复同样拒写。比对基准是「其他文件」（同一文件被替换掉的旧条目不在比对范围，改措辞不会被自己锁死）；短句（归一化后 < 12 字）只认完全相同，避免「偏好 1」与「偏好 10」被误判。
- fix(agent-memory): **项目可读名**——项目 id 是 sha256 前 12 位，agent 与用户都看不出 `projects/ba7b32df3d04` 是哪个仓库（用户库里两个项目各有一条「门禁假红」，靠 hash 完全分不清）。写入项目层时把会话 cwd 的 basename 记进 `index.json` 的 `projects` 字段（系统元数据，agent 不可见），目录显示 `my-dsh-plugins/坑`、面板标题显示 `my-dsh-plugins / pitfalls.md`（悬停仍是全路径）；未记录过的项目退回 id 前 6 位。
- feat(agent-memory): **常驻目录**——正文零常驻有个死结：不读就不知道有什么，读了才知道。按需读取把「想起来去 list」压在模型自觉上，靠不住。现在系统提示词里多一张「我的记忆目录」：一行一条列出 agent 写过的全部条目（带文件前缀），硬上限 40 行 / 3 KB / 单行 32 字，超出按文件顺序截断并给「另有 N 条未展开，用 read 查看」，绝不静默丢；启动同步装载一次（`prime()`），写入/删除后重建（`onChange`），内容恒定可命中前缀缓存。目录只做陈列，不做相关性打分——不是「系统替 agent 判断」。`list` 同步改为**一条记忆一行**（此前「一个文件一行 + 条数」等于让 agent 读文件名猜内容）。
- fix(agent-memory): **默认写项目层**——`user.md` 的分工从「以及『以后每次都要做』的动作」改为「**跨项目通用**」，提示词新增「进全局要过两问」：① 这是不是一种通用能力（换任何仓库仍指导做事）② 对其他项目有没有帮助；任一为否就写项目层，拿不准也写项目层。判据来自用户真实的全局/项目记忆归纳（全局全是方法论与工具偏好，项目全是地址/路径/裁决）。
- fix(agent-memory): **全局层写入护栏**（`globalScopeReject`）——含项目专属标识（`scripts/…` / `src/…` 形态的仓库内路径、IP、`localhost:端口`、当前仓库名）的条目写全局会被工具直接拒绝并提示改写进 `projects/current/…`；项目层不受此限（路径正是它的价值）。
- fix(agent-memory): **分层写入判据**——真实用户报告「项目相关的规则（`scripts/debug-cli.sh`、adb）被写进了全局 `user.md`」。根因是 `user.md` 的分工写着「以及『以后每次都要做』的动作」，把「本项目以后每次都做」也放进了全局层。新增「写到哪里」一节：换项目就不成立 → `projects/current/…`（提到具体仓库 / 路径 / 脚本 / 命令 / 端口 / 依赖 / 设备的都算），换任何项目都成立 → `user.md` / `feedback.md`；给自检句与「拿不准写项目层」的不对称代价判据；`user.md` 条目限定为「跨项目通用」；原则 3 明确「项目层带命令 / 路径正是它的价值」；`projects/current` 与 `list` / `read` 返回的真实 id 路径钉成同一个文件。三个不知情盲测全部落对层。
- fix(agent-memory): **面板行内操作按钮退化成浏览器默认样式**——agent 记忆卡片用了 `dsh-my-memory-btn` / `-btn-danger` / `-btn-primary` 三个 `styles.ts` 里根本不存在的类名。改为复用设计系统的 `dsh-my-memory-iconbtn`（铅笔 / 垃圾桶图标、hover 显现、danger 红），编辑器底部改用 `dsh-my-memory-btn-save` + 宿主 ghost Button；编辑态头部不再显示操作（此前同一卡片上出现两个「取消」）。
- fix(agent-memory): 卡片新增**作用域徽标**（全局 / 项目）——项目内容误写进全局层时，用户一眼能看出来。
- fix(agent-memory): 删除改为**二次确认**（复用 ask 范式卡片），此前一点即删、不可恢复。
- fix(client): 新增 `test/client-style-contract.mjs`——扫描 `lib/client.js`，断言每个被使用的 `dsh-my-memory-*` 类名都在 STYLES 里有定义（类名是字符串，TS 查不出来）；这条门禁顺带抓出 `dsh-my-memory-btn-retry` 等 4 个存量未定义类名，已清零。
- fix(agent-memory): 四个 `agent_memory_*` 工具补齐宿主强制的 `output { schema, render }` 声明——缺它宿主 `tools.register()` 直接抛 `TypeError`，工具在真实环境里根本注册不上（此前测试直接调 `execute`，绕过了注册校验）。新增 `test/host-register-contract.mjs`：把宿主注册契约内联成断言，对全部 7 个注册工具跑一遍，任何工具退回「没有 output」立即红灯。
- fix(agent-memory): 归档不再等于「凭空消失」——面板可读归档正文并一键恢复（正文搬回原位 + 清归档标记），GET 列表返回 `archived: true` 与正文；**agent 通道仍读不到归档内容**（遗忘语义不变）；写入同名文件自动复活。新增 `test/agent-memory-recovery.mjs` 锁死这四条。
- fix(docs): README 删除重复的「Agent 记忆」条目。
- fix(agent-memory): **盲测（4 个不知情执行者）暴露的问题**——`projects/<id>` 的 id 是宿主按项目根算的 hash、agent 无从得知（3/4 盲测卡在这里只能猜目录名）：新增 `projects/current/` 别名由系统解析；`list` 只显示正文首行导致 60 条被看成 1 条：改为返回条目数且优先用 `MEMORY.md` 索引行当描述（索引终于有回报）；`agent_memory_write` 描述里写着不存在的 `memory_read`：改为 `agent_memory_read`；`list` 描述里的「冷记忆」无处定义：改为「文件名 + 概要」。
- fix(agent-memory): index + store 改为**全进程单实例**（工具与面板路由共用）——两份 index 缓存各自整份落盘会 lost update，面板刚恢复的归档标记可能被工具侧旧缓存回滚。
- fix(agent-memory): 归档判定计入 `updatedAt`（复活后的记忆不会在下次启动被旧 `createdAt` 立刻又归档）；已归档条目可删除且一并清理 `archive/` 副本。
- fix(agent-memory): `agentMemory.enabled=false` 时**连说明段也不注册**（此前 agent 会被告知一套它根本调不到的工具）。
- fix(agent-memory): `archive/` 移出写白名单（agent 不该直接写归档区），删除未使用的常量。
- fix(agent-memory): `list` 先 `await index.load()`——启动竞态下会把「索引还没加载」误报成「空记忆库」。

### 变更

- **breaking**: 移除「自动学习候选记忆」：删除 `autoLearn` / `extractor` / `maxMessagesPerSession` 配置、`/my-memory/api/candidates*` 端点、候选存储与规则提取器；记忆写入仍只经用户确认（`memory_save` 确认门 + 面板确认弹层）
- feat(client): 设置页改为三个 tab（全局记忆 / 项目记忆 / 全局提示词）；移除项目路径输入，项目记忆随当前会话 cwd 自动加载
- feat(client): 新增 / 编辑改为多行自适应输入框（字数计数 + 超长精简提示，回车提交）；保存 / 删除确认改为居中弹层（保存绿 / 删除红），与工具侧确认卡同构
- feat(client): 全局提示词启停改为胶囊开关；新增 / 编辑带 1000 字计数
- chore(test): 删除候选相关单测与 Gherkin 场景；客户端渲染测试按三 tab 结构重写
- fix(ci): 修好 mutation 沙箱导入与 qs 中等漏洞（两个长期红的 job） (#501)

## [0.2.0] - 2026-10-23

### 变更

- refactor(dsh-my-memory)!: 三 tab 面板按原型复刻，移除自动候选记忆
- refactor(md-render): 拆出 CodeHead/CodeBody 守住函数尺寸门禁

## [0.1.12] - 2026-10-17

### 变更

- fix(i18n): 插件文案优先跟随宿主 html lang
- fix(compat): 适配 DSH 0.2.1 移除 webRuntime 服务

## [0.1.11] - 2026-10-17

### 变更

- fix(deps): dsh-shared 从 peerDependencies 移到 dependencies
- chore(docs): 撤销误提交混入的并行改动，保留 guardian 踩坑引用恢复
- docs(踩坑): 恢复 guardian 的参考实现引用（asar 取证 / 收尾窗口 / boot 就绪）
- feat(dsh-md-render): 卡片工具条收纳式改版 + 修竖向长图缩放偏位
- refactor(dsh-my-memory): 抽取 rows.ts 行级子部件并拆分超长函数
- fix(dsh-shared,ci)!: 修复无值键解析回归并新增依赖解析门禁
- Merge origin/main into main（同步上游 17 提交）
- feat(md-render,my-memory)!: 合并渲染插件并新增全局提示词 (#463 #465)
- fix(compat): 插件适配 DSH 0.2.0-rc.2 宿主（peer 声明 + 取证通道 + fixture）
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#453)
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#448)
- 全局提示词：设置页新增「全局提示词」分区（新增/编辑/删除/启停/上移下移），启用的提示词每轮组装全量按序注入独立 section `dsh-my-memory:prompts`（order -85），保存后下一轮即生效；与全局记忆在存储 / 检索 / 注入 / 写入 / 失效五处完全隔离（独立文件 `$DSH_HOME/memory/prompts.json`、独立端点 `/my-memory/api/prompts`）；首次运行迁入内置种子「中文思考」（默认启用，删除不复活）

## [0.1.10] - 2026-09-25

### 变更

- fix(dsh-my-memory): 逐项兜底 ui 导出，修 0.1.7 下设置面板白屏
- fix: 适配宿主 0.1.7-rc.2 的事件名与席位契约，修正失效文档断言
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#405)
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#398)

## [0.1.9] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- test: #343 存量固定 sleep 收敛（whenReady / drained / 渲染态可观测） (#363)
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- chore(artifacts): #318 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed） (#325)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows

## [0.1.8] - 2026-09-15

- fix: 添加 @deepseek-ai/dsh-client-ui-primitives 依赖缺失时的 try/catch 降级兜底