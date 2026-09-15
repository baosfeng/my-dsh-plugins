# Changelog

## [Unreleased]

### 修复

- **`dsh-md-render` 未安装不再拖垮整个插件**（#290）：宿主插件安装路径不会自动安装 `dsh.client.external` 指向的第三方包，而模板顶层原先是硬 `require('dsh-md-render')` —— 该包缺失时抛 `client-modules: require("dsh-md-render") missed the module table`，连带整条 client factory 失败、本插件占用的 UI 席位全部挂掉（即 #39 的现象在真实安装路径下复现）。现按 #90（`dsh-my-plugin-manager`）同款模式 try/catch 降级：渲染器不可用时回退纯文本 `<pre data-dsh-think-zh-expand-fallback="true">`，思考块的中文化、折叠交互与 system-prompt 注入均不受影响；`dsh-md-render` 可用时行为完全不变。不改变 #186 认定的 `dsh-md-render` 渲染内核地位。新增降级防回归测试（`test/client-render.mjs` 第 17 组，已反向验证其有效性）。

## [0.4.9]

- fix: 添加 dsh-md-render 依赖缺失时的 try/catch 降级兜底，解决新装用户崩溃问题 (#290)
- 当 dsh-md-render 未安装时，插件不再崩溃，会优雅降级为纯文本模式

## [0.4.8]

- 先前版本
