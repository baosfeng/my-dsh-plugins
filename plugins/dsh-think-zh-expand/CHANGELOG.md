# Changelog

## [0.4.16] - 2026-10-08

### 修复

- fix: react/react-dom peer 范围过窄 `^18.2.0 || ^19.3.0` → `^18.2.0 || ^19.2.0`（宿主实际提供 react/react-dom 19.2.8，`^19.3.0` ≡ >=19.3.0 <20 不满足，guardian 报 dependency-mismatch）

## [0.4.15] - 2026-10-08

### 修复

- fix(think-zh-expand): 删除过时的 `@deepseek-ai/dsh-system-prompt` peer 声明（`^0.1.5-rc.2` 不满足 0.2.0-rc.2 宿主的 peer 版本门禁 → 装载 skip）。代码不 import 该包，`systemPrompt` 服务耦合由 `inject: ['systemPrompt']` 声明

## [0.4.14] - 2026-09-18

### 变更

- docs(mermaid-render,think-zh-expand): 文案单语化后的设置页效果图
- fix(think-zh-expand): 设置页文案改按语言切换的单语
- fix(think-zh-expand): 配置路由从未注册（设置页报 404）改为 root 承载注册
- feat(think-zh-expand): 设置页配置面板（defaultExpanded 可视化编辑）

## [0.4.13] - 2026-09-18

### 变更

- docs(mermaid-render,think-zh-expand): 文案单语化后的设置页效果图
- fix(think-zh-expand): 设置页文案改按语言切换的单语
- fix(think-zh-expand): 配置路由从未注册（设置页报 404）改为 root 承载注册
- feat(think-zh-expand): 设置页配置面板（defaultExpanded 可视化编辑）

## [0.4.12] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷

## [0.4.11] - 2026-09-16

### 变更

- feat(think-zh-expand): 思考块展开初值做成配置项 defaultExpanded（默认展开）
- docs(清理): 文档瘦身 23765 → 8309 行并固化精简规范
