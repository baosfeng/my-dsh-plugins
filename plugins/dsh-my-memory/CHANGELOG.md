# Changelog

## [Unreleased]

### 新功能

- 全局提示词：设置页新增「全局提示词」分区（新增/编辑/删除/启停/上移下移），启用的提示词每轮组装全量按序注入独立 section `dsh-my-memory:prompts`（order -85），保存后下一轮即生效；与全局记忆在存储 / 检索 / 注入 / 写入 / 失效五处完全隔离（独立文件 `$DSH_HOME/memory/prompts.json`、独立端点 `/my-memory/api/prompts`）；首次运行迁入内置种子「中文思考」（默认启用，删除不复活）

## [0.1.11] - 2026-10-08

### 修复

- fix: react/react-dom peer 范围过窄 `^18.2.0 || ^19.3.0` → `^18.2.0 || ^19.2.0`（宿主实际提供 react/react-dom 19.2.8，`^19.3.0` ≡ >=19.3.0 <20 不满足，guardian 报 dependency-mismatch）

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
