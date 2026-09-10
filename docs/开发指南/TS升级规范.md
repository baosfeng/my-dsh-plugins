---
title: TS 升级规范
description: 全量 TypeScript 迁移规范 — 目录结构、tsconfig 配置、构建流程、验收标准
created: 2026-09-08
updated: 2026-09-08
---

# TS 升级规范

> 本文档是全量 TS 迁移的统一规范，所有插件迁移必须遵循。

## 一、目录结构

### 仅有 Server 端的插件

```
plugins/<name>/
├── src/
│   ├── index.ts           # server 端入口（export { name, inject, apply }）
│   ├── types.d.ts         # DSH 运行时类型声明（最小契约）
│   └── <模块>.ts          # server 端逻辑模块
├── lib/
│   ├── index.js           # tsc 编译产物（必须提交）
│   └── ...其他产物
├── tsconfig.json          # server 端构建配置
└── package.json
```

### 含 Client 端的插件

client 端有**两种合法形态**（迁移时按插件现有的 `lib/client.js` 结构选一种即可，两者都算迁移完成）：

| 形态                      | client 源               | 入口由谁承担                                                         | 实例                                                                                                               |
| ------------------------- | ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **A：parts 拼接**（主流） | `src/client/parts/*.ts` | `lib/client.src.js` 模板（**无** `src/client/index.ts`）             | dsh-my-memory、dsh-file-activity、dsh-my-observability、dsh-md-render、dsh-my-plugin-manager、dsh-my-skill-manager |
| **B：单文件**             | `src/client/index.ts`   | 该文件编译成单文件 bundle，注入模板的 `/*__CLIENT_BUNDLE__*/` 占位符 | dsh-mermaid-render、dsh-think-zh-expand、dsh-ts-example                                                            |

> 只有「占位契约」而无实现的 `src/client/index.ts`（注释自述"仅为让 typecheck 通过"、真实逻辑仍在手写 parts）
> **不算迁移完成**，见 8.2 的 dsh-my-guardian。

```
plugins/<name>/
├── src/
│   ├── index.ts           # server 端入口
│   ├── types.d.ts         # 类型声明
│   ├── <模块>.ts          # server 端模块
│   └── client/
│       ├── globals.d.ts   # client 全局契约（DSH 运行时 / React hooks），两种形态都需要
│       ├── parts/*.ts     # 形态 A：client 片段（纯函数声明文本，无 import/export）
│       └── index.ts       # 形态 B：单文件入口（无运行时相对 import）
├── lib/
│   ├── index.js           # server 产物
│   ├── client.src.js      # client 模板（手写 JS，含 splice 占位符，不是产物）
│   ├── client.js          # client 构建产物（必须提交）
│   └── parts/             # client parts 产物——仅当本插件测试/构建需要读取时才发布并提交
│                          #（file-activity 的 test/tab-active-styles.mjs 读它；my-memory 等
│                          #  只经 lib/.client-build 临时目录 splice，构建后清理、不提交）
├── scripts/
│   └── build.mjs          # client 构建脚本
├── tsconfig.json          # server 端构建
├── tsconfig.client.json   # client 端构建
└── package.json
```

## 二、tsconfig 配置

### Server 端（tsconfig.json）

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "lib",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts"],
  "exclude": ["src/client"]
}
```

### Client 端（tsconfig.client.json）

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "bundler",
    "outDir": "lib/.client-build",
    "rootDir": "src/client",
    "lib": ["es2022", "dom"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  },
  "include": ["src/client/**/*.ts"]
}
```

## 三、package.json 更新

```json
{
  "scripts": {
    "build": "npx tsc -p tsconfig.json && node scripts/build.mjs",
    "typecheck": "npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.client.json",
    "test": "npx vitest run --coverage"
  }
}
```

- 仅有 server 端时，build 简化为 `"npx tsc -p tsconfig.json"`
- typecheck 只需检查有 TS 源码的配置

## 四、类型声明规范

### types.d.ts（最小契约）

```typescript
// DSH 运行时类型（最小契约，不安装 cordis 类型包）
import type { IncomingMessage, ServerResponse } from 'node:http'

export type ServerRequest = IncomingMessage
export type ServerResponse = ServerResponse

export interface WebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: ServerRequest, res: ServerResponse) => void
  }): () => void
}

export interface DshContext {
  webServer: WebServer
  webRuntime: { trustedHosts: string[] }
  sessions: { get(id: string): unknown }
  logger: { warn(msg: string): void; info(msg: string): void; error(msg: string): void }
  on(event: string, listener: (...args: unknown[]) => void): void
  effect(callback: () => void | (() => void), label?: string): void
}
```

