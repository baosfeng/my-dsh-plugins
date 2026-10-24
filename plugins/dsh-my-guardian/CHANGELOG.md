# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.4.8] - 2026-10-24

### 变更

- fix(guardian): #488 前端注入模块不再误判缺失并补裸名回退 (#493)
- chore(guardian): 宿主事件 fixture 同步到 0.2.1-rc.2（升级后重新取证）

## [0.4.6] - 2026-10-17

### 变更

- fix(i18n): 插件文案优先跟随宿主 html lang
- fix(compat): 适配 DSH 0.2.1 移除 webRuntime 服务

## [0.4.5] - 2026-10-17

### 变更

- chore(guardian): 还原 dsh-my-guardian 并修复 #481 依赖预检误报 (#484)
- chore(plugins)!: 删除 5 个插件及其全仓引用 (#464)
- fix(compat): 插件适配 DSH 0.2.0-rc.2 宿主（peer 声明 + 取证通道 + fixture）
- fix(guardian): #438 teardown 期间 entry dispose 诊断不再丢失 (#441)
- fix(guardian): #429 移除永不派发的死监听并修 entry-init 记录标识 (#434)
- fix(guardian): #423 roster 行自身回退 profiles 根 + #424 scoped 行纳入预检 (#425)
- fix(guardian): #410 依赖预检出口分离「版本不满足」与「缺失」 (#420)
- fix(verify): #402 门禁假红根因——等待预算与真实墙钟解耦（用例鲁棒化 + flaky 复测分类缺口） (#417)

## [0.4.4] - 2026-09-25

### 变更

- fix(guardian): #407 依赖预检解析 profiles 根宿主包与子路径导出 (#412)
- fix(dsh-my-guardian): 适配 0.1.7 HMR 重构，取证不绑包名并登记退役事件
- fix(test): 补测试临时目录配对清理，加有界兜底清扫防陈旧残留

## [Unreleased]

### 变更

- fix(guardian): #488 依赖预检不再要求 `dsh.client` 标记才把宿主前端注入的静态模块（`react` / `react-dom` /
  client UI 包）视为已满足，且裸名 `dsh-client-ui-primitives` 回退 `@deepseek-ai/<name>`——社区插件普遍写裸名，
  此前 14 条「缺少依赖」误报里仍有 3 条残留并给出会装出双实例的 `dsh plugin add`。宿主清单带版本时仍按版本判
  （stale 只 warn），`cordis` 裸名保持磁盘/清单判定（server 侧真实依赖不被前端注入掩盖）。真实桌面 asar 清单
  复验：14 条 → 0；`left-pad` 类真缺失仍报 `dependency-missing` 并给安装命令。
- fix(guardian): #481 依赖预检识别桌面版宿主内置包——读 `app.asar/dsh/desktop-runtime.json` 的
  `sharedPackages`（287 个包带版本）与 `files`（覆盖面更广、含第三方包）建索引；裸名
  `cordis` / `schemastery` 回退 `@deepseek-ai/<name>`；客户端插件（`dsh.client`）把宿主前端注入的
  9 个静态模块（`react` / `react-dom` / client UI 包）视为已满足。宿主内置包版本不满足降级为警告
  （提示升级 DSH，不再产出 `dsh plugin add`）；名册非包名行（`cordis:group` / YAML 折叠标量 `>-`）
  不再报 `unresolvable`。真实桌面名册实测：依赖告警 1 → 0、非包名行 0 误报；纯 Node 环境降级不抛错。
- fix(guardian): #429 移除宿主从不派发的死监听 `hmr/config-update-failed`。0.1.7-rc.2 的参考源与已装宿主
  双向 0 命中（`@deepseek-ai/dsh-hmr` 只剩 `hmr/change` / `hmr/reload`），注册它既不触发也不报错；原功能的
  诊断**并未失效**——宿主在同一 catch 里先打 `config reload at %C failed` warn 序列，由结构化日志通道单独
  承担（旧宿主 cordis-plugin-hmr 也是同一顺序，事件通道对两个版本都是冗余的）
- fix(guardian): #429 `loader/entry-init` 诊断记录不再退化成 `entry ? initialized`——loader 在 Entry 构造函数里
  emit，此刻 `entry.options` 还是 `{}`（vendor/loader/src/config/entry.ts:50/58），改为推迟一个 microtask 再落笔；
  隔离实例实测热挂载记录带真实 entry id
- test(guardian): #429 新增 test/host-event-live.mjs——用**真实** cordis loader（已装宿主）证明 `loader/entry-init` /
  `loader/partial-dispose` 真会触发；契约测试新增「源码不得再订阅不存在的事件」判据
- fix(guardian): #438 teardown 收尾期同批并发 entry 的 dispose 诊断不再丢失（收尾写入窗口 + 排空落盘）
- fix(guardian): #438 第二种形态——整树卸载期 `loader/partial-dispose` 监听器与 teardown disposer 同批被
  `Promise.all` 摘除，事件根本到不了 guardian（隔离实例 + SIGTERM 实测：修前 `state.json.events` 恒 1 条、
  entry-dispose 0 条）。改为收尾起手同步抓 loader 树 entry 快照、unmount 后取差集记录「收尾释放了哪些 entry」，
  不再依赖事件通道；实测 183 个活条目全部记到（state.json 按 20 条环形上限保留末 20 条）
- test(guardian): #438 新增第二种形态防复发——fake tree 三例（事件通道静默时全量记录 / 存活条目不误记 /
  teardown 返回后不得覆盖快照）+ test/teardown-releases-live.mjs（真实 cordis 整树卸载取证快照前提与差集）
- fix(guardian): 依赖预检解析 profiles 根 node_modules 的宿主包与子路径导出，消除「缺少依赖」误报
- fix(guardian): #410 依赖预检出口把「版本不满足」与「缺失」分成独立文案/字段/徽标（`dependency-missing` / `dependency-mismatch`），宿主提供的包不再给 `dsh plugin add` 建议，消除含空格/管道的畸形安装命令

## [0.4.3] - 2026-09-25

### 变更

- fix: 适配宿主 0.1.7-rc.2 的事件名与席位契约，修正失效文档断言

## [0.4.2] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- feat(gates): #323 新增包发布卫生门禁（pack 内容 + 字段断言 + README 引用面） (#333)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- fix: update tests and rebuild client.js for new icons
- chore: 项目全面优化和完善

## [0.4.1] - 2026-09-10

### 变更

- chore(quality): 补 TS 源码尺寸门禁 + dsh-my-guardian 契约测试
- feat(ts): 补齐 dsh-my-context / dsh-my-guardian 的 client 端迁移
- feat(dsh-my-guard): migrate to TypeScript
- fix(dsh-my-guardian): 设置页 slots 首屏时序修复（ctx.get strict=false + 防回归测试）
