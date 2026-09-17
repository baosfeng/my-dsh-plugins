# 官方仓库插件写法（deepseek-ai/DeepSeek-Harness 权威参考）

> 来源：官方仓库 `packages/` 实际代码（master 分支）。工具型：`packages/workflow/tool-workflow`；UI 型：`packages/client/ui-workflow-run`；组合：`packages/bundle/web-app/cordis.patch.yml`；打包：`packages/client/tsdown.client.ts`。**官方代码是插件写法的唯一权威，社区项目（dsh-web-ui、agent-teams 等）均为其衍生实践。**

## 一、工具型插件（tool-workflow 模板）

```ts
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery' // 官方配置校验库（注意不是 z-schema）
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt' // 声明合并：激活 Context 增强

export const name = 'tool-workflow' // patch 行 id 必须一致
export const inject = ['tools', 'workflowEngine', 'systemPrompt']

/** Config：interface + const 同名模式，schemastery 提供默认值，Loader 负责填充 */
export interface Config {
  toolName?: string
  maxResultChars?: number
}
export const Config: z<Config> = z.object({
  toolName: z.string().default('workflow'),
  maxResultChars: z.natural().min(1).default(50_000),
})

export function apply(ctx: Context, config: Config): void {
  const { toolName, maxResultChars } = config as Required<Config>
  // 工具使用策略 = prompt section（官方约定：工具指南住工具插件，不进部署 persona）
  ctx.systemPrompt.section({ name: `tool:${toolName}`, order: 115, text: '...' })
  ctx.tools.register(
    defineTool({
      name: toolName,
      description: DESCRIPTION, // 模型契约：写清 hook 语义与 schema 子集
      parameters: {/* ... */},
      output: {/* schema + render */},
      async execute(args) {
        /* 返回 JSON 值 */
      },
    }),
  )
}
```

要点：

- **`Config` 同名 interface+const**：`z.object` 描述 + `Loader` 填默认值；apply 收到已解析配置。
- **工具呈现**：`defineTool` 支持 `ToolCallView` / `ToolResultView`——pending 卡（`{ card: 'generic', title, rawInput }`）+ 结果卡，工具调用的 UI 由工具自身声明。
- **会话事件**：log-only 事件用 `session.append(type, data)`，失败 `ctx.logger.warn` 降级（不阻断工具执行）；事件类型经 `SessionEventMap` 合并声明。
- **工具描述即模型契约**：description 内嵌完整用法（hook 签名、约束、错误语义），模型据此调用。

## 二、UI 插件（ui-workflow-run 模板）

```
src/
├── index.ts          # host 半：export function apply(): void {}（纯浏览器端插件 host 半为空！）
└── client/
    ├── index.ts      # 浏览器插件入口
    ├── XxxPanel.tsx  # React 组件（纯 props + Injected 业务面）
    ├── XxxPanel.module.css
    ├── locales.ts    # { zh, en } 字典 + NS 常量
    └── workflow-definition.ts  # 会话事件定义（注册到 conversationEvents）
```

```ts
// src/client/index.ts —— 官方 UI 注册标准姿势
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    workflowRun: WorkflowRunKey
  } // i18n 命名空间合并
}

export const inject = ['conversationEvents', 'slots', 'sessions', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(workflowRunDefinition) // 会话事件 → 对话流节点
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow-run: dictionaries')
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'workflow-run', // keyed slot 必须带 key！
        locale: NS,
        inject: (): WorkflowRunInjected => ({
          openSession: (id) => {
            ctx.sessions.open(id)
          },
        }),
      },
      WorkflowRunPanel,
    ),
  )
}
```