### Client 端类型（内联在入口文件）

```typescript
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  betterSidebar?: BetterSidebarService
}

interface BetterSidebarService {
  registerTab(options: {
    id: string
    title: string | (() => string)
    order?: number
    single?: boolean
    component: (props: { scope: { sessionId: string }; visible: boolean }) => unknown
  }): () => void
}
```

## 五、迁移步骤

### Step 1：备份现有代码

```bash
git add -A && git commit -m "chore: backup before TS migration"
```

### Step 2：创建目录和配置

- 创建 `src/` 目录
- 创建 `tsconfig.json`（和 `tsconfig.client.json` 如有 client）
- 更新 `package.json` scripts

### Step 3：迁移源码

- Server：`lib/*.js` → `src/*.ts`（添加类型注解）
- Client：`lib/parts/*.part.js` → `src/client/parts/*.ts`（或合并到单文件）
- import 使用 `.js` 扩展名

### Step 4：编译生成产物

```bash
npm run build
```

### Step 5：验证

```bash
npm run typecheck
npm test
node --check lib/index.js
# 如有 client：
node --check lib/client.js
```

### Step 6：提交

```bash
git add -A && git commit -m "feat(<plugin>): migrate to TypeScript"
```

## 六、验收标准

| 检查项      | 命令                                   | 预期           |
| ----------- | -------------------------------------- | -------------- |
| TS 编译     | `npm run build`                        | exit 0         |
| 类型检查    | `npm run typecheck`                    | exit 0         |
| 单元测试    | `npm test`                             | 全绿           |
| 产物语法    | `node --check lib/index.js`            | exit 0         |
| Client 语法 | `node --check lib/client.js`           | exit 0（如有） |
| ESLint      | `npx eslint plugins/<name>/`           | 无新增错误     |
| Prettier    | `npx prettier --check plugins/<name>/` | exit 0         |

### 6.1 仓库级门禁（CI quality job，迁移必须全绿）

插件级 `npm run typecheck` / `npm test` 通过 **≠** 迁移完成。根级 CI 另有 6 道门禁，
历史上多次因为"只跑了插件级命令"而漏过（一次全量迁移后根 `tsc --noEmit` 报 394 个错误、
`prettier --check` 报 122 个文件）：

| 门禁           | 命令                            | 常见失败原因                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全仓类型检查   | `npx tsc --noEmit`              | ① 根 tsconfig 缺 `types: ["node"]` → `process`/`Buffer`/`node:*` 全部 TS2591，并连锁引发 TS7006/TS18046；② 插件里写 `declare module 'dsh-shared'` 这类 ambient 声明会**全局覆盖**真实模块类型（根配置加载所有 `.d.ts`），使其他插件报 TS2305「模块没有导出成员」 |
| 逐插件类型检查 | `bash scripts/typecheck-all.sh` | 根 tsconfig 必须 exclude `plugins/*/src/client/**`（client parts 是拼接片段，无 import/export，在 nodenext 下被当成独立模块 → 跨文件符号全部解析失败）；client 端的检查由各插件 `tsconfig.client.json` 承担，不能漏                                              |
| 格式           | `npx prettier --check .`        | tsc 产物（`lib/**/*.js`、`lib/**/*.d.ts`）风格与 prettier 不同；产物已在 `.prettierignore` 排除，但 **`src/**/*.ts` 必须 `prettier --write`**                                                                                                                    |
| Lint           | `npx eslint plugins/`           | tsc 产物被当成手写代码 → `max-lines` / `no-unused-vars` 误报；`eslint.config.js` 的 `tscArtifacts()` 动态排除已迁移插件的产物                                                                                                                                    |
| 死代码         | `npx knip`                      | 迁移后 `lib/*.js` 变成产物，knip 的 `entry`/`project` 必须覆盖 `src/**` 与 `lib/index.js`，否则报几十个 Unused files                                                                                                                                             |
| 依赖结构       | `npx depcruise plugins/`        | 构建临时目录 `lib/.client-build/` 残留会导致 depcruise ENOENT                                                                                                                                                                                                    |

### 6.2 源码与产物必须同步

`lib/*.js` 是提交进仓库的产物（CI 不跑构建）。**只改产物不改源码 = 下次构建即丢失**：
`dsh-ts-example` 的 `config?.language` 修复曾只落在产物里，源码仍是 `config.language`。
改完源码必须 `npm run build` 并提交产物，并补一条能锁死该契约的防回归测试
（见该插件 `test/host-smoke.mjs` 的「apply without a config」用例）。

## 七、常见问题

### Q1：import 必须加 .js 扩展名？

