# skills/

所有 Skill 放在这里，**一个 Skill 一个文件夹**，文件夹名用 kebab-case。

## 编写规范

```text
skills/<skill-name>/
├── SKILL.md          # 必需：触发描述与决策流程
├── scripts/          # 可选：Skill 自有脚本
└── references/       # 可选：按需加载的详细事实
```

`SKILL.md` frontmatter：

```markdown
---
name: skill-name
description: 一句话说明做什么、何时触发，以及重要的只读/写入边界。
---
```

- `name` 与文件夹名一致；`description` 同时说明操作与触发场景。
- 主文件只保留决策流程，详细材料放 `references/`；单文件正文 ≤200 行。
- 一个 Skill 聚焦一项用户目标；同一目标有只读/写入模式时先显式分流。
- 写操作必须先展示计划并取得确认。
- 文档写法遵守 [docs/开发指南/文档规范.md](../docs/开发指南/文档规范.md)（精简、不保留历史）。

## 收录清单

| Skill                                             | 说明                                                        |
| ------------------------------------------------- | ----------------------------------------------------------- |
| [development-lifecycle](development-lifecycle/)   | 本仓库需求 → 开发 → 验证 → 发版 → 收尾的主线流程编排        |
| [dsh-plugin-development](dsh-plugin-development/) | 五种插件形态、目录结构、开发/调试/发布与注册冲突排障        |
| [plugin-upgrade](plugin-upgrade/)                 | 只读检查更新 / 升级已安装插件 / 宿主兼容迁移 / 两版本间审计 |
| [plugin-write](plugin-write/)                     | 新建 DSH 插件、包名命名校验与中央注册表冲突查询             |
| [plugin-test](plugin-test/)                       | 按变更选择测试层级，覆盖真实组合与发布产物                  |
| [plugin-release](plugin-release/)                 | 打包、发布与分发：发布轨选择、门禁与回滚                    |
| [verifying-dsh-plugins](verifying-dsh-plugins/)   | 发版前功能级验证：隔离实例 + 真实浏览器/真实模型            |
| [dsh-github-triage](dsh-github-triage/)           | issue / PR / CI / 安全告警处理 + 需求登记 + fork 池隔离     |
| [plugin-runtime-debug](plugin-runtime-debug/)     | 对照宿主源码契约排查 Web 插件运行时故障                     |
| [resource-budget-review](resource-budget-review/) | 持续运行逻辑的磁盘/CPU/内存/网络/存量五维预算评审           |