- **`ctx.slots.inject(slotName, factory)`**：slot 工厂注入（组件注册 + 业务面注入），返回 disposer。
- **`ctx.slots.register(descriptor, Component)`**：descriptor 含 `name` / `key` / `locale` / `inject`。
- **SlotKind 四基**：`single`（单占位）`list`（有序列表）`keyed`（按 key 分发——对话节点用）`chain`（选择器路由链）。
- **Locale**：`declare module LocaleNamespaceMap` 声明 key 域 → `ctx.locale.register(NS, {zh, en})` → 组件 props 获得类型化 `t` 座位（`locale:` 声明时注入）。
- **host 半可空**：纯浏览器功能不需要 host 代码。

## 三、package.json（官方 client 包 manifest）

```jsonc
{
  "name": "@deepseek-ai/dsh-client-ui-workflow-run",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*", // 源码路径导出（调试）
    "./package.json": "./package.json",
  },
  "dsh": {
    "client": {
      // 浏览器名册声明（platform + 注入依赖）
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation",
      ],
      "platform": "web",
    },
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"],
}
```

- 官方仓库内包**无** `dsh.bundle.patch`（由 bundle 组合挂载）；**独立安装的插件**才需要自含 `cordis.patch.yml` + `dsh.bundle.patch`（见 dsh-tools-api.md）。
- 浏览器名册：`client-modules` 读 `dsh.client` 要求 `platform: "web"` + 合法 `exports["./client"]` + bundle 存在，畸形 fail loud。

## 四、组合层（packages/bundle/web-app/cordis.patch.yml）

```yaml
# patch 语义：按 id 覆盖行；覆盖会替换整行 config —— 每行必须 restate 它拥有的每个键
- id: tools
  config:
    mode: !!js process.env.DSH_TOOLS_MODE # !!js 表达式（环境变量/ctx 表达式）

- insert:
    - id: webserver
      name: '@deepseek-ai/dsh-host-webserver'
      inject: [webStartup]
      config:
        host: !!js ctx.webStartup.host ?? '127.0.0.1'
        port: !!js ctx.webStartup.port ?? 3080
    - id: web-runtime
      name: '@deepseek-ai/dsh-web-app'
      inject: [webStartup]

- id: hmr
  disabled: true # 关闭行
```

- `!!js` 支持 `process.env.X`、`ctx.服务.字段 ?? 默认`、`dshHomePath('storages')`。
- 行顺序分层：base → web-app（覆盖）→ profile 自有 → `--patch` overlay（后到优先）。

## 五、client bundle 协议（tsdown.client.ts）

- 产物：`window.__ModuleLoader__.load({ id, factory })` 闭包工厂；externals 经注入的 require 解析（**module-table**——cordis DI 实体，无 globals、无 import map）。
- CSS：lightningcss 编译；`x.module.css` → hashed class map + `data-plugin-css` style 注入（防重复）；`x.css?inline` → 编译文本交给插件生命周期 effect。
- **纯度门**：@deepseek-ai/* 导入必须是 module-table entry 或 `INLINE_SAFE`（host-apiproxy/file-reference/session/llm/tools/brand），否则拒绝（社区"构建纯度门会挡"的根源）。
- client 半输出 `lib/client.js`；host 半输出 `lib/index.js`（tsdown 双半构建）。

## 五、官方 vs 社区独立插件（差异速查）

| 维度    | 官方仓库内包                                        | 社区独立插件（本仓库）                                    |
| ------- | --------------------------------------------------- | --------------------------------------------------------- |
| 挂载    | bundle 组合 patch 装配                              | 自带 `cordis.patch.yml` + `package.json.dsh.bundle.patch` |
| 依赖    | `workspace:^` peer                                  | npm/link peer（cordis、react…）                           |
| 配置    | schemastery `z.object` + Loader 默认                | 同（schemastery 或手写）                                  |
| UI 注册 | slots.inject/register + locale + conversationEvents | 官方同款 API（`inject` 服务名 + keyed 席位）              |
| 构建    | tsdown（tsdown.client.ts 协议）                     | tsdown/tsc 或纯 JS ESM                                    |
| 工具    | `ctx.tools.register(defineTool(...))`               | 相同                                                      |