A：是的。`module: nodenext` 要求相对 import 必须带扩展名。tsc 会自动将 `import { x } from './foo.js'` 映射到 `./foo.ts`。

### Q2：client 端为什么用 CommonJS？

A：DSH 的 `__ModuleLoader__` 在 browser 端注入 `require`/`exports`/`module` 变量，CommonJS 产物可以直接使用这些变量。

### Q3：client 端为什么必须单文件？

A：`__ModuleLoader__` 不支持相对路径 require，所有代码必须在同一个 factory 作用域内。

### Q4：产物必须提交吗？

A：是的。CI 只跑 `node --check` + 测试，不跑构建。改了 TS 源码后必须 `npm run build` 重新生成产物。

## 八、迁移进度

> 快照：2026-09-10（第四轮收尾）。判定口径：server 端全部 `.ts` 且产物由 tsc 生成；
> client 端「✅」= parts 已迁到 `src/client/parts/*.ts`（形态 A）或单文件 `src/client/index.ts`（形态 B）。
> 测试列 = vitest 用例数 + cucumber scenarios 数。独立全量基线（18 插件全绿）：
> vitest 1375 / cucumber 267 scenarios，覆盖率均值 stmts 95.60 / branch 85.96。

### 8.1 全量迁移（server + client 均 TS）

| 插件                  | 测试 (vitest+cucumber) | 覆盖率(stmts) | client 形态        |
| --------------------- | ---------------------- | ------------- | ------------------ |
| dsh-md-render         | 152+28                 | 94.93%        | A（16 个 parts）   |
| dsh-mermaid-render    | 3+5                    | 100%          | B（单文件 916 行） |
| dsh-think-zh-expand   | 5+5                    | 100%          | B（单文件 688 行） |
| dsh-ts-example        | 14+0                   | 94.73%        | B（单文件 97 行）  |
| dsh-my-memory         | 129+18                 | 95.75%        | A（8 个 parts）    |
| dsh-my-plugin-manager | 52+7                   | 96.96%        | A（6 个 parts）    |
| dsh-my-skill-manager  | 42+6                   | 96.14%        | A（5 个 parts）    |
| dsh-my-observability  | 100+18                 | —             | A（6 个 parts）    |
| dsh-file-activity     | 96+59                  | —             | A（12 个 parts）   |
| dsh-my-notify         | 72+17                  | 93.78%        | A（5 个 parts）    |

### 8.2 server 端已迁移，client 端待补 / 进行中

| 插件                  | 测试 (vitest+cucumber) | client 现状                                              |
| --------------------- | ---------------------- | -------------------------------------------------------- |
| dsh-shared            | 36+8                   | 无 client（`dsh.kind=library`）                          |
| dsh-session-title-gen | 34+6                   | 无 client                                                |
| dsh-my-remote         | 72+5                   | 无 client                                                |
| dsh-task-reliability  | 288+38                 | 🔄 迁移中（原手写单文件 `lib/client.js` 632 行）         |
| dsh-my-guard          | 140+25                 | 🔄 迁移中（5 个手写 parts；**client 端此前零测试覆盖**） |
| dsh-my-context        | 84+10                  | 🔄 迁移中（4 个手写 parts）                              |
| dsh-my-guardian       | 64+12                  | ⏳ 占位契约（5 个手写 parts；branch 76.2% 贴 75 门禁线） |

### 8.3 第四轮（已收尾）

`dsh-my-observability` ✅、`dsh-file-activity` ✅、`dsh-task-reliability` server ✅ / client 🔄。

### 8.4 已知遗留（迁移引入，待修）

- **尺寸门禁对 TS 源码失效**：flat config 无 `.ts` 块（typescript-eslint 尚不兼容 TS 7），
  197 个 TS 文件不受 complexity / max-lines 检查；类型注解让原本刻意卡在 400 行的文件超标
  （my-memory `view` 400→543、`store` 383→428；task-reliability `events` 400→431）。
  修复方案：`scripts/check-ts-size.mjs`（用 @babel/parser 解析 TS AST）+ 冻结债务基线。
- **`lint:size` 命令语义错误**：CLI `--rule` 是全局覆盖，报出的 1012 条里 900 条来自 vendor
  压缩产物、112 条来自刻意豁免的测试文件；真实业务代码（`lib/**`）零违规。
- **残留死文件已清理**：`dsh-mermaid-render` / `dsh-think-zh-expand` 的 `lib/parts/*.part.js`
  共 11 个（模板已改为单文件 bundle，构建不再生成、全仓零引用）。
- 多 agent 并行时同插件 vitest 会撞 coverage 目录锁，见 `docs/踩坑/多agent并行测试资源冲突.md`。
