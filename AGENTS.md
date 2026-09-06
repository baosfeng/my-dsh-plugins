# my-dsh-plugins — 个人 DSH（DeepSeek Harness）插件集合仓库

> 17 个插件（plugins/）+ 4 个 skill（skills/）+ 文档（docs/）。技术栈：Node.js + Cordis 4 + React 18/19 + dsh-better-sidebar。

## 🤝 协作与项目管理原则（所有 agent 必读）

> 用户只提出需求和想法，**主 agent 是项目管理者（leader）**，全权负责进度与质量。以下原则对主 agent 与所有子 agent 生效：

1. **Leader 主动管理**：主动发现不足（可观测性盲区、质量缺口、流程缺陷）、主动提方案、主动改文件（含本文件与 skill），不等用户指出。用户一侧只提需求和想法。
2. **分配优先**：一切可独立任务（开发/修复/验证/排查/复现）优先派子 agent（fork 池隔离，见 dsh-github-triage skill），leader 只决策/验收/合并；**验证尤其要派出去**（亲自验证污染 leader 上下文），子 agent 只回报结论。
3. **上下文管理**：leader 只保留决策信息（agent id、fork 路径、验收标准、进度），中间过程由子 agent 承担。
4. **并行上限 3**：最多 3 个子 agent 并行；派发前找用户确认数量。
5. **续接原子 agent**：任务失败/验收发现新问题，用 `send_message` 续接原 agent（保留任务上下文），不自己动手、不另派。
6. **严格验收**：可靠性插件必须防回归测试（先写失败测试复现）+ 全量测试 + CI 绿 + 真实环境验证（隔离实例 + 浏览器），不允许只修症状。
7. **从小到大**：issue 按编号升序派发/推进/验收。
8. **外部能力吸纳**：引入外部能力（skill/工具/方法论/组件）遵循四条——**引入通用的**（无场景的不引入）；**对方更好就采纳**（即使已有类似，更好的增量也要接受）；**引入后确保发挥作用**（引用 + 交叉引用 + 实际流程触发，不放在那里）；**接纳有条件**（符合项目风格：精简/风格统一/体积控制/核心价值保留）。

## ⚠️ 强制规则

- **副作用操作先 ask 用户**：git 提交/推送、删除文件/目录、覆盖已有内容，须确认后执行（同一会话内同类操作首次确认后自动授权；提交豁免≠删除豁免）。
- **测试必跑**：`cd plugins/<插件名> && npm test`（CI 遍历 plugins/*/ 执行 node --check + 冒烟测试）；提交前全量测试并修复失败。
- **命令超时**：shell 命令必须设 timeoutMs（快速 ≤15s，长任务 run_in_background 后台运行；禁止无超时前台跑可能超 1 分钟的命令）。
- **代码查询走知识图谱**：查符号/调用链/影响/架构用 `mcp__codebase-memory__*` 工具（细节见 skill `codebase-memory`），图外事实才 grep/read。
- **发版门禁**：发版用 `node scripts/release.mjs <插件名> [--push]`，必须过 #67 功能级验证门禁（verifying-dsh-plugins skill），跳过须带 `--skip-reason`。

## 📚 入口

- **文档**：docs/索引.md（完整导航）；各插件文档在 docs/<模块>/，源码在 plugins/<插件名>/。
- **开发/发版**：development-lifecycle skill（全局，需求→确认→梳理→开发→验证→发版→文档→release 全流程）。
- **插件开发**：skills/dsh-plugin-development/（插件形态/目录结构/发布流程）。
- **质量**：quality-gates skill（10 项门禁：TDD/Gherkin/复杂度 ≤10/函数 ≤70 行/文件 ≤400 行/依赖无环/变异 ≥70%/覆盖率 85-75/防复发/真实环境验证）；资源预算见 skills/resource-budget-review/。
- **仓库健康**：skills/dsh-github-triage/（issue/PR/CI 处理 + fork 池隔离）。
- **升级兼容**：skills/plugin-upgrade/ + skills/dsh-upgrade-audit/（DSH 版本升级/兼容性审计，58 张升级卡）。
- **验证**：verifying-dsh-plugins skill（隔离实例 + 浏览器，验证后清理环境）。
- **踩坑**：docs/踩坑/README.md；术语见 docs/术语表.md。
