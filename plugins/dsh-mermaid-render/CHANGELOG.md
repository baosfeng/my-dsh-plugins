# Changelog

本文件记录 dsh-mermaid-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.6] - 2026-09-06

### 变更

- feat(observability): #155 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层） (#159)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.1.5] - 2026-09-02

### 变更

- feat(mermaid-render): #85 图表导出 PNG/SVG 下载 + 复制源码 (#100)

## [0.1.4] - 2026-08-28

### 变更

- feat(ui): dsh-mermaid-render 卡片翻新——图标/前缀/状态（issue #54）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- docs+test: 全面审查修复——文档同步补全 + mermaid 测试增强

## [0.1.3] - 2026-08-25

### 变更

- **npm 页面元数据优化**：description 改为中英双语（中文在前）；README 效果截图引用改为绝对 URL（unpkg），npm 包页面可直接显示图片。

## [0.1.2] - 2026-08-25

### 变更

- **Client 端方案 B 拆分**：`client.src.js` 模板 + 5 个片段（`lib/parts/`）经 `scripts/build.mjs` 拼接生成 `client.js`（构建脚本同步，产物行数 = 源码总和）；eslint 尺寸规则覆盖 src/parts 源码、构建产物排除。
- 行为不变（纯重构）。

## [0.1.1] - 2026-08-23

### 修复

- **mermaid 引擎可正常加载（UTF-8 解码）**：此前 base64 解码用 `atob`，会把内联引擎里的非 ASCII 字符损坏，导致注入的 `<script>` 解析失败、图表一律渲染失败。改用 `TextDecoder('utf-8')` 正确还原字节串。
- **支持流式渲染**：对话消息流式生成时，新增的代码块此前可能因扫描遗漏或捕捉到流式中间态（残缺源码）而渲染失败；现 MutationObserver 对已知滚动容器兜底重扫，且流式中的 mermaid 块等内容稳定后再渲染（避免残缺态失败卡片）。
- **README 效果图**：顶部新增真实现场效果图（图表卡片 预览/代码 切换）。

## [0.1.0] - 2026-08-23

### 新增

- **对话 Mermaid 图表渲染**：`mermaid` / `mmd` 代码块自动渲染为图表卡片（预览 / 代码切换），MutationObserver 跟随流式渲染。
- **mermaid 引擎内联打包**：`vendor/mermaid.min.js`（自包含 UMD）构建时 base64 注入 client bundle，**零 CDN 依赖、完全离线可用**（规避 jsdelivr 等 CDN 在部分网络环境不可达导致图表空白的问题）。
- **失败兜底**：渲染失败保留原始代码块 + 卡片内错误横幅。
- **兼容 dsh-think-zh-expand**：识别其产出的 `div.md-code-block` + `code.language-mermaid` 结构。
- 样式走 DSH 语义 token，随 activation 注入、fiber teardown 卸载。
