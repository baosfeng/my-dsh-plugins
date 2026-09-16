# Changelog

## [0.4.11] - 未发布

### 新增

- feat(think-zh-expand): #355 思考块展开初值做成配置项 `defaultExpanded`（默认 `true`，保持本插件「默认展开」定位；显式设 `false` 得到「流式展开 → 完成收起」，即外部 PR #356 的诉求）。host 半边新增 `webServer` 只读路由 `GET /think-zh-expand/api/config` 暴露配置（client 端不能访问 `ctx.config`）；配置缺失 / 非布尔 / 读取失败一律回退 `true`，不会因配置面缺失变成折叠。

## [0.4.10] - 2026-09-15

### 变更

- refactor(think-zh-expand): #299 三级回退切到 dsh-shared/client-parts/markdown-fallback（行为等价） (#308)
- fix(think-zh-expand): #293 渲染三级回退，md-render 缺失时用平台 MarkdownText 兜底 (#295)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
