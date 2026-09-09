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

### 含 Client 端的插件（有 parts 拼接）

```
plugins/<name>/
├── src/
│   ├── index.ts           # server 端入口
│   ├── types.d.ts         # 类型声明
│   ├── <模块>.ts          # server 端模块
│   └── client/
│       ├── index.ts       # client 端入口（单文件，无运行时相对 import）
│       └── parts/         # client 端 parts（如需保持 parts 拆分）
│           └── *.ts
├── lib/
│   ├── index.js           # server 产物
│   ├── client.src.js      # client 模板（手写 JS，保持不变）
│   ├── client.js          # client 构建产物（必须提交）
│   └── parts/             # client parts 产物
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

## 七、常见问题

### Q1：import 必须加 .js 扩展名？

A：是的。`module: nodenext` 要求相对 import 必须带扩展名。tsc 会自动将 `import { x } from './foo.js'` 映射到 `./foo.ts`。

### Q2：client 端为什么用 CommonJS？

A：DSH 的 `__ModuleLoader__` 在 browser 端注入 `require`/`exports`/`module` 变量，CommonJS 产物可以直接使用这些变量。

### Q3：client 端为什么必须单文件？

A：`__ModuleLoader__` 不支持相对路径 require，所有代码必须在同一个 factory 作用域内。

### Q4：产物必须提交吗？

A：是的。CI 只跑 `node --check` + 测试，不跑构建。改了 TS 源码后必须 `npm run build` 重新生成产物。
