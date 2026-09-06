# 插件 README 统一模板（v1）

> 来源：[issue #15](https://github.com/baosfeng/my-dsh-plugins/issues/15) 统一模板方案 + 2026-08-25 5 个插件 README 对齐实践（commit 85568f3）。
> **新插件 / 修改 README 时按此模板对齐**；`release.mjs` 已强制「效果截图」门禁（README 必须引用 `assets/` 下的真实截图——相对路径或 unpkg 绝对 URL，否则发版失败）。

## 标准章节

| 章节                  | 必选 | 说明                                                                                                                            |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 标题 + 生态 badge     | ✅   | `# <npm 包名>` + shields.io badge（如 `插件生态-topic dsh`）                                                                    |
| 效果截图              | ✅   | `assets/` 下真实截图（release.mjs 发布门禁强制），`<div align="center">` 居中，带 alt 说明                                      |
| 一句话简介            | ✅   | 加粗，说明插件做什么（一两行）                                                                                                  |
| `## 功能`             | ✅   | 编号列表（1./2./3.），server / client 分端标注（如 `### 1. xxx（Server 端）`）                                                  |
| `## 工作原理`         | ✅   | 架构 / 事件流 / 数据流，Server 端与 Client 端分点说明                                                                           |
| `## 安装`             | ✅   | 统一 clone + link 模板（issue #3 已统一）                                                                                       |
| `## 使用`             | 可选 | 交互说明（示例代码 / 截图）                                                                                                     |
| `## 配置`             | ✅   | 无配置项也要显式写「无配置项。插件激活即生效。」                                                                                |
| `## 依赖`             | 可选 | 表格：依赖 / 用途 / 可选（可选依赖标注「是」+ 用途说明）                                                                        |
| `## 与同类插件的关系` | 可选 | 避免用户重复安装（如 dsh-think-zh-expand ↔ @max-null/dsh-chinese-thinking）                                                     |
| `## 相关文档`         | ✅   | 指向 `docs/<模块>/` 模块文档 + 需求清单 + `CHANGELOG.md`（相对路径：README 在 `plugins/<name>/`，用 `../../docs/...` 回仓库根） |

## 相对路径与图片约定

- README 位于 `plugins/<name>/README.md`，引用仓库 `docs/` 用 `../../docs/<模块>/概述.md`；
- 截图位于 `plugins/<name>/assets/`，README 引用两种形态（release.mjs 校验均支持，文件必须真实存在）：
  - **相对路径** `./assets/xxx.png`（GitHub 仓库内渲染）；
  - **unpkg 绝对 URL** `https://unpkg.com/<npm包名>/assets/xxx.png`（**npm 包页面显示图片**——npm 不渲染相对路径，发布 npm 的包建议用此形态，GitHub 上同样可显示）；
- `docs/` 模块文档引用插件截图用 `../../plugins/<name>/assets/xxx.png`；
- `package.json` 的 `description` 建议中英双语（中文在前，英文在后）——npm 列表/包页面头部优先显示中文。

## 相关链接

- 各插件现有 README 均为按本模板对齐的实例（见 `plugins/<name>/README.md`）。
- 新插件脚手架可参考 [插件开发技能](../../skills/dsh-plugin-development/SKILL.md)。

> **README 模板维护**：本文件是插件 README 的唯一模板定义，修改模板后需同步检查各插件 README 是否仍对齐。
