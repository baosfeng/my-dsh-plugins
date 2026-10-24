# 实现契约 · dsh-my-skill-manager v0.2.0（重构）

> 界面唯一真源：[原型](dsh-my-skill-manager.html)（用户已验收）。需求背景：[brief](brief-skill-manager.md)。
> 用户要求：**不在旧实现基础上改造**——服务端与客户端按本契约重新组织模块、重写代码；旧 `src/*.ts` 只可作为宿主 API 契约的查阅对象，不复用其模块划分与实现。

## 0. 范围

保留的能力面：全局/项目双作用域启停、重新扫描、扫描诊断、使用统计、未收录标记、空态/加载/失败。
新增：双作用域并排开关、搜索/来源筛选/状态筛选/只看未使用、四种排序、概览计数、详情（路径/来源/provider/调用能力）、SKILL.md 只读预览与复制、批量启停（二次确认）、诊断台整页。
不做：新建/编辑 SKILL.md、导入导出、白名单模式、原型里的「演示」下拉（那是原型工具，不进生产）。

宿主契约不变：`settings.plugins.tab` 注册（id `my-skill-manager`）、rank-0 占位 provider、`skills.get` 包装统计、`tools/pre-execute` 来源标记、信任围栏、配置文件路径（向后兼容既有用户数据）。

## 1. 目标结构

```
plugins/dsh-my-skill-manager/
  src/index.ts                 插件入口：注入、provider、usage 包装、HTTP 路由
  src/server/types.ts          宿主运行时类型契约（最小）
  src/server/config-store.ts   全局/项目配置读写（禁用名单）
  src/server/catalog.ts        官方 catalog + 目录扫描 → 统一视图模型
  src/server/detail.ts         SKILL.md 读取（白名单 + 大小上限）
  src/server/disabler.ts       rank-0 占位 provider
  src/server/usage.ts          使用统计（防抖 + 原子写）
  src/server/diagnostics.ts    扫描诊断
  src/server/http.ts           路由（list/detail/config/session/rescan）
  src/client/globals.d.ts      client 端 factory 作用域类型
  src/client/parts/*.ts        i18n / ui-fallback / styles / api / view / apply
  lib/                         构建产物（必须提交）
  test/                        单测 + cucumber
```

## 2. HTTP API（/my-skill-manager/api）

| 方法 | 路径 | 入参 | 出参 value |
| --- | --- | --- | --- |
| GET | /list | `?cwd=` | `{ cwd, projectRoot, scannedAt, skills[], globalDisabled[], projectDisabled[], diagnostics:{missing[]}, usage{} }` |
| GET | /detail | `?name=&cwd=` | `{ name, path, content, truncated }`（仅白名单根内，≤256KB） |
| GET | /rescan | `?cwd=` | 同 /list（先 invalidate catalog） |
| GET | /session | `?sessionId=` | `{ cwd }` |
| PUT | /config | `{ scope:'global'|'project', disabled:string[], cwd }` | `{ ok:true }` |

`skills[]` 元素：`{ name, description?, source?, provider?, path?, cataloged:boolean, invocation?:{modelInvocable,userInvocable}, usage? }`。**list 返回全部 skill**（不再按全局/项目视图过滤）——双作用域由两个禁用名单共同表达。

## 3. 行为

- 配置：全局 `$DSH_HOME/skills.enabled.json`；项目 `<projectRoot>/.dsh/skills.enabled.json`（向上找最近 `.git`）。保持现有 JSON 形状：`{ global:{disabled[]}, project:{disabled[]} }`。
- 禁用：注册 rank-0 占位 provider；`list({cwd})` 合并全局 + 项目禁用名；同名覆盖、`get()` 返回 undefined。配置保存后 `invalidate()`。
- 详情：只读扫描白名单根（user/project skill 根）内的 `SKILL.md`；拒绝路径穿越；>256KB 截断并置 `truncated`。
- 使用统计：包装 `skills.get`；`tools/pre-execute` 命中 skill 工具时标记 model，否则 user；落 `$DSH_HOME/skills.usage.json`，防抖 500ms + 原子写。
- 诊断：目录存在但未被 catalog 收录的条目（坏符号链接 / 缺 SKILL.md / 缺 frontmatter / 名称非法 / 解析失败）。
- 信任：沿用 dsh-shared `createTrustFence`。

## 4. 客户端

- 组件对应原型：命令条（搜索/概览/异常入口/重新扫描）、视图切换（卡片流/紧凑表）、筛选（来源/状态/未使用/排序）、卡片与表行（双作用域开关）、焦点详情（两列 + SKILL.md 预览）、选择模式与批量条、诊断台整页、toast、空态/加载/失败。
- 样式前缀 `dsh-my-skill-manager-`；颜色只用 `--dsw-*` 语义 token，零裸色值。
- i18n：中文/英文按 `<html lang>`（沿用现有判定写法）；label 用 thunk。
- 无障碍：开关 `role=switch`+`aria-checked`；纯图标按钮 `aria-label`；`focus-visible` 焦点环；Esc 分级处理。
- **不存在**「演示」下拉与模拟失败；失败态来自真实请求错误。

## 5. 测试与门禁

- server 单测：config-store / catalog / detail / provider / usage / diagnostics / http。
- client：渲染测试（host stub）+ 关键交互（启停、筛选、双作用域、展开详情）。
- cucumber：列表与双作用域、启停、详情、诊断四条主流程。
- `npm test` 必须全绿；提交前 `npm run verify`（leader 统一跑）。
- `lib/client.js` 与 server `lib/*.js` 产物必须提交（CI 不构建）。

## 6. 版本

- `0.2.0`（breaking：API 形状与界面重写）。
- 同步 README、CHANGELOG、`docs/Skill管理/概述.md`。
