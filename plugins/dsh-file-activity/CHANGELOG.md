# Changelog

本文件记录 dsh-file-activity 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.9] - 2026-09-13

### 变更

- chore: 项目全面优化和完善
- fix(dsh-file-activity): #266 侧边栏席位按宿主空 props 契约加载，面板打开即刷新 + 补 guide 菜单入口 (#268)
- chore(release): #198 dsh-shared 0.1.4 + 消费方 peerDeps 同步 + 文档收口 (#254)
- refactor(file-activity): #187 批 2 迁移到宿主原生侧边栏 API（移除 better-sidebar，含实测证据） (#249)
- #184 依赖升级：矩阵脚本 + A 档落地 + jscpd 解锁 + dependabot 覆盖插件目录 (#235)
- perf(scripts): #188 优化 pre-push 校验耗时（并发 6 + 收窄退化 + 补 D + file-activity 测试提速） (#234)
- fix(dsh-file-activity): #197 写放大 3665× 与状态无界 (#207)
- fix(release): 批量提交信息 header 控制在 commitlint 限制内
- feat(ts): 第四轮 JS→TS 迁移（5 个插件，server + client 全量）
