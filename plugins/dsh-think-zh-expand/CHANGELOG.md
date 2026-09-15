# Changelog

## [0.4.10] - 2026-09-15

### 变更

- refactor(think-zh-expand): #299 三级回退切到 dsh-shared/client-parts/markdown-fallback（行为等价） (#308)
- fix(think-zh-expand): #293 渲染三级回退，md-render 缺失时用平台 MarkdownText 兜底 (#295)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows

## [0.4.10]

- fix: 渲染改为三级回退（#293）——`dsh-md-render` 缺失时不再崩溃，改用宿主静态模块表的官方 `MarkdownText`（GFM + KaTeX，零安装）渲染；官方组件也缺失时回退 `<pre data-dsh-think-zh-expand-fallback="true">` 纯文本，渲染期永不抛错
- fix: 修掉 0.4.9 的假降级（#290）——只 catch `require` 并把 `MarkdownView` 置 null，渲染期裸 `createElement(null)` 抛 `Element type is invalid: expected a string … but got: null`；现在是真的替换渲染组件
- test: 新增 `test/client-render-fallback.mjs`（md-render 缺失 + 官方组件可用/**memo 对象形态**/缺失 + 各级导出畸形矩阵，含先红后绿复现）与 3 条 Gherkin 场景
- fix: 组件可用性判定改用 React 语义（`react.isValidElementType`，取不到时退化为「函数或带 `$$typeof` 的对象」）——官方 `MarkdownText` 是 `React.memo` 返回的**对象**（`object($$typeof,type,compare)`），用 `typeof === 'function'` 会把它误判为缺失、直接落到 `<pre>`
- chore: `dsh.client` 增加 `externalDegraded: ["dsh-md-render"]`，显式声明该 external 缺失时有降级路径（#294 发版门禁 1c 要求）。**该字段只被本仓库门禁读取**：宿主解析 `dsh.client` 只认 `platform`/`inject`/`external`/`immediately`，未知字段丢弃，对运行时无副作用

## [0.4.9]

- fix: 添加 dsh-md-render 依赖缺失时的 try/catch 降级兜底，解决新装用户崩溃问题 (#290)
- 当 dsh-md-render 未安装时，插件不再崩溃，会优雅降级为纯文本模式

## [0.4.8]

- 先前版本
