# Changelog

本文件记录 dsh-file-activity 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.10] - 2026-09-16

### 变更

- test: #343 存量固定 sleep 收敛（whenReady / drained / 渲染态可观测） (#363)
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- chore(artifacts): #318 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed） (#325)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(security): #314 修复代码扫描 error/warning 告警（5 类规则） (#316)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除未使用的导入，修复#66, #65, #54告警
- fix: 修复日志注入，修复#26, #25告警
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- fix: 修复 GitHub Code Scanning 安全漏洞 (43 个)
- fix(security): fix file system race conditions and missing regex anchor (#289)
- fix(security): use tmp library for secure temporary file creation

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
