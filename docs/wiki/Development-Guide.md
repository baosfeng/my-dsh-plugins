# 开发指南

本指南将帮助您了解如何开发 DSH 插件。

## 目录

- [插件架构](#插件架构)
- [开发环境](#开发环境)
- [插件类型](#插件类型)
- [开发流程](#开发流程)
- [测试](#测试)
- [发布](#发布)
- [最佳实践](#最佳实践)

## 插件架构

### 整体架构

DSH 插件采用 Cordis 4 框架，支持以下特性：

- **模块化**：每个插件独立打包
- **依赖注入**：通过 Cordis 容器管理依赖
- **生命周期**：支持插件的加载、卸载、重载
- **事件系统**：支持事件监听和触发

### 目录结构

```
plugins/<plugin-name>/
├── src/                    # TypeScript 源代码
│   ├── index.ts           # 插件入口
│   ├── client/            # 客户端代码
│   └── ...                # 其他模块
├── lib/                   # 编译后的 JavaScript
├── test/                  # 测试文件
├── scripts/               # 构建脚本
├── assets/                # 静态资源
├── package.json           # 插件配置
├── tsconfig.json          # TypeScript 配置
├── cordis.patch.yml       # Cordis 配置
└── README.md              # 插件文档
```

### 核心概念

#### 1. 插件入口

插件入口文件 `src/index.ts`：

```typescript
export const name = 'my-plugin'
export const inject = ['webServer', 'sessions']

export function apply(ctx) {
  // 插件逻辑
  ctx.webServer.register({
    kind: 'prefix',
    path: '/my-plugin/api',
    handler: createApiHandler(ctx),
  })
}
```

#### 2. 依赖注入

通过 `inject` 声明依赖：

```typescript
export const inject = ['webServer', 'sessions', 'webRuntime']
```

#### 3. 事件监听

监听系统事件：

```typescript
ctx.on('fs/observed', (observation, actor) => {
  // 处理文件观察事件
})

ctx.on('tools/pre-execute', (exec, next) => {
  // 处理工具执行前事件
  return next()
})
```

#### 4. 副作用管理

使用 `ctx.effect` 管理副作用：

```typescript
ctx.effect(() => {
  // 注册副作用
  const disposer = ctx.webServer.register(route)
  return disposer // 返回清理函数
}, 'my-plugin: register route')
```

## 开发环境

### 前置要求

- Node.js >= 22
- npm >= 10
- Git
- DSH CLI

### 安装步骤

1. 克隆仓库：

   ```bash
   git clone https://github.com/baosfeng/my-dsh-plugins.git
   cd my-dsh-plugins
   ```

2. 安装依赖：

   ```bash
   npm install
   ```

3. 创建新插件：

   ```bash
   # 使用插件模板
   cp -r plugins/dsh-ts-example plugins/my-new-plugin
   cd plugins/my-new-plugin
   ```

4. 修改配置：
   - 更新 `package.json` 中的 `name` 和 `description`
   - 更新 `tsconfig.json` 中的配置
   - 更新 `cordis.patch.yml` 中的配置

5. 开发插件：
   ```bash
   # 启动开发模式
   dsh web
   ```

### 开发工具

- **TypeScript**：类型检查和编译
- **ESLint**：代码质量检查
- **Prettier**：代码格式化
- **Vitest**：单元测试
- **Cucumber**：行为测试

## 插件类型

### 1. 工具型插件

通过 `defineTool` 注册 agent 工具：

```typescript
import { defineTool } from '@deepseek-ai/dsh'

export const tools = [
  defineTool({
    name: 'my-tool',
    description: 'My custom tool',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input parameter' },
      },
      required: ['input'],
    },
    handler: async ({ input }) => {
      // 工具逻辑
      return { result: `Processed: ${input}` }
    },
  }),
]
```

### 2. 侧边栏页签

通过 `ctx.slots` 注册侧边栏页签：

```typescript
export function apply(ctx) {
  ctx.slots.register(
    {
      key: 'my-tab',
      priority: 100,
      registrant: 'my-plugin',
    },
    {
      component: MyComponent,
      label: 'My Tab',
      icon: 'my-icon',
    },
  )
}
```

### 3. 服务端插件

通过 `ctx.webServer` 注册 HTTP 路由：

```typescript
export function apply(ctx) {
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: '/my-plugin/api',
      handler: async (req, res) => {
        // 处理请求
        res.json({ success: true })
      },
    })
  }, 'my-plugin: register route')
}
```

## 开发流程

### 1. 创建插件

```bash
# 复制模板
cp -r plugins/dsh-ts-example plugins/my-new-plugin

# 修改配置
cd plugins/my-new-plugin
# 编辑 package.json, tsconfig.json, cordis.patch.yml
```

### 2. 开发功能

```bash
# 启动开发模式
dsh web

# 编辑源代码
# src/index.ts
# src/client/index.ts
```

### 3. 测试

```bash
# 运行单元测试
npm test

# 运行类型检查
npm run typecheck

# 运行代码检查
npm run lint
```

### 4. 构建

```bash
# 构建插件
npm run build
```

### 5. 发布

```bash
# 发布到 npm
npm publish

# 或者使用发版脚本
node scripts/release.mjs my-new-plugin --push
```

## 测试

### 单元测试

使用 Vitest 编写单元测试：

```typescript
import { test, expect } from 'vitest'
import { myFunction } from '../src/index'

test('myFunction should work correctly', () => {
  const result = myFunction('input')
  expect(result).toBe('expected output')
})
```

### 行为测试

使用 Cucumber 编写行为测试：

```gherkin
Feature: My Plugin Functionality
  Scenario: User performs action
    Given I have a plugin installed
    When I perform an action
    Then I should see the expected result
```

### 覆盖率

测试覆盖率要求：

- 行覆盖率 ≥ 85%
- 分支覆盖率 ≥ 75%

## 发布

### 版本号规范

使用 [语义化版本](https://semver.org/) 规范：

- **主版本号**：不兼容的 API 修改
- **次版本号**：向下兼容的功能性新增
- **修订号**：向下兼容的问题修正

### 发布流程

1. 更新版本号：

   ```bash
   npm version patch  # 修订号
   npm version minor  # 次版本号
   npm version major  # 主版本号
   ```

2. 更新 CHANGELOG.md

3. 创建 GitHub Release：

   ```bash
   node scripts/release.mjs my-plugin --push
   ```

4. 发布到 npm：
   ```bash
   npm publish
   ```

## 最佳实践

### 1. 代码质量

- 使用 TypeScript 严格模式
- 保持代码复杂度 ≤ 10
- 单文件 ≤ 400 行
- 单函数 ≤ 70 行

### 2. 错误处理

```typescript
try {
  // 可能出错的代码
} catch (error) {
  ctx.logger.error('Operation failed:', error)
  // 处理错误
}
```

### 3. 日志记录

```typescript
ctx.logger.info('Plugin loaded')
ctx.logger.warn('Deprecated feature used')
ctx.logger.error('Error occurred:', error)
```

### 4. 性能优化

- 避免阻塞主线程
- 使用缓存减少重复计算
- 优化内存使用
- 监控资源消耗

### 5. 安全性

- 验证用户输入
- 防止 XSS 攻击
- 保护敏感数据
- 遵循最小权限原则

## 常见问题

### Q: 如何调试插件？

A: 使用 `dsh web --debug` 启动调试模式，查看控制台日志。

### Q: 如何处理依赖冲突？

A: 检查 `package.json` 中的依赖版本，使用 `npm ls` 查看依赖树。

### Q: 如何优化插件性能？

A: 使用性能分析工具，优化代码逻辑，减少不必要的计算。

### Q: 如何添加国际化支持？

A: 使用 i18n 库，添加多语言资源文件。

## 参考资料

- [Cordis 文档](https://cordis.js.org/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Vitest 文档](https://vitest.dev/)
- [DSH 官方文档](https://deepseek.com/dsh)

## 联系方式

如有问题，请通过以下方式联系：

- GitHub Issues：[提交问题](https://github.com/baosfeng/my-dsh-plugins/issues)
- Discussions：[社区讨论](https://github.com/baosfeng/my-dsh-plugins/discussions)

---

_最后更新: 2025-09-13_
