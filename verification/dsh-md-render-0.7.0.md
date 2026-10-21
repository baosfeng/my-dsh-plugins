# 发版前人工自测清单 — dsh-md-render@0.7.0

- 本次发版内容：
  1. mermaid 引擎 10.9.3 → 12.2.0（新图表类型：kanban / timeline / treemap / radar-beta /
     architecture-beta / block-beta / packet-beta / xychart / sankey / ishikawa / cynefin / venn …）；
     系统提示词同步，并声明 `-beta` 图表默认可用、无需配置
  2. 外观切换为 Liquid Glass 主题（半透明材质 / 统一悬浮阴影 / 圆角 6·12·14 / 深色走
     `body[data-ds-dark-theme]`）
  3. mermaid 图配色跟随宿主深浅（theme + 16 个 themeVariables 由 `--dsw-*` 派生）
  4. mermaid 块**闭合即渲染**（不再等整轮消息结束）；根因修复：事件源流式条目是
     `transient`（`assistant/live-chunk`），原实现只认 `event`
- 验证环境：独立 `DSH_HOME=/tmp/dsh-verify-glass-3099`（复刻生产 `web` profile 配置组合 +
  预置工作区），端口 3099；验证结束已停实例并删除该目录
- 验证主体：
  - **用户本人**在真实浏览器里完成功能级走查（主题选型 + 主题效果 + 新图表渲染 + 闭合即渲染）
  - agent 侧只提供隔离实例、测试提示词与门禁取证，不代做功能级验收

## 用户本人已确认（真实浏览器 / 真实模型）

- [x] 主题选型：对照页 4 套候选 × 浅/深 全部点过，选定 **Liquid Glass**
- [x] 主题效果：隔离实例里查看新外观，用户确认「可以了」
- [x] 新图表：用测试提示词在真实模型输出下渲染 25 种图表语法，用户确认「非常的完美」
- [x] 闭合即渲染：流式过程中图表卡在围栏闭合后即出现（不再等整轮结束），用户确认「可以了」

## agent 侧取证（机器判据，非人工走查）

- [x] `cd plugins/dsh-md-render && npm test` → 334 tests / 44 files + 18 cucumber scenarios 全绿
- [x] `node scripts/verify-local.mjs --fast` → 28 通过 / 0 失败
- [x] PR CI → 33 个 check：32 通过 / 0 失败 / 1 跳过
- [x] 真机流式采样：修复后新代码块出现与卡片挂载在同一 50ms 采样内（gap 0–79ms，`streaming` 仍为 true）
- [x] 对照度实测：mermaid 深色文字/节点 15.79:1、连线/底 7.05:1

## 未验证项（如实记录，未跑过的没有写成通过）

- [ ] 深色模式下逐控件人工走查（本次只在浅色下由用户确认；深色取值靠 token 转发与实测对比度）
- [ ] Safari / Firefox（`backdrop-filter` / `zoom` 差异）
- [ ] 发版后 npm 安装链路（由 `release.mjs` 3b/3c 门禁覆盖，人工未单独走查）
- [ ] Windows 桌面端
