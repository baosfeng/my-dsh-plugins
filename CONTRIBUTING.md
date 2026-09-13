# 贡献指南

感谢您对 DSH 插件项目的关注！本指南将帮助您了解如何为项目做出贡献。

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境设置](#开发环境设置)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [问题报告](#问题报告)
- [功能请求](#功能请求)
- [文档贡献](#文档贡献)

## 行为准则

本项目采用 [Contributor Covenant 行为准则](CODE_OF_CONDUCT.md)。参与本项目即表示您同意遵守此准则。

## 如何贡献

### 1. 报告问题

如果您发现了 bug 或有功能建议，请通过以下方式报告：

- **Bug 报告**：使用 [Bug 报告模板](https://github.com/baosfeng/my-dsh-plugins/issues/new?template=bug_report.md)
- **功能请求**：使用 [功能请求模板](https://github.com/baosfeng/my-dsh-plugins/issues/new?template=feature_request.md)
- **文档问题**：使用 [文档问题模板](https://github.com/baosfeng/my-dsh-plugins/issues/new?template=documentation.md)
- **安全漏洞**：通过 [GitHub 安全通告](https://github.com/baosfeng/my-dsh-plugins/security/advisories/new) 报告

### 2. 提交代码

1. Fork 项目仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'feat: add some feature'`
4. 推送到分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### 3. 改进文档

文档改进同样重要！您可以通过以下方式贡献：

- 修复文档错误
- 添加示例代码
- 翻译文档
- 改进文档结构

## 开发环境设置

### 前置要求

- Node.js >= 22
- npm >= 10
- Git

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

3. 运行测试：

   ```bash
   npm test
   ```

4. 启动开发模式：
   ```bash
   npm run dev
   ```

### 开发工具

- **ESLint**：代码质量检查
- **Prettier**：代码格式化
- **TypeScript**：类型检查
- **Vitest**：单元测试
- **Cucumber**：行为测试

## 代码规范

### TypeScript 规范

- 使用 TypeScript 进行开发
- 启用严格模式
- 遵循 ESLint 规则
- 保持代码复杂度 ≤ 10
- 单文件 ≤ 400 行
- 单函数 ≤ 70 行

### 命名规范

- **文件名**：使用 kebab-case（例如：`my-component.ts`）
- **变量名**：使用 camelCase（例如：`myVariable`）
- **常量名**：使用 UPPER_SNAKE_CASE（例如：`MY_CONSTANT`）
- **类名**：使用 PascalCase（例如：`MyClass`）
- **接口名**：使用 PascalCase（例如：`MyInterface`）

### 代码风格

- 使用 2 空格缩进
- 使用单引号
- 使用分号
- 遵循 Prettier 格式化规则

### 注释规范

- 使用 JSDoc 注释函数和类
- 复杂逻辑添加注释
- 保持注释简洁明了
- 及时更新过时的注释

## 提交规范

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

### 提交类型

- **feat**：新功能
- **fix**：Bug 修复
- **docs**：文档更新
- **style**：代码格式（不影响功能）
- **refactor**：重构
- **perf**：性能优化
- **test**：测试相关
- **chore**：构建/工具相关
- **ci**：CI/CD 相关

### 提交格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 示例

```
feat(file-activity): add file preview functionality

- Add floating preview for file activity
- Support code highlighting and markdown rendering
- Add PDF preview support

Closes #123
```

## Pull Request 流程

### 1. 准备工作

- 确保代码符合规范
- 运行所有测试
- 更新相关文档
- 检查代码覆盖率

### 2. 创建 PR

- 使用清晰的标题
- 添加详细的描述
- 关联相关 issue
- 添加适当的标签

### 3. 代码审查

- 所有 PR 必须经过代码审查
- 至少需要 1 个批准
- 自动检查必须通过
- 解决所有审查意见

### 4. 合并

- 使用 squash 合并
- 删除功能分支
- 更新相关 issue

## 问题报告

### Bug 报告

请使用 [Bug 报告模板](https://github.com/baosfeng/my-dsh-plugins/issues/new?template=bug_report.md)，并包含：

- 问题描述
- 复现步骤
- 期望行为
- 实际行为
- 环境信息
- 日志信息

### 功能请求

请使用 [功能请求模板](https://github.com/baosfeng/my-dsh-plugins/issues/new?template=feature_request.md)，并包含：

- 功能描述
- 使用场景
- 期望行为
- 替代方案

## 文档贡献

### 文档类型

- **README**：项目介绍和快速开始
- **API 文档**：接口说明和使用示例
- **开发指南**：开发环境设置和规范
- **用户指南**：使用说明和最佳实践
- **贡献指南**：本文件

### 文档规范

- 使用 Markdown 格式
- 保持结构清晰
- 添加示例代码
- 及时更新过时内容

## 版本发布

### 版本号规范

本项目使用 [语义化版本](https://semver.org/) 规范：

- **主版本号**：不兼容的 API 修改
- **次版本号**：向下兼容的功能性新增
- **修订号**：向下兼容的问题修正

### 发布流程

1. 更新版本号
2. 更新 CHANGELOG.md
3. 创建 GitHub Release
4. 发布到 npm（如果适用）

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 联系方式

如有任何问题，请通过以下方式联系：

- **GitHub Issues**：[问题报告](https://github.com/baosfeng/my-dsh-plugins/issues)
- **GitHub Discussions**：[讨论区](https://github.com/baosfeng/my-dsh-plugins/discussions)
- **邮箱**：[维护者邮箱]

## 致谢

感谢所有为本项目做出贡献的人！

## 更新记录

- **2025-09-13**：创建贡献指南
