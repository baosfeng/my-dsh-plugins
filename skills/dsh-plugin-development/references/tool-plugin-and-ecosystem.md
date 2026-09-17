# 工具型插件 · 外部生态 · 发布流程

> 承接 [../SKILL.md](../SKILL.md) 的「插件形态（先决策）」与「开发流程」第 9 步；defineTool 速览、分发渠道与发布门禁的完整说明在本文件（被移出的正文逐字保留）。

## 工具型插件（defineTool）速览

> 官方权威 API（dsh 插件最核心形态）：注册 agent 可调用的工具函数。完整细节见官方 [tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md) 与 [cookbook/adding-a-tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)。

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool' // 必须与 cordis.patch.yml 的 id 一致
export const inject = ['tools'] // 必须：否则 ctx.tools undefined

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'my_tool_func',
      description: '做某件事（agent 据此决定是否调用）',
      parameters: { arg: { type: 'string', description: '参数说明', required: true } },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean', required: true } },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: String(value.ok) }],
      },
      async execute(args) {
        return { ok: true }
      }, // 是 execute 不是 run
    }),
  )
}
```

**schema 硬规则：** ① `required` 是属性级（写 `required: true`，无 `required` 数组、无 `required: false`）；② 对象 schema 必须显式 `additionalProperties: false`；③ `output` 必填（schema + render 返回 `{ type: 'text', text }`）；④ 用 `execute(args)` 不是 `run`。

**开发调试：** `npx @dsh-io/dsh-dev scaffold <name>` 生成 TS 骨架（**第三方、非官方**脚手架，官方没有 scaffold 命令） → `npm run build` → `npx @deepseek-ai/dsh --profile web --patch <abs-path>/cordis.patch.yml` 对活 harness 调试 → `dsh plugin add <dir>` 永久注册。**本仓库 JS 约定差异**：官方骨架是 TypeScript（`@deepseek-ai/dsh-tools` 提供类型增强），本仓库插件为纯 JS（`lib/index.js` ESM）——API 相同、`defineTool` 同样可用，但**没有类型检查兜底，必须手动遵守上面的 schema 硬规则**。

## 外部生态与分发

- **本仓库分发约定（双通道）**：GitHub Release + **npm 官方 registry**（release.yml 读仓库 `NPM_TOKEN` secret 自动发布；未配置时仅警告跳过）。完整流程见 [docs/开发指南/发版流程.md](../../../docs/开发指南/发版流程.md)。
- **第三方脚手架（非官方）**：`npx @dsh-io/dsh-dev scaffold <name>` 生成 TS 骨架；官方没有 scaffold 命令，用前自行核实。
- **市场收录（本仓库已用）**：给公开仓库打 GitHub topic `dsh-plugin` 即被 dshfind.com 与 DSH 1024Store（deepseek1024.com）自动聚合收录；1024Store 收录前静态校验 `package.json` + `dsh.bundle.patch` + patch 文件齐备——可当发布自检参考。

## 发布流程（自动 / 手动）

**方式 A（推荐，全自动）**：仓库 Actions → **Release (auto)** workflow（选插件 + bump 类型）→ 自动 bump 版本、生成 CHANGELOG（git log 提取）、同步文档、打 tag、触发 GitHub Release + npm 发布。

**方式 B（本地手动，等价）**：`node scripts/release.mjs <插件名> --bump patch --push`（bump 版本 + CHANGELOG 生成 + 根 README/AGENTS 版本同步 + tag + push）。版本已手动改好时省略 `--bump`。

发版门禁（release.mjs 自动校验）：`peerDependencies.cordis` 已声明且 major 一致（**agent preset 资产包 `dsh.kind=preset` 豁免**，见 [../SKILL.md](../SKILL.md) 的「插件形态」）→ CHANGELOG 有当前版本段 → npm test 全绿 → README 效果截图引用有效（`./assets/` 或 unpkg URL）→ 文档版本同步 → tag。**验证发布结果**：GitHub Releases 页面确认 Release + `.tgz` 附件、npmjs.com 确认新版本（或 `npm view <包名> version --registry=https://registry.npmjs.org`）；失败时去 Actions 页看失败步骤（历史校验 bug 见 [踩坑：release 版本校验失败](../../../docs/踩坑/README.md)）。
