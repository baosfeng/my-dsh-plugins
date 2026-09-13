# 插件列表

本页列出所有可用的 DSH 插件及其功能说明。

## 插件概览

| 插件名称                       | 功能描述         | 版本  | 状态    | 依赖       |
| ------------------------------ | ---------------- | ----- | ------- | ---------- |
| dsh-file-activity              | 文件活动监控     | 0.5.8 | ✅ 稳定 | dsh-shared |
| dsh-md-render                  | Markdown 渲染    | 0.1.8 | ✅ 稳定 | dsh-shared |
| dsh-mermaid-render             | Mermaid 图表渲染 | 0.1.7 | ✅ 稳定 | dsh-shared |
| dsh-my-context                 | 上下文管理       | 0.1.4 | ✅ 稳定 | dsh-shared |
| dsh-my-guard                   | 守护进程         | 0.1.5 | ✅ 稳定 | dsh-shared |
| dsh-my-guardian                | 插件守护         | 0.4.1 | ✅ 稳定 | dsh-shared |
| dsh-my-memory                  | 记忆管理         | 0.1.7 | ✅ 稳定 | dsh-shared |
| dsh-my-notify                  | 通知系统         | 0.3.9 | ✅ 稳定 | dsh-shared |
| dsh-my-observability           | 可观测性         | 0.3.1 | ✅ 稳定 | dsh-shared |
| dsh-my-opencode-session-header | 会话头部         | 0.1.0 | ✅ 稳定 | dsh-shared |
| dsh-my-plugin-manager          | 插件管理         | 0.1.5 | ✅ 稳定 | dsh-shared |
| dsh-my-remote                  | 远程连接         | 0.1.2 | ✅ 稳定 | dsh-shared |
| dsh-my-skill-manager           | 技能管理         | 0.1.7 | ✅ 稳定 | dsh-shared |
| dsh-plugin-dev-mode            | 开发模式         | 0.1.0 | ✅ 稳定 | -          |
| dsh-session-title-gen          | 会话标题生成     | 0.1.0 | ✅ 稳定 | dsh-shared |
| dsh-shared                     | 共享工具包       | 0.1.4 | ✅ 稳定 | -          |
| dsh-task-reliability           | 任务可靠性       | 0.4.7 | ✅ 稳定 | dsh-shared |
| dsh-think-zh-expand            | 中文思考扩展     | 0.4.8 | ✅ 稳定 | dsh-shared |
| dsh-ts-example                 | TypeScript 示例  | 0.1.0 | ✅ 稳定 | dsh-shared |

## 插件详情

### dsh-file-activity（文件活动监控）

**功能**：

- 监控文件读取、新增、修改事件
- 按 LRU 记录最近访问文件
- 按绝对路径树形统计文件活动
- 点击文件浮窗预览（代码高亮/Markdown/图片/PDF）

**使用场景**：

- 快速访问最近使用的文件
- 查看文件活动统计
- 预览文件内容

**配置选项**：

```yaml
- id: dsh-file-activity
  config:
    maxRecentFiles: 10
    enablePreview: true
    enableStats: true
```

### dsh-md-render（Markdown 渲染）

**功能**：

- 自动渲染 Markdown 内容
- 支持代码高亮
- 支持表格、列表、链接等
- 支持图片预览

**使用场景**：

- 查看 Markdown 文档
- 预览代码片段
- 查看格式化内容

### dsh-mermaid-render（Mermaid 图表渲染）

**功能**：

- 自动渲染 Mermaid 图表
- 支持流程图、时序图、甘特图等
- 离线渲染，无需 CDN
- 支持图表预览和代码切换

**使用场景**：

- 查看流程图
- 查看时序图
- 查看甘特图
- 查看其他 Mermaid 图表

### dsh-my-context（上下文管理）

**功能**：

- 会话上下文管理
- 上下文信息查看
- 上下文统计
- 上下文配置

**使用场景**：

- 查看当前会话上下文
- 管理上下文信息
- 配置上下文选项

### dsh-my-guard（守护进程）

**功能**：

- 进程守护
- 自动重启
- 状态监控
- 日志记录

**使用场景**：

- 保持进程运行
- 自动恢复异常
- 监控进程状态

### dsh-my-guardian（插件守护）

**功能**：

- 插件状态监控
- 插件健康检查
- 插件自动恢复
- 插件日志记录

**使用场景**：

- 监控插件状态
- 自动恢复异常插件
- 查看插件日志

### dsh-my-memory（记忆管理）

**功能**：

- 会话记忆管理
- 记忆存储和检索
- 记忆统计
- 记忆配置

**使用场景**：

- 保存会话记忆
- 检索历史记忆
- 管理记忆空间

### dsh-my-notify（通知系统）

**功能**：

- 会话结束通知
- agent 询问通知
- 等待审批通知
- 点击跳转会话
- 远程 webhook 触发

**使用场景**：

- 接收会话通知
- 跳转到对应会话
- 配置通知选项

### dsh-my-observability（可观测性）

**功能**：

- 系统监控
- 性能指标
- 日志收集
- 告警通知

**使用场景**：

- 监控系统状态
- 查看性能指标
- 收集日志信息
- 配置告警规则

### dsh-my-opencode-session-header（会话头部）

**功能**：

- 会话头部信息
- 会话元数据
- 会话配置
- 会话统计

