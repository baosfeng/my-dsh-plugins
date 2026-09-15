# 贡献指南

## 提交前必做

1. 门禁：**源码改动**跑 `npm run verify`（CI 等价全量）；**纯文档改动不跑测试套件**——按 [docs/开发指南/文档规范.md](docs/开发指南/文档规范.md) 第六节做两条 grep 自检后 `git push --no-verify` 推送，其余交给 CI。
2. 插件级测试：`cd plugins/<插件名> && npm test`。
3. 改动插件行为时同步该插件的 `CHANGELOG.md`（最新版本段）与 `README.md`。
4. 文档改动遵守 [docs/开发指南/文档规范.md](docs/开发指南/文档规范.md)：精简、只写「怎么跑 / 防复发 / 指针」、不保留历史信息。

## 提交信息规范

Conventional Commits：`<type>(<scope>): <描述>`（commitlint + husky 强制）。

| type                   | 用途               |
| ---------------------- | ------------------ |
| feat / fix             | 新功能 / 缺陷修复  |
| docs                   | 仅文档             |
| refactor / perf        | 重构 / 性能        |
| test / build / ci      | 测试 / 构建 / CI   |
| chore / style / revert | 杂项 / 格式 / 回滚 |

## 分支与 PR

- 分支名 `fix/<issue 编号>` / `feat/<issue 编号>`；改动优先在 fork 池隔离环境做：`node scripts/fork-pool.mjs create <编号>`。
- PR 必须关联 issue（正文 `Closes #<编号>`），描述含改动说明与验证结果（命令 + 关键输出）。
- 合并条件：CI 全绿 + 至少 1 个批准 + 无未解决意见。

## 发版

流程见 [docs/开发指南/发版流程.md](docs/开发指南/发版流程.md)；tag 格式 `<包名>@v<版本>`。

## 报告问题

用 [issue 模板](https://github.com/baosfeng/my-dsh-plugins/issues/new/choose)；需求类想法先开 issue 再开发。

## 许可

MIT。参与即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。
