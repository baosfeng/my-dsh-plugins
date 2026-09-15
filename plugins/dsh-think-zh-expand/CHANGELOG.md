# Changelog

## [0.4.10]

- fix: 渲染改为三级回退（#293）——`dsh-md-render` 缺失时不再崩溃，改用宿主静态模块表的官方 `MarkdownText`（GFM + KaTeX，零安装）渲染；官方组件也缺失时回退 `<pre data-dsh-think-zh-expand-fallback="true">` 纯文本，渲染期永不抛错
- fix: 修掉 0.4.9 的假降级（#290）——只 catch `require` 并把 `MarkdownView` 置 null，渲染期裸 `createElement(null)` 抛 `Element type is invalid: expected a string … but got: null`；现在是真的替换渲染组件
- test: 新增 `test/client-render-fallback.mjs`（md-render 缺失 + 官方组件可用/缺失 + 各级导出畸形矩阵，含先红后绿复现）与 2 条 Gherkin 场景

## [0.4.9]

- fix: 添加 dsh-md-render 依赖缺失时的 try/catch 降级兜底，解决新装用户崩溃问题 (#290)
- 当 dsh-md-render 未安装时，插件不再崩溃，会优雅降级为纯文本模式

## [0.4.8]

- 先前版本
