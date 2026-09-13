# 使用指南

## 快速开始

### 1. 安装 DSH

首先确保你已经安装了 DSH：

```bash
npm install -g @deepseek-ai/dsh
```

### 2. 安装插件

#### 方式一：从 npm 安装（推荐）

```bash
# 安装单个插件
dsh plugin install dsh-file-activity

# 安装多个插件
dsh plugin install dsh-file-activity dsh-md-render dsh-mermaid-render
```

#### 方式二：本地开发模式

```bash
# 克隆仓库
git clone https://github.com/baosfeng/my-dsh-plugins.git
cd my-dsh-plugins

# 安装依赖
npm install

# 链接到 DSH
npm link
```

### 3. 配置插件

插件配置文件位于 `~/.dsh/profiles/default/cordis.patch.yml`：

```yaml
# 启用插件
- id: dsh-file-activity
  name: dsh-file-activity
  enabled: true

# 配置插件选项
- id: dsh-file-activity
  config:
    maxRecentFiles: 10
    enablePreview: true
```

## 插件使用说明

### dsh-file-activity（文件活动监控）

**功能**：

- 监控文件读取、新增、修改事件
- 按 LRU 记录最近访问文件
- 按绝对路径树形统计文件活动
- 点击文件浮窗预览（代码高亮/Markdown/图片/PDF）

**使用方法**：

1. 安装插件后，侧边栏会显示「文件活动」页面
2. 查看最近访问的文件列表
3. 点击文件查看预览
4. 查看文件统计数据

### dsh-md-render（Markdown 渲染）

**功能**：

- 自动渲染 Markdown 内容
- 支持代码高亮
- 支持表格、列表、链接等
- 支持图片预览

**使用方法**：

1. 安装插件后，Markdown 内容会自动渲染
2. 在对话中查看渲染后的 Markdown
3. 支持实时预览

### dsh-mermaid-render（Mermaid 图表渲染）

**功能**：

- 自动渲染 Mermaid 图表
- 支持流程图、时序图、甘特图等
- 离线渲染，无需 CDN
- 支持图表预览和代码切换

**使用方法**：

1. 安装插件后，Mermaid 代码块会自动渲染为图表
2. 支持多种图表类型
3. 可以切换查看源代码

### dsh-my-notify（通知系统）

**功能**：

- 会话结束时弹出浏览器通知
- agent 询问时提示音
- 等待审批时通知
- 点击跳转会话
- 支持远程 webhook 触发

**使用方法**：

1. 安装插件后，会自动接收通知
2. 点击通知跳转到对应会话
3. 配置通知选项

### dsh-task-reliability（任务可靠性）

**功能**：

- 任务状态监控
- 任务重试机制
- 任务超时处理
- 任务日志记录

**使用方法**：

1. 安装插件后，会自动监控任务状态
2. 查看任务执行日志
3. 配置任务重试策略

## 配置选项

### 全局配置

配置文件位置：`~/.dsh/settings.yaml`

```yaml
# 主题设置
ui-theme:
  preference: light

# 权限设置
permission:
  defaultPreset: danger-full-access

# 模型设置
agent-default-model:
  provider: xiaomi-token-plan-cn
  model: mimo-v2.5-pro
```

### 插件配置

每个插件可以单独配置，配置文件位于 `~/.dsh/profiles/default/cordis.patch.yml`

## 常见问题

### Q: 插件安装后没有显示？

A: 检查插件是否启用，重启 DSH 服务。

### Q: 插件功能异常？

A: 查看控制台日志，检查插件配置是否正确。

### Q: 如何更新插件？

A: 使用 `dsh plugin update <插件名>` 命令更新。

### Q: 如何卸载插件？

A: 使用 `dsh plugin uninstall <插件名>` 命令卸载。

## 技术支持

如有问题，请通过以下方式联系：

- GitHub Issues：[提交问题](https://github.com/baosfeng/my-dsh-plugins/issues)
- Discussions：[社区讨论](https://github.com/baosfeng/my-dsh-plugins/discussions)

---

_最后更新: 2025-09-13_
