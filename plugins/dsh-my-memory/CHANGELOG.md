# Changelog

## [0.2.0] - 2026-10-23

### 变更

- refactor(dsh-my-memory)!: 三 tab 面板按原型复刻，移除自动候选记忆
- refactor(md-render): 拆出 CodeHead/CodeBody 守住函数尺寸门禁

## [Unreleased]

### 新功能

- **agent 记忆（issue #502）**：第四套独立体系——agent 自主维护的跨会话记忆，与全局记忆 / 项目记忆 / 全局提示词完全隔离。
  - **零常驻注入**：不注册记忆正文段，正文只在 agent 主动 `agent_memory_read` 时才进入上下文，不命中则零 token；系统提示词里只有一段固定规则说明（order -80）。
  - **文件是存储、不是接口**：正文是纯 markdown（无日期、无 id、无 frontmatter），元数据（创建时间 / 最后读取 / 读取次数 / 归档）单独存 `index.json`，**agent 读不到也写不到**——时间戳与热度可篡改就等于遗忘机制失效。
  - **4 个工具**：`agent_memory_list` / `agent_memory_read` / `agent_memory_write` / `agent_memory_delete`，路径限定 `$DSH_HOME/agent-memory/` 白名单内（逃逸结构上不可能）；成功只返回 `ok`，不回显不汇报，**写入不污染上下文**。
  - **三道硬门禁**：尺寸红线（单文件 4 KB / 60 条 / 单条 100 字符，超限报错要求先整理）、敏感信息扫描（密钥 / token / 密码 / 私钥拒写）、并发写串行化。
  - **遗忘机制**：读取计数由系统独占维护；超过 `archiveDays`（默认 180 天）未读自动移入 `archive/`，不再列出。面板浏览**不计入** readCount——人肉翻看不该让死记忆续命。
  - **面板第四个 tab「Agent 记忆」**：文件视图（正文原样 + 等宽展示，可直接编辑）+ **元数据可见**（创建 / 最近读取 / 读取次数 / 归档标记），这是「给用户了解原因」的唯一落点；归档区可展开。
  - 端点 `/my-memory/api/agent-memory`（GET 列表 + 元数据、POST write/delete）；面板是用户自己的入口，写操作**不需要** confirmed 标记（与全局记忆的确认门语义相反）。
  - 配置 `agentMemory: { enabled?, archiveDays? }`。

### 修复

- fix(agent-memory): 四个 `agent_memory_*` 工具补齐宿主强制的 `output { schema, render }` 声明——缺它宿主 `tools.register()` 直接抛 `TypeError`，工具在真实环境里根本注册不上（此前测试直接调 `execute`，绕过了注册校验）。新增 `test/host-register-contract.mjs`：把宿主注册契约内联成断言，对全部 7 个注册工具跑一遍，任何工具退回「没有 output」立即红灯。
- fix(agent-memory): 归档不再等于「凭空消失」——面板可读归档正文并一键恢复（正文搬回原位 + 清归档标记），GET 列表返回 `archived: true` 与正文；**agent 通道仍读不到归档内容**（遗忘语义不变）；写入同名文件自动复活。新增 `test/agent-memory-recovery.mjs` 锁死这四条。
- fix(docs): README 删除重复的「Agent 记忆」条目。

### 变更

- **breaking**: 移除「自动学习候选记忆」：删除 `autoLearn` / `extractor` / `maxMessagesPerSession` 配置、`/my-memory/api/candidates*` 端点、候选存储与规则提取器；记忆写入仍只经用户确认（`memory_save` 确认门 + 面板确认弹层）
- feat(client): 设置页改为三个 tab（全局记忆 / 项目记忆 / 全局提示词）；移除项目路径输入，项目记忆随当前会话 cwd 自动加载
- feat(client): 新增 / 编辑改为多行自适应输入框（字数计数 + 超长精简提示，回车提交）；保存 / 删除确认改为居中弹层（保存绿 / 删除红），与工具侧确认卡同构
- feat(client): 全局提示词启停改为胶囊开关；新增 / 编辑带 1000 字计数
- chore(test): 删除候选相关单测与 Gherkin 场景；客户端渲染测试按三 tab 结构重写

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

## [Unreleased]

### 新功能

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