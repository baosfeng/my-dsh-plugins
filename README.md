# my-dsh-plugins

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh--better--sidebar-4d6bfe)](https://github.com/topics/dsh-better-sidebar)

**个人 DSH（DeepSeek Harness）插件集合仓库**：轻量多插件目录，每个插件位于 `plugins/<name>/`，自包含、可独立安装与发布。

<div align="center">
  <table>
    <tr>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-file-activity/assets/screenshot.png" width="230" alt="dsh-file-activity 文件活动侧边栏" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-think-zh-expand/assets/think-markdown.png" width="230" alt="dsh-think-zh-expand 思考块渲染" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-mermaid-render/assets/mermaid-card.png" width="230" alt="dsh-mermaid-render 图表卡片" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-my-notify/assets/notify-toast.png" width="230" alt="dsh-my-notify 通知提醒 toast" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-task-reliability/assets/screenshot-panel.png" width="230" alt="dsh-task-reliability 任务可靠性面板" /></td>
    </tr>
    <tr>
      <td align="center"><sub>dsh-file-activity</sub></td>
      <td align="center"><sub>dsh-think-zh-expand</sub></td>
      <td align="center"><sub>dsh-mermaid-render</sub></td>
      <td align="center"><sub>dsh-my-notify</sub></td>
      <td align="center"><sub>dsh-task-reliability</sub></td>
    </tr>
  </table>
</div>

## 插件列表

| 插件                                                             | 版本  | 简介                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [dsh-file-activity](plugins/dsh-file-activity/README.md)         | 0.5.8 | 侧边栏文件活动页签：记录文件读取 / 新增 / 修改历史与统计，按文件夹树形展示，点击文件即浮窗预览（复用侧边栏内置渲染）；按会话隔离、重启后恢复                                                                                                                                                                                                                                                                  |
| [dsh-think-zh-expand](plugins/dsh-think-zh-expand/README.md)     | 0.4.8 | 思考增强：通过 system-prompt 注入让思考与回复强制使用中文；对话中思考内容默认展开显示（替代内置单行折叠），可点击收起、流式中保持展开；文本块与**思考块**都支持 Markdown 渲染（含表格 / Mermaid 图表）；界面英文标签中文化                                                                                                                                                                                    |
| [dsh-mermaid-render](plugins/dsh-mermaid-render/README.md)       | 0.1.7 | 对话 mermaid/mmd 代码块自动渲染为图表卡片（预览/代码切换），mermaid 引擎内联打包、零 CDN 依赖、完全离线可用；流式渲染稳健（等流式结束渲染，避免残缺态）                                                                                                                                                                                                                                                       |
| [dsh-md-render](plugins/dsh-md-render/README.md)                 | 0.1.8 | 非思考模式 markdown 表格渲染增强：模型输出的表格（含无首尾管道符、分隔行变体等不标准格式）自动识别并渲染为表格（表头/边框/对齐），宽表格横向滚动；兼容 dsh-think-zh-expand（tzx-md 容器）与内置 MarkdownText（md-table-wide 容器），思考模式表格渲染不受影响                                                                                                                                                  |
| [dsh-my-notify](plugins/dsh-my-notify/README.md)                 | 0.3.9 | 通知提醒：会话结束 / agent 询问（ask）/ 等待审批时弹浏览器通知 + 滴声提示，点击通知跳转对应会话；预留远程 hook 触发接口（`POST /notify/api/trigger`，支持可选 token），SSE 实时通道                                                                                                                                                                                                                           |
| [dsh-my-remote](plugins/dsh-my-remote/README.md)                 | 0.1.2 | 远程控制（issue #75）：ask / approval / 会话结束事件实时下行到外部通道（手机 / IM / 中转服务）；远程回答 ask、批准 approval（allowed-once）、查询会话状态、继续会话；apiToken + 指令白名单 + 操作审计；适配器契约支持微信/QQ/飞书机器人扩展                                                                                                                                                                   |
| [dsh-my-guardian](plugins/dsh-my-guardian/README.md)             | 0.4.1 | 插件治理：新装/更新插件先进候选区（cordis.staged.json），启动完成后由守护插件逐个热挂载——成功自动转正，失败自动隔离记录，连续失败冻结，一键安全模式，侧边栏诊断面板；守护插件自身永不拖垮进程（看门狗自保）                                                                                                                                                                                                   |
| [dsh-task-reliability](plugins/dsh-task-reliability/README.md)   | 0.4.7 | 任务可靠性保障：模型超时/请求失败自动重试、任务未完成自动继续（turn-stopping 注入）、独立完成度校验 agent（会话结束后判断，未完成唤醒继续）、思考重复检测与打断、休眠/重启后任务自动恢复、锁屏/休眠唤醒自动恢复（停滞看门狗）、ask 超时自动继续（问题记录待确认）、自主决策模式（出行防 ask 中断）、远程触发接口                                                                                              |
| [dsh-my-skill-manager](plugins/dsh-my-skill-manager/README.md)   | 0.1.7 | Skill 管理：分「全局 / 项目」查看 skill 列表（名称/描述/来源/状态），按项目启用/禁用——禁用的 skill 不再注入该项目会话（模型不可见、不可加载）；全局配置 `$DSH_HOME`，项目配置随仓库版本化；设置页面板（官方扩展点，纯官方依赖）                                                                                                                                                                               |
| [dsh-my-memory](plugins/dsh-my-memory/README.md)                 | 0.1.7 | 记忆：全局/项目两级记忆持久化（全局 `$DSH_HOME/memory.json` + 项目 `$DSH_HOME/memory/projects/<项目 id>.json`（issue #108 集中存储 + 旧数据自动迁移）），会话开始时全局记忆注入系统提示词（agent 始终携带关键偏好，条数/长度上限防膨胀）；设置页面板（全局/项目分区 + 自定义确认 UI：删除红色、保存绿色，写操作必须用户确认）；`memory_query` 只读查询工具 + `memory_save` 保存工具（经用户确认，issue #107） |
| [dsh-my-plugin-manager](plugins/dsh-my-plugin-manager/README.md) | 0.1.5 | 公共插件管理面板：市场浏览/搜索（npm registry）、一键安装/卸载（`dsh plugin` CLI 同一数据源）、更新检查（pnpm outdated）、已安装插件清单（官方 pluginInventory + 版本）；设置页面板（官方扩展点，纯官方依赖）                                                                                                                                                                                                 |
| [dsh-my-observability](plugins/dsh-my-observability/README.md)   | 0.3.1 | 可观测性 + Git 工程工具：事件审计（监听 agent/status、llm/stream、tools/*，agent 行为可追溯，按会话隔离、重启后恢复）、侧边栏轨迹回放时间轴面板（关键词搜索 + 组合过滤 + 命中高亮 + JSON/CSV 导出 + 工具统计）、结构化 Git 类型化提交（Conventional Commits）、提交前增量 diff 审查（规则引擎 + 可选 AI 审查）                                                                                                |
| [dsh-my-guard](plugins/dsh-my-guard/README.md)                   | 0.1.5 | 安全护栏：执行前护栏（破坏性命令 rm -rf / 等执行前拦截/确认，observe/ask/deny 三模式）、安装前投毒扫描（`dsh plugin add` 自动扫描包内容：可疑脚本/密钥/恶意依赖告警）、提示注入检测（规则 + 启发式检测 prompt injection / jailbreak，命中告警）；告警持久化 + 侧边栏安全护栏面板（确认机制）                                                                                                                  |
| [dsh-my-context](plugins/dsh-my-context/README.md)               | 0.1.4 | 上下文透镜 + 成本治理：token 用量可视化（每次请求的上下文构成、KV 缓存命中率，按会话隔离、重启后恢复）、每轮/每会话预算控制（token 上限，超限提醒/拦截，可配置）                                                                                                                                                                                                                                              |
| [dsh-session-title-gen](plugins/dsh-session-title-gen/README.md) | 0.1.0 | 会话标题自动生成（issue #160）：监听会话首条人类消息，LLM 生成类似 git commit 的结构化标题（先归属工作区后描述，如 `[my-dsh-plugins] 修复 #143 记忆页签崩溃`），经核心 session/title 事件写入（重启保留），失败自动回退核心标题机制                                                                                                                                                                           |
| [dsh-plugin-dev-mode](plugins/dsh-plugin-dev-mode/README.md)     | 0.1.0 | 插件开发模式 **agent preset**（非运行时插件）：唯一启用 Cordis 工具集（cordis_inspect_*/define/run/stop/undefine）的 Agent 预设，精简工具组合 + 随包技能，一键安装到 `$DSH_HOME/.agent-presets/`                                                                                                                                                                                                              |
| [dsh-ts-example](plugins/dsh-ts-example/README.md)               | 0.1.0 | TypeScript 插件开发示例（issue #47）：server 端 TS 源码 + tsc 编译（`lib/index.js` 产物）、client 端 TS 源码 + 构建时编译（`__ModuleLoader__` bundle）、CI 强制 `tsc --noEmit` 类型检查——编译期发现模块不存在（TS2307）/类型不匹配/未定义变量；新 TS 插件照抄本插件结构                                                                                                                                       |
| [dsh-shared](plugins/dsh-shared/README.md)                       | 0.1.3 | 共享工具包（issue #45）：多插件共用的 server 端工具——Host-header 信任围栏、HTTP JSON 读写、配置持久化（cordis.patch.yml）、项目根解析、异步与消息工具、原子写；依赖方在 dependencies 声明（npm 自动安装，依赖先发版）                                                                                                                                                                                         |

## 目录结构

```
├── plugins/          # 所有插件（每目录一个自包含插件）
│   ├── dsh-file-activity/
│   ├── dsh-think-zh-expand/
│   ├── dsh-mermaid-render/
│   ├── dsh-md-render/
│   ├── dsh-my-notify/
│   ├── dsh-my-remote/         # 远程控制（issue #75）
│   ├── dsh-my-guardian/
│   ├── dsh-task-reliability/
│   ├── dsh-my-skill-manager/
│   ├── dsh-my-memory/
│   ├── dsh-my-plugin-manager/
│   ├── dsh-my-observability/
│   ├── dsh-my-guard/
│   ├── dsh-my-context/
│   ├── dsh-session-title-gen/ # 会话标题自动生成（issue #160）
│   ├── dsh-plugin-dev-mode/   # agent preset 资产包（非运行时插件）
│   ├── dsh-ts-example/        # TypeScript 插件开发示例（issue #47）
│   └── dsh-shared/            # 共享工具包（issue #45）
├── skills/           # 本仓库的开发技能（SKILL.md 格式，可安装到 ~/.dsh/skills/）
│   └── dsh-plugin-development/
├── docs/             # 通用文档与设计文档
└── .github/workflows/  # CI（遍历插件测试）与 Release（tag 触发）
```

## 开发新插件

仓库内自带开发技能（SKILL.md 格式，安装方式见下）：

- [skills/dsh-plugin-development/SKILL.md](skills/dsh-plugin-development/SKILL.md) — 插件开发/修改/调试/发布
- [skills/dsh-issue-request/SKILL.md](skills/dsh-issue-request/SKILL.md) — 把新需求整理成规范 issue 提交到本仓库（需求追踪）

```sh
# 将技能安装到个人技能目录（可选，便于 DSH 会话自动加载）
cp -r skills/dsh-plugin-development ~/.dsh/skills/
cp -r skills/dsh-issue-request ~/.dsh/skills/
```

新插件骨架：

1. 按技能指引在 `plugins/<新插件名>/` 下创建自包含插件包（package.json + cordis.patch.yml + lib/ + README + CHANGELOG + LICENSE）。
2. 本地安装验证：`dsh plugin --profile web add link:<本仓库绝对路径>/plugins/<新插件名>`（对普通用户的安装方式见各插件 README「安装」章节：先 clone 仓库再 link）。
3. 更新本 README 插件列表与 `plugins/<新插件名>/README.md`（中文 + 截图 + 生态 badge）。
4. 发版：更新版本号与 CHANGELOG → 推送 tag `<包名>@v<版本>` → GitHub Actions 自动创建 Release。

## 发布约定

- **双通道发布**：GitHub Release（tag 触发自动打包）+ **npm 官方 registry**（[release.yml](.github/workflows/release.yml) 读取仓库 `NPM_TOKEN` secret 自动 `npm publish`；未配置时仅警告跳过）。
- **自动发版**：仓库 Actions → **Release (auto)** workflow（选择插件 + bump 类型）→ 自动 bump 版本、生成 CHANGELOG（git log 提取）、打 tag → 触发自动发布 GitHub Release + npm。手动发版：`node scripts/release.mjs <插件名> --bump patch --push`。
- tag 格式：`<包名>@v<版本>`（如 `dsh-file-activity@v0.1.0`）。
- 每个插件独立版本号（semver）、独立 CHANGELOG（Keep a Changelog 格式）。

## 许可

每个插件各自携带 MIT LICENSE；仓库级文档默认 MIT。