**使用场景**：

- 查看会话信息
- 配置会话选项
- 查看会话统计

### dsh-my-plugin-manager（插件管理）

**功能**：

- 插件列表查看
- 插件安装/卸载
- 插件更新
- 插件配置

**使用场景**：

- 管理已安装插件
- 安装新插件
- 更新插件版本
- 配置插件选项

### dsh-my-remote（远程连接）

**功能**：

- 远程服务器连接
- 远程命令执行
- 远程文件传输
- 远程会话管理

**使用场景**：

- 连接远程服务器
- 执行远程命令
- 传输远程文件
- 管理远程会话

### dsh-my-skill-manager（技能管理）

**功能**：

- 技能列表查看
- 技能启用/禁用
- 技能配置
- 技能统计

**使用场景**：

- 管理已安装技能
- 启用/禁用技能
- 配置技能选项
- 查看技能统计

### dsh-plugin-dev-mode（开发模式）

**功能**：

- 插件开发模式
- 开发工具集
- 开发配置
- 开发文档

**使用场景**：

- 开发新插件
- 调试插件问题
- 测试插件功能

### dsh-session-title-gen（会话标题生成）

**功能**：

- 自动生成会话标题
- 标题优化
- 标题统计
- 标题配置

**使用场景**：

- 自动生成会话标题
- 优化标题质量
- 查看标题统计

### dsh-shared（共享工具包）

**功能**：

- 共享工具函数
- 共享类型定义
- 共享配置
- 共享常量

**使用场景**：

- 复用通用代码
- 统一类型定义
- 共享配置选项

### dsh-task-reliability（任务可靠性）

**功能**：

- 任务状态监控
- 任务重试机制
- 任务超时处理
- 任务日志记录

**使用场景**：

- 监控任务状态
- 自动重试失败任务
- 处理任务超时
- 查看任务日志

### dsh-think-zh-expand（中文思考扩展）

**功能**：

- 思考内容中文显示
- 思考内容展开
- 界面中文化
- 思考内容优化

**使用场景**：

- 查看中文思考内容
- 展开思考内容
- 使用中文界面

### dsh-ts-example（TypeScript 示例）

**功能**：

- TypeScript 插件示例
- 最佳实践示例
- 开发模板
- 文档示例

**使用场景**：

- 学习插件开发
- 参考最佳实践
- 使用开发模板

## 插件依赖关系

```
dsh-shared (基础库)
├── dsh-file-activity
├── dsh-md-render
├── dsh-mermaid-render
├── dsh-my-context
├── dsh-my-guard
├── dsh-my-guardian
├── dsh-my-memory
├── dsh-my-notify
├── dsh-my-observability
├── dsh-my-opencode-session-header
├── dsh-my-plugin-manager
├── dsh-my-remote
├── dsh-my-skill-manager
├── dsh-session-title-gen
├── dsh-task-reliability
├── dsh-think-zh-expand
└── dsh-ts-example
```

## 安装建议

### 基础安装

```bash
# 安装核心插件
dsh plugin install dsh-shared dsh-file-activity dsh-md-render
```

### 完整安装

```bash
# 安装所有插件
dsh plugin install dsh-shared dsh-file-activity dsh-md-render dsh-mermaid-render dsh-my-context dsh-my-guard dsh-my-guardian dsh-my-memory dsh-my-notify dsh-my-observability dsh-my-opencode-session-header dsh-my-plugin-manager dsh-my-remote dsh-my-skill-manager dsh-plugin-dev-mode dsh-session-title-gen dsh-task-reliability dsh-think-zh-expand dsh-ts-example
```

### 开发者安装

```bash
# 安装开发相关插件
dsh plugin install dsh-shared dsh-plugin-dev-mode dsh-ts-example
```

## 更新日志

### 最新版本

- **dsh-file-activity 0.5.8**：文件活动监控
- **dsh-md-render 0.1.8**：Markdown 渲染
- **dsh-mermaid-render 0.1.7**：Mermaid 图表渲染
- **dsh-my-context 0.1.4**：上下文管理
- **dsh-my-guard 0.1.5**：守护进程
- **dsh-my-guardian 0.4.1**：插件守护
- **dsh-my-memory 0.1.7**：记忆管理
- **dsh-my-notify 0.3.9**：通知系统
- **dsh-my-observability 0.3.1**：可观测性
- **dsh-my-opencode-session-header 0.1.0**：会话头部
- **dsh-my-plugin-manager 0.1.5**：插件管理
- **dsh-my-remote 0.1.2**：远程连接
- **dsh-my-skill-manager 0.1.7**：技能管理
- **dsh-plugin-dev-mode 0.1.0**：开发模式
- **dsh-session-title-gen 0.1.0**：会话标题生成
- **dsh-shared 0.1.4**：共享工具包
- **dsh-task-reliability 0.4.7**：任务可靠性
- **dsh-think-zh-expand 0.4.8**：中文思考扩展
- **dsh-ts-example 0.1.0**：TypeScript 示例

## 联系方式

如有问题，请通过以下方式联系：

- GitHub Issues：[提交问题](https://github.com/baosfeng/my-dsh-plugins/issues)
- Discussions：[社区讨论](https://github.com/baosfeng/my-dsh-plugins/discussions)

---

_最后更新: 2025-09-13_
