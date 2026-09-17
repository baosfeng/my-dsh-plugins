# 工具型插件：defineTool API 参考（官方权威）

> 权威来源（官方，逐条可复核）：[`docs/subsystems/tools.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.zh.md)（`ToolDefinition` 逐字段权威）、[`docs/user/develop/basic/tool.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md)（最小可用例）、官方源码 [`schema.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/schema.ts) 的 `defineTool` 定义。本文是前两处的压缩副本 + 本仓库 JS 约定差异，冲突时以官方为准。
> 这是 dsh 插件**最核心的形态**：注册工具（tools）供 agent 调用，不依赖 better-sidebar。

## 最小骨架

```js
// src/index.ts（或 lib/index.js）
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool' // 插件 id —— 必须与 cordis.patch.yml 的 id 一致
export const inject = ['tools'] // 必须：否则 ctx.tools 为 undefined，插件崩溃

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'get_weather', // agent 调用的工具名
      description: 'Get current weather for a city.', // agent 决策依据，务必写好
      parameters: {
        // 输入 JSON Schema（对象）
        city: { type: 'string', description: 'City name', required: true },
      },
      output: {
        // 必填，无默认值
        schema: {
          type: 'object',
          properties: {
            temperature: { type: 'number', required: true },
            condition: { type: 'string', required: true },
          },
          additionalProperties: false, // 对象 schema 必须显式声明
        },
        render: (_args, value) => [{ type: 'text', text: `${value.temperature}°C, ${value.condition}` }],
      },
      async execute(args) {
        // 注意是 execute，不是 run
        return { temperature: 22, condition: 'sunny' }
      },
    }),
  )
}
```

## schema DSL 硬规则

| 规则                   | 详情                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `required` 是属性级    | 在每个属性内写 `required: true`。**没有** `required` 数组，**没有** `required: false`，两者都会破坏类型推断 |
| `additionalProperties` | 每个对象 schema 必须显式设置（`false` 禁止额外键）                                                          |
| `output` 必填          | 没有 `output` 无法通过类型检查；必须含 `schema`（对象 schema）+ `render(args, value)` 返回 `ContentBlock[]` |
| render 块              | 返回 `{ type: 'text', text: string }` 项（`@deepseek-ai/dsh-llm` 的 `ContentBlock`）                        |
| `execute(args)`        | 直接返回值（JS 对象/字符串）；不是 `run`；需要执行上下文时用 `execute(args, exec)`                          |

## 项目布局

```
my-tool/
├── src/index.ts          # 插件模块（如上）
├── package.json          # + dsh bundle manifest
├── cordis.patch.yml      # 合并进 harness 的配置补丁
├── tsconfig.json         # NodeNext ESM, outDir lib, strict
└── pnpm-workspace.yaml   # 仅 pnpm 用户：peer 修复
```

**package.json（bundle manifest）：**

```json
{
  "name": "my-tool",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@deepseek-ai/cordis": "latest",
    "@deepseek-ai/dsh-tools": "latest"
  },
  "devDependencies": { "typescript": "^5.5.0", "@types/node": "^22.0.0" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

**cordis.patch.yml：**

```yaml
- insert:
    - id: my-tool
      name: 'my-tool'
```

**tsconfig.json：** `module/moduleResolution: NodeNext`、`target: ES2022`、`strict: true`、`rootDir: src`、`outDir: lib`、`declaration: true`。

## 开发流程

1. **起手式（官方无 scaffold 命令）**：`mkdir -p scratch-plugin/src` 写模块，再手写 `package.json` 与 patch 文件挂到活 harness（官方 [index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)）。社区脚手架 `npx @dsh-io/dsh-dev scaffold <name>` 是**第三方、非官方**产物，官方没有 scaffold 命令；用前自行核实其可用性。
2. **构建**：`npm run build` → 确认 `lib/index.js` 存在。
3. **对活 harness 开发**：`npx @deepseek-ai/dsh --profile web --patch <abs-path>/cordis.patch.yml`（CLI 把 patch 作为 overlay 文件；重跑命令生效）。
4. **验证加载**：启动后确认工具已注册（harness 日志 + agent 工具列表应含工具名）；可用 CLI 的 config dump 预检配置合并。
5. **永久注册**：`dsh plugin add <插件目录>`。
6. **分发**：npm publish + 给仓库打 GitHub `dsh-plugin` topic（dsh 用户可通过插件市场找到）。

## 常见错误

| 错误                                                  | 修复                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ctx.tools.register('name', { run(...) })` 或对象映射 | API 是 `ctx.tools.register(defineTool({...}))` —— 每个工具一个对象，用 `execute` 不是 `run`  |
| 忘记 `export const inject = ['tools']`                | 运行时 `ctx.tools` 是 undefined，插件崩溃 "no service available"                             |
| 省略 `output`                                         | 类型不合法，defineTool 必填                                                                  |
| `required: ['city']` 数组或 `required: false`         | 只用属性级 `required: true`；其他写法破坏类型推断                                            |
| 对象 schema 缺 `additionalProperties`                 | 显式加 `additionalProperties: false`                                                         |
| 从 `koishi` / `@koishijs/...` 导入                    | dsh 用 `@deepseek-ai/cordis`；类型来自 `@deepseek-ai/dsh-tools`（augment cordis 的 Context） |
| patch 的 `id` 与 `export const name` 不一致           | 合并按 id 进行；不一致会静默导致工具未注册                                                   |
| patch 相对路径错误                                    | `dsh.bundle.patch` 必须是相对包根目录的路径，且 patch 文件必须在 `files` 里随包发布          |
| 工具注册了但 agent 从不调用                           | description 写得不够好 —— 那是 agent 决策的依据                                              |

## 快速参考

| 什么            | 在哪                                                              |
| --------------- | ----------------------------------------------------------------- |
| 插件 id 常量    | `src/index.ts` 的 `export const name = 'my-tool'`                 |
| 服务注入        | `export const inject = ['tools']`                                 |
| 工具注册        | `ctx.tools.register(defineTool({...}))`                           |
| 工具定义来源    | `@deepseek-ai/dsh-tools` → `defineTool`                           |
| 容器包          | `@deepseek-ai/cordis`                                             |
| render 块类型   | `@deepseek-ai/dsh-llm` → `ContentBlock`                           |
| bundle manifest | `package.json` → `dsh.bundle.patch`                               |
| 配置合并        | `cordis.patch.yml` → `- insert: [{ id, name }]`                   |
| 起手式          | 手写 manifest + `dsh web --patch <patch>`（官方无 scaffold 命令） |
| 活体开发        | `dsh web` + patch overlay，或 `dsh plugin add <dir>`              |
| 发现            | GitHub topic `dsh-plugin`；npm scoped 包                          |

> 与本仓库 JS 约定差异：官方骨架用 TypeScript（`@deepseek-ai/dsh-tools` 提供类型增强）；本仓库现有插件为纯 JS（`lib/index.js` ESM）。两者 API 相同，`defineTool` 同样可用（无类型检查时注意遵守 schema 硬规则）。
