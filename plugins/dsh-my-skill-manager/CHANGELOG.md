# Changelog

## [0.2.0] - 2026-10-24

### 破坏性变更

- **界面与实现重写**（按已验收原型）：命令条 + 卡片流/紧凑表双视图 + 双作用域并排开关 + 焦点详情 + 批量条 + 诊断台；旧「全局/项目分段视图 + 排序药丸 + 四层行」结构移除。
- **API 形状变更**：`/list` 返回全量 skill（不再按视图过滤），新增 `globalDisabled` / `projectDisabled` / `scannedAt`，行内增加 `path` / `cataloged` / `invocation`；新增 `GET /detail`（SKILL.md 只读，白名单根 + 256KB 截断）。
- **服务端模块重组**：`src/server/{types,config-store,catalog,detail,disabler,usage,diagnostics,http}.ts` 替代旧的扁平模块；配置路径与 JSON 形状保持兼容。

### 新增

- 搜索、来源/状态筛选、只看未使用、四种排序、概览计数可点筛。
- 详情（路径/provider/调用能力/使用统计）与 SKILL.md 只读预览、复制。
- 批量启停（内联二次确认）、诊断台整页、重新扫描时间提示。
- 无障碍：`role=switch` + `aria-checked`、图标按钮 `aria-label`、`focus-visible`、Esc 分级处理。

### 测试

- 服务端 7 个测试文件 43 用例（覆盖率 语句 96.6% / 分支 87.0% / 函数 96.4%），客户端渲染与关键交互测试重写。

## [0.1.12] - 2026-10-17

### 变更

- fix(i18n): 插件文案优先跟随宿主 html lang
- fix(compat): 适配 DSH 0.2.1 移除 webRuntime 服务

## [0.1.11] - 2026-10-17

### 变更

- fix(deps): dsh-shared 从 peerDependencies 移到 dependencies
- chore(docs): 撤销误提交混入的并行改动，保留 guardian 踩坑引用恢复
- docs(踩坑): 恢复 guardian 的参考实现引用（asar 取证 / 收尾窗口 / boot 就绪）
- feat(dsh-md-render): 卡片工具条收纳式改版 + 修竖向长图缩放偏位
- feat(md-render,my-memory)!: 合并渲染插件并新增全局提示词 (#463 #465)
- fix(compat): 插件适配 DSH 0.2.0-rc.2 宿主（peer 声明 + 取证通道 + fixture）

## [0.1.10] - 2026-09-25

### 变更

- fix(dsh-my-skill-manager): 逐项兜底 ui 导出，修 0.1.7 下设置面板白屏

## [0.1.9] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- test: #343 存量固定 sleep 收敛（whenReady / drained / 渲染态可观测） (#363)
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- feat(gates): #323 新增包发布卫生门禁（pack 内容 + 字段断言 + README 引用面） (#333)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows

## [0.1.8]

- fix: 添加 @deepseek-ai/dsh-client-ui-primitives 依赖缺失时的 try/catch 降级兜底