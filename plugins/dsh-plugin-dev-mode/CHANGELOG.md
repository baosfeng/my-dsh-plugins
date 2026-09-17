# Changelog

本文件记录 dsh-plugin-dev-mode 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.1] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- feat(gates): #323 新增包发布卫生门禁（pack 内容 + 字段断言 + README 引用面） (#333)
- fix(release): #231 识别 preset 资产包形态，修复 dsh-plugin-dev-mode 发版门禁误报 (#238)
- fix(release): #227 修正 README 效果图门禁对无 UI 插件的处置 (#230)
- style(format): 全仓 prettier 格式化（issue #44）

## [0.1.0] - 2026-08-25

### 新增

- **「插件开发模式」agent preset**（`plugin-dev`）：启用 Cordis 工具集（`cordis_inspect_*` / `cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine`）的 Agent 模式，用于 DSH 插件与动态 Cordis 插件开发；与 shipped「创造模式」同为该工具集载体，但工具组合更精简。
- **精简工具组合**：shell（bash/pwsh）、文件（read/write/edit/glob/grep）、后台任务、goal、ask、todo、技能加载与 compaction；不含 plan mode、子代理/工作流/ralph 委派与 web 搜索，prompt 开销更小。
- **随包技能**：`editing-cordis-compositions` 与 `cordis-plugin-development` 随 preset 目录安装（`customSkillDirs` 相对解析）。
- **一键安装脚本**：`scripts/install.mjs` 将 preset 复制到 `$DSH_HOME/.agent-presets/plugin-dev/`。
- **挂载验证**：经 `agentPresets.standingKeyFor` 真实挂载验证通过（组合无 realm 冲突、无包缺失）。
