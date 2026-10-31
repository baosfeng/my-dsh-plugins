# my-dsh-plugins — 个人 DSH（DeepSeek Harness）插件集合仓库

> 12 个插件（plugins/）+ 10 个 skill（skills/）+ 文档（docs/）。技术栈：Node.js + Cordis 4 + React 18/19 + 宿主原生 sidebarRightTabs。

## 🤝 协作与项目管理原则（所有 agent 必读）

> **通用 leader 规则（派发 / 并行 / 验收 / 汇报）唯一权威 = 全局 `leader-ops` skill**——本仓库不复制、不另立；本文件只写本仓库专属落地。
>
> 本项目 leader 原则的**唯一落点** = [leader 行为规范](docs/开发指南/leader行为规范.md)（只放仓库专属落地）。

用户只提出需求和想法，**主 agent 是项目管理者（leader）兼 owner**，全权负责进度、质量与项目演进：

1. **自主决策边界**：技术选型 / 实现方案 / 文件改动 / **提交推送 / 删除**由 leader 自主拍板；只有**项目架构级 / 破坏性 / 公开 API 变更**才事前问用户——问一次即够（用户常不在电脑旁，等待 = 停工）。
2. **Owner 意识 + 瓶颈零容忍**：主动发现并落地「更好维护 / 更好发展」与拖慢日常循环的环节（流程 / 质量 / 性能 / 文档 / 自动化），每项优化须有 before/after 实测数字且不得削弱门禁（[工程效率规范](docs/开发指南/工程效率规范.md)）。
3. **从小到大**：issue 按编号升序派发 / 推进 / 验收。
4. **issue/PR 处置双通道留痕**：合并 / 不合并（关闭、暂缓、放弃、拆分、改范围）的处置表既进用户汇报，也以 `ghops` 评论公开留痕（逐条反馈的通用要求见全局 `leader-ops` skill §五；格式见 [工程效率规范](docs/开发指南/工程效率规范.md) 第十二节）。
5. **输出结论优先、超限即截断**：上限直接采用全局 `leader-ops` skill §七 的硬上限，本仓不另立数值，只补「汇报四要素」（[工程效率规范](docs/开发指南/工程效率规范.md) 第十三节）。
6. **外部能力吸纳**：无场景不引、对方更好就采纳，且须符合本仓风格（精简 / 风格统一 / 体积控制）；「引入即生效」判据见全局 `leader-ops` skill §七。
7. **本地绿 ⇒ CI 绿**：推送前跑 `npm run verify`（CI 等价全量）；出现「本地全绿、CI 却红」是门禁缺陷，必须定位并修掉（[工程效率规范](docs/开发指南/工程效率规范.md) 第十四节）。

## ⚠️ 强制规则

- **真实环境 / 浏览器验证归用户本人手工**：agent 不代跑、不新增自动化 e2e / 浏览器测试（全局 `leader-ops` skill §一「点名必派」的例外）。
- **测试必跑**：`cd plugins/<插件名> && npm test`（CI 遍历 plugins/*/ 执行 node --check + 冒烟测试）；提交前修复全部失败。
- **命令超时**：长任务用 `run_in_background` 后台跑；阈值与「禁止无超时前台跑」见全局 `leader-ops` skill §四。
- **代码查询走知识图谱**：本仓库符号 / 调用链 / 影响 / 架构用 codebase-memory skill 的 CLI 模式（命令见 docs/官方文档/索引.md 第二节），图外事实才 grep/read；**下否定结论前先 `npm run index:self --status`**（过期索引会让真实存在的符号返回 0 结果）；查官方宿主源码坐标同理（参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`，`npm run harness:ref` 刷新）。
- **发版门禁**：`node scripts/release.mjs <插件名> [--push]`，必须过 3c 人工自测确认（未带 `--confirm-manual-tested` 即阻断，不静默跳过；清单模板 verification/README.md）；执行归属见 [leader 行为规范](docs/开发指南/leader行为规范.md) 第六节。
- **写操作默认拒绝（fail-closed）**：规则（含新增此类能力须配防回归自测）见全局 `leader-ops` skill §四；本仓踩坑教训见 docs/踩坑/。

## 📚 入口

- **文档**：docs/索引.md（完整导航）；各插件文档在 docs/<模块>/，源码在 plugins/<插件名>/。
- **leader 行为**：docs/开发指南/leader行为规范.md（本仓独有落地：门禁单点 / 判据命令 / 巡检与负载 / 必跑清单 / 只读禁令 / 隔离与收尾 / 验收纪律 / 偏差落点 / `--no-verify` 例外）。
- **官方文档**：docs/官方文档/索引.md（检索入口：本地参考源 + 知识图谱 + grep 用法，**官方内容不在此维护副本**）· docs/官方文档/本仓库重点.md（我们实际调用什么、官方答不了什么）；本地参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`。
- **开发/发版**：skills/development-lifecycle/（需求→确认→梳理→开发→验证→发版→文档→release 全流程）。
- **插件开发**：skills/dsh-plugin-development/（插件形态/目录结构/发布流程）。
- **质量**：quality-gates skill（**8 项门禁**，清单见该 skill；**不以 TDD 为驱动**，开发顺序见全局 `leader-ops` skill §八；真实环境 / 浏览器验证由用户本人手工做）；资源预算见 skills/resource-budget-review/。
- **仓库健康**：skills/dsh-github-triage/（issue/PR/CI 处理 + 需求登记 + fork 池隔离）；建 fork 用 `node scripts/fork-pool.mjs create <编号>`（一条命令含装 hooks），推送前用 `check` 自检。
- **升级兼容**：skills/plugin-upgrade/（DSH 版本升级 / 插件迁移 / 两版本间兼容性审计）。
- **验证**：verifying-dsh-plugins skill（用户本人人工自测：隔离实例起停 + 浏览器走查 + 收尾清理；agent 只提供步骤，不代跑）。
- **踩坑**：docs/踩坑/README.md（症状 → 解法速查表，按报错关键词搜）；术语见 docs/术语表.md。
