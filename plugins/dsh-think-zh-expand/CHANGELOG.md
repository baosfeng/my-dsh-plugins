# Changelog

## [Unreleased]

### 变更

- fix(think-zh-expand): #355 思考块改为「流式中自动展开、输出完成后自动收起」——`open = expanded || running` 的 `useState` 初值由 `true` 改为 `false`。初值为 `true` 时 `|| running` 恒真，思考块退化为「永远展开」，且与宿主原生 `ReasoningRow`（`useState(false)`）的折叠基线相反。

## [0.4.10] - 2026-09-15

### 变更

- refactor(think-zh-expand): #299 三级回退切到 dsh-shared/client-parts/markdown-fallback（行为等价） (#308)
- fix(think-zh-expand): #293 渲染三级回退，md-render 缺失时用平台 MarkdownText 兜底 (#295)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
