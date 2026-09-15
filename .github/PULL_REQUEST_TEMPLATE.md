---
name: Pull Request
about: 提交代码变更（评审清单：测试/文档/回归/发版校验）
title: ''
labels: ''
assignees: ''
---

## 变更说明

<!-- 简述本次变更内容与动机（关联 issue 编号）。 -->

## 关联 issue

<!-- 如 #46 -->

## 评审清单

<!-- 逐项勾选，全部通过才可合并。 -->

- [ ] **测试通过**：CI 全绿（`node --check` + 插件冒烟测试 + eslint lint + TS 类型检查）
- [ ] **文档更新**：`docs/` 与 README 已同步（功能/UI 变化时 README 效果图已更新）
- [ ] **回归检查**：对照对应 issue 的验收标准逐条回归，既有功能无破坏
- [ ] **发版校验**：涉及发版时版本号 / CHANGELOG / tag 三者一致
- [ ] **提交规范**：提交信息符合 Conventional Commits（feat/fix/docs/style/refactor/test/chore/ci）

## 测试证据

<!-- 贴出关键测试输出（如 `npm test` 结果、CI 链接）。 -->

## 备注

<!-- 其他需要评审者注意的事项。 -->
