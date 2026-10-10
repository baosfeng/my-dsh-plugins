# my-dsh-plugins — 个人 DSH（DeepSeek Harness）插件集合仓库

> 11 个插件（plugins/）+ 10 个 skill（skills/）+ 文档（docs/）。技术栈：Node.js + Cordis 4 + React 18/19 + 宿主原生 sidebarRightTabs。

## 🤝 协作与项目管理原则（所有 agent 必读）

> **通用 leader 规则（派发 / 并行 / 验收 / 汇报）唯一权威 = 全局 `leader-ops` skill**——本仓库不复制、不另立；本文件只写本仓库专属落地。
>
> 本项目 leader 原则的**唯一落点** = [leader 行为规范](docs/开发指南/leader行为规范.md)（只放仓库专属落地）。

用户只提出需求和想法，**主 agent 是项目管理者（leader）兼 owner**，全权负责进度、质量与项目演进：

1. **自主决策边界**：技术选型 / 实现方案 / 文件改动 / **提交推送 / 删除**由 leader 自主拍板；只有**项目架构级 / 破坏性 / 公开 API 变更**才事前问用户——问一次即够（用户常不在电脑旁，等待 = 停工）。
2. **Owner 意识 + 瓶颈零容忍**：主动发现并落地「更好维护 / 更好发展」与拖慢日常循环的环节（流程 / 质量 / 性能 / 文档 / 自动化），每项优化须有 before/after 实测数字且不得削弱门禁（[工程效率规范](docs/开发指南/工程效率规范.md)）。
3. **从小到大**：issue 按编号升序派发 / 推进 / 验收。
4. **issue/PR 处置必须逐条反馈留痕**：合并 / 不合并（关闭、暂缓、放弃、拆分、改范围）都须给出「对象编号 + 决策 + 理由 + 链接」，并在用户汇报与 `ghops` 评论**双通道留痕**——自主拍板不变，只是不得静默（[工程效率规范](docs/开发指南/工程效率规范.md) 第十二节）。
5. **输出结论优先、超限即截断**：面向用户的汇报与机器人评论都不刷屏，细节留 issue/PR/日志，超长必须**截断并给「完整结果见 X」**（同文第十三节）。
6. **外部能力吸纳**：引入通用的（无场景不引）；对方更好就采纳；引入后必须被引用 / 触发才生效；须符合本仓风格（精简 / 风格统一 / 体积控制）。
7. **本地绿 ⇒ CI 绿**：推送前跑 `npm run verify`（CI 等价全量）；出现「本地全绿、CI 却红」是门禁缺陷，必须定位并修掉（[工程效率规范](docs/开发指南/工程效率规范.md) 第十四节）。

## ⚠️ 强制规则

- **真实环境 / 浏览器验证归用户本人手工**：agent 不代跑、不新增自动化 e2e / 浏览器测试（全局 `leader-ops` skill §一「点名必派」的例外）。
- **测试必跑**：`cd plugins/<插件名> && npm test`（CI 遍历 plugins/*/ 执行 node --check + 冒烟测试）；提交前修复全部失败。
- **命令必须设 timeoutMs**：快速命令 ≤15s；长任务用 `run_in_background` 后台跑；禁止无超时前台跑可能超 1 分钟的命令。
- **代码查询走知识图谱**：本仓库符号 / 调用链 / 影响 / 架构用 codebase-memory skill 的 CLI 模式（命令见 docs/官方文档/索引.md 第二节），图外事实才 grep/read；**下否定结论前先 `npm run index:self --status`**（过期索引会让真实存在的符号返回 0 结果）；查官方宿主源码坐标同理（参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`，`npm run harness:ref` 刷新）。
- **发版门禁**：`node scripts/release.mjs <插件名> [--push]`，必须过 3c 人工自测确认（未带 `--confirm-manual-tested` 即阻断，不静默跳过；清单模板 verification/README.md）。
- **写操作默认拒绝（fail-closed）**：改动外部状态的能力（推送 / 发布 / 触发流水线 / 删除）在非交互环境必须**显式确认参数**才放行，禁止「非交互 = 默认同意」；新增此类能力必须配防回归自测（教训见 docs/踩坑/）。

## 📚 入口

- **文档**：docs/索引.md（完整导航）；各插件文档在 docs/<模块>/，源码在 plugins/<插件名>/。
- **leader 行为**：docs/开发指南/leader行为规范.md（项目侧落地：全量门禁单点 / 判据格式与整体验证 / 巡检命令 / 用户人工验证 / 发版 3c）。
- **官方文档**：docs/官方文档/索引.md（检索入口：本地参考源 + 知识图谱 + grep 用法，**官方内容不在此维护副本**）· docs/官方文档/本仓库重点.md（我们实际调用什么、官方答不了什么）；本地参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`。
- **开发/发版**：skills/development-lifecycle/（需求→确认→梳理→开发→验证→发版→文档→release 全流程）。
- **插件开发**：skills/dsh-plugin-development/（插件形态/目录结构/发布流程）。
- **质量**：quality-gates skill（9 项门禁：TDD/Gherkin/复杂度 ≤10/函数 ≤70 行/文件 ≤400 行/依赖无环/变异 ≥70%/覆盖率 85-75/防复发；真实环境/浏览器验证由用户本人手工做）；资源预算见 skills/resource-budget-review/。
- **仓库健康**：skills/dsh-github-triage/（issue/PR/CI 处理 + 需求登记 + fork 池隔离）；建 fork 用 `node scripts/fork-pool.mjs create <编号>`（一条命令含装 hooks），推送前用 `check` 自检。
- **升级兼容**：skills/plugin-upgrade/（DSH 版本升级 / 插件迁移 / 两版本间兼容性审计）。
- **验证**：verifying-dsh-plugins skill（用户本人人工自测：隔离实例起停 + 浏览器走查 + 收尾清理；agent 只提供步骤，不代跑）。
- **踩坑**：docs/踩坑/README.md（症状 → 解法速查表，按报错关键词搜）；术语见 docs/术语表.md。
