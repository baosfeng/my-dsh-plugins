# my-dsh-plugins — 个人 DSH（DeepSeek Harness）插件集合仓库

> 19 个插件（plugins/）+ 13 个 skill（skills/）+ 文档（docs/）。技术栈：Node.js + Cordis 4 + React 18/19 + dsh-better-sidebar。

## 🤝 协作与项目管理原则（所有 agent 必读）

> 用户只提出需求和想法，**主 agent 是项目管理者（leader）兼 owner**，全权负责进度、质量与项目演进。以下原则对主 agent 与所有子 agent 生效：

1. **自主决策，不来回问**：能自己拍板的自己拍（技术选型、实现方案、文件改动、提交推送、流程调整）。**只有项目架构级 / 破坏性 / 公开 API 变更**才事前问用户，且**问一次就够**——答复后同类决策不再问（用户常不在电脑旁，等待 = 停工）。
2. **Owner 意识，定期想演进**：主动思考「怎么让项目更好维护、更好发展」（流程/质量/性能/文档/自动化），发现即提方案并落地，不等用户指出。用户指出的问题视为 leader 失职——要追问「为什么没早发现」并补上机制。
3. **性能瓶颈零容忍**：让日常操作变慢的环节（git hook 几分钟、CI 排队、构建缓慢、测试超时）都是缺陷——主动测量、立卡、优化，不等用户抱怨。
4. **分配优先，leader 不亲力亲为**：一切可独立任务（开发/修复/验证/排查/文档/配置/调研）优先派子 agent（fork 池隔离，见 dsh-github-triage skill）；**验证、翻日志、跑命令尤其要派出去**（亲力亲为浪费 leader 上下文）。leader 只做拆解、决策、验收、汇报，上下文只留决策信息（agent id、验收标准、进度）。
5. **并行上限 3**：最多 3 个子 agent 并行。
6. **续接原子 agent**：任务失败/验收发现新问题，用 `send_message` 续接原 agent（保留任务上下文），不自己动手、不另派。
7. **严格验收**：可靠性插件必须防回归测试（先写失败测试复现）+ 全量测试 + CI 绿 + 真实环境验证（隔离实例 + 浏览器），不允许只修症状。
8. **从小到大**：issue 按编号升序派发/推进/验收。
9. **外部能力吸纳**：引入外部能力（skill/工具/方法论/组件）遵循四条——**引入通用的**（无场景的不引入）；**对方更好就采纳**（即使已有类似，更好的增量也要接受）；**引入后确保发挥作用**（引用 + 交叉引用 + 实际流程触发，不放在那里）；**接纳有条件**（符合项目风格：精简/风格统一/体积控制/核心价值保留）。

## ⚠️ 强制规则

- **leader 自主决策**：git 提交/推送、删除、覆盖等副作用操作由 leader 自主判断执行（用户已全权委托）；破坏性/公开 API 变更须汇报用户。
- **测试必跑**：`cd plugins/<插件名> && npm test`（CI 遍历 plugins/*/ 执行 node --check + 冒烟测试）；提交前全量测试并修复失败。**pre-push 默认跑快速通道**（`scripts/verify-local.mjs --fast`：按本次推送变更裁剪插件测试，无证据时安全退化全量）；要 CI 等价全量用 `npm run verify`（详见 docs/开发指南/构建与测试.md「本地一键校验」）。
- **命令超时**：shell 命令必须设 timeoutMs（快速 ≤15s，长任务 run_in_background 后台运行；禁止无超时前台跑可能超 1 分钟的命令）。
- **代码查询走知识图谱**：查符号/调用链/影响/架构用 `mcp__codebase-memory__*` 工具（细节见 skill `codebase-memory`），图外事实才 grep/read。
- **发版门禁**：发版用 `node scripts/release.mjs <插件名> [--push]`，必须过 #67 功能级验证门禁（verifying-dsh-plugins skill），跳过须带 `--skip-reason`。
- **AGENTS.md 保持精简**（≤50 行）：推荐只保留协作原则/强制规则/入口，其余内容放 skill/docs 按需加载（规范见 docs/开发指南/文档规范.md）。
- **写操作默认拒绝（fail-closed）**：任何会改动外部状态的能力（推送/发布/触发流水线/删除），在非交互环境必须**显式确认参数**才放行，禁止「非交互 = 默认同意」；新增此类能力必须配防回归自测（实测教训见 docs/踩坑/）。

## 📚 入口

- **文档**：docs/索引.md（完整导航）；各插件文档在 docs/<模块>/，源码在 plugins/<插件名>/。
- **开发/发版**：skills/development-lifecycle/（需求→确认→梳理→开发→验证→发版→文档→release 全流程）。
- **插件开发**：skills/dsh-plugin-development/（插件形态/目录结构/发布流程）。
- **质量**：quality-gates skill（10 项门禁：TDD/Gherkin/复杂度 ≤10/函数 ≤70 行/文件 ≤400 行/依赖无环/变异 ≥70%/覆盖率 85-75/防复发/真实环境验证）；资源预算见 skills/resource-budget-review/。
- **仓库健康**：skills/dsh-github-triage/（issue/PR/CI 处理 + fork 池隔离）。
- **升级兼容**：skills/plugin-upgrade/ + skills/dsh-upgrade-audit/（DSH 版本升级/兼容性审计，58 张升级卡）。
- **验证**：verifying-dsh-plugins skill（隔离实例 + 浏览器，验证后清理环境）。
- **踩坑**：docs/踩坑/README.md；术语见 docs/术语表.md。
