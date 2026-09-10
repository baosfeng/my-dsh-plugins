# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 变更

- chore(guardian): client 端迁移到 TypeScript——5 个手写 `lib/parts/*.part.js` 片段（styles / util / row / view / apply）迁到 `src/client/parts/*.ts`，并删除只用于 typecheck 的占位契约 `src/client/index.ts`；`scripts/build.mjs` 改为 `tsc -p tsconfig.client.json` 编译 → 发布 `lib/parts/*.js` → prettier 归一化 → 函数式 replacer 拼接进 `lib/client.src.js` 模板 → 校验未解析占位符 → 写 `lib/client.js` → 清理 `lib/.client-build`，`npm run build` 覆盖 server + client 两端。新增 `src/client/globals.d.ts`（DSH 运行时最小契约 + 面板数据契约）。产物语义与迁移前手写版等价（AST / token 级比对零差异，仅多出 tsc 注入的 `'use strict'`）
- test(guardian): 新增 `test/client-contract.mjs`（19 例：产物==模板+片段、"TS 是唯一真源"、build.mjs 片段清单与顺序、样式注入与 fiber teardown、API 轮询与写路径、行组件交互、i18n 回退、事件日志噪音过滤）与 `test/diagnostics-events.mjs`（6 例：诊断事件环形缓冲、HMR 失败监听器、entry 标识读取绝不触碰 `entry.id` getter）——client 端此前零测试覆盖；`lib/events.js` 分支覆盖率 55% → 100%
- fix(guardian): 清理 `stryker.config.mjs` / `vitest.config.mjs` 中已不存在的 `lib/fence.js`，并补上漏统计的 `lib/startup-check.js`——原清单会让 stryker `mutate` 直接报错、覆盖率静默漏项

## [0.4.0] - 2026-09-07

### 变更

- feat(observability): #155 插件状态查询聚合——统一 status-query 事件 + /plugin-status API (#170)
- chore(plugins): #165 清理失效的 dsh.client.inject 声明（13 插件） (#167)
- feat(guard): #144 启动名册静态预检——startup-issues.json + 面板置顶 + 不阻断启动 (#151)

## [0.3.6] - 2026-09-04

### 变更

- fix(guardian): 事件日志不再访问 entry.id getter——构造期 parent.tree 未就绪会抛错炸掉 DSH 启动（隔离实例复现）
- fix(guardian): 诊断面板可读性 + entry 标识修复——插件失败时不再"看不懂/兜不住"
- fix(guardian): #86 发版一致性修复——package.json 0.3.5 + CHANGELOG 0.3.5 段（rebase 冲突还原恢复）
- chore(release): dsh-my-guardian v0.3.5（#86 依赖预检 + 验证清单）
- feat(guardian): #86 候选区插件依赖预检 + 失败分类 (#124)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.3.5] - 2026-09-04

### 新增

- [#86](https://github.com/baosfeng/my-dsh-plugins/issues/86) 候选区插件依赖预检 + 失败分类：热挂载前校验依赖就绪，失败按类别诊断（缺失依赖/锁定冲突/加载错误），诊断面板展示分类详情

### 变更

- 验证清单与效果图同步（发版前功能级验证归档）

## [0.3.4] - 2026-09-02

### 变更

- fix(scripts): #72 插件依赖未随安装自动安装（dsh-shared 未发布 npm） (#96)

## [0.3.3] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.3.2] - 2026-08-28

### 变更

- feat(ui): dsh-my-guardian 插件治理面板翻新——开关/图标/日志层级（issue #54）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- fix(ci): 并行化后的两个失败——Syntax check 对无 lib 的插件（dsh-plugin-dev-mode）用 if 结构；guardian waitFor 超时 3s→10s（并行环境更稳）

## [0.3.1] - 2026-08-27

### 变更

- **npm 包名改为 `dsh-my-guardian`**：`bsfeng-dsh-guardian` → `dsh-my-guardian`，与 `dsh-my-*` 系列（dsh-my-skill-manager / dsh-my-plugin-manager / dsh-my-memory）统一，目录名 = 包名 = tag 名，避免与 npm 上他人同名包（`dsh-guardian`，lss1213）混淆。安装命令变为 `dsh plugin --profile web add dsh-my-guardian`。API 路径（`/guardian/api/*`）、状态文件路径（`$DSH_HOME/guardian/state.json`）、插件行 id（`guardian`）保持兼容。

## [0.3.0] - 2026-08-26

### 变更

- refactor(guardian): 移除 dsh-better-sidebar 第三方依赖（#22）
- docs+test: 全面审查修复——文档同步补全 + mermaid 测试增强

## [0.2.1] - 2026-08-25

### 变更

- **npm 页面元数据优化**：description 改为中英双语（中文在前）；README 效果截图引用改为绝对 URL（unpkg），npm 包页面可直接显示图片。

## [0.2.0] - 2026-08-25

### 变更

- **npm 包名改为 `bsfeng-dsh-guardian`**：npm 上 `dsh-guardian` 已被他人占用（lss1213 的插件），按用户确认改为 bsfeng 前缀。安装命令变为 `dsh plugin --profile web add link:<仓库路径>/plugins/dsh-guardian`（link 安装 key 同步）。API 路径（`/guardian/api/*`）与状态文件路径（`$DSH_HOME/guardian/state.json`）保持兼容。
- **Server 端按 P2 模块拆分**：`lib/index.js`（636 行）拆分为 state/fence/events/mount/api 子模块；**Client 端方案 B 拆分**（src 模板 + 5 片段 + build 拼接）。
- **README 补充真实 DSH 实例效果截图**（assets/panel-main.png + panel-error-detail.png，隔离实例实测）。
- 行为不变（重构 + 改名）。

## [0.1.0] - 2026-08-23

### Added

- 插件治理（dsh-guardian）首个版本：
  - **两段式加载**：新插件写入候选区 `cordis.staged.json`（与 `cordis.patch.yml` 同目录），DSH 启动完成后由守护插件逐个热挂载，不阻塞启动。
  - **失败隔离**：候选插件挂载失败自动记录（尝试次数 + 错误），连续失败 3 次冻结，不再自动重试。
  - **成功转正**：挂载成功的插件自动进入守护插件的持久化清单（`$DSH_HOME/guardian/state.json`），后续每次启动自动恢复。
  - **安全模式**：一键跳过所有候选/已转正插件的加载，快速恢复被插件搞坏的环境。
  - **诊断面板**：dsh-better-sidebar 侧边栏页签（状态列表 / 重试 / 移除 / 错误详情 / 安全模式开关）。
  - **事件监控**：`hmr/config-update-failed`、`loader/entry-init`、`loader/partial-dispose` 诊断事件记录。
  - HTTP API `/guardian/api/*`（loopback 信任围栏）。
