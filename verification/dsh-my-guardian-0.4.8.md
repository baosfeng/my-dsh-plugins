# 发版前验证清单 — dsh-my-guardian@0.4.8

- 本次发版内容：#488 前端注入的静态模块不再误判缺失（裸名 `dsh-client-ui-primitives` 回退
  `@deepseek-ai/<name>`、判定不再要求 `dsh.client`）；#481/#484 的 asar 宿主清单修复已随 0.4.5 发布
- 验证环境：纯净独立 `DSH_HOME=/tmp/dsh-verify-488`（全新目录，未复制任何生产配置），profile `g488`
  由 shipped `web` 模板派生（`dsh --profile g488 --from-default-profile web`）
- 安装方式：`dsh plugin --profile g488 add <npm pack tarball>`——与市场用户 `dsh plugin add <pkg>` 同一条链路
  （pnpm 装包 + dependencies 自动解析），不是把源码 link 进 profile；`dsh-shared@0.1.7` 自动补齐
- 宿主：`dsh` CLI 0.2.1-rc.2；运行期以 `DSH_APP_RESOURCES=/Applications/DeepSeek Harness.app/Contents/Resources`
  指向真实桌面安装，读取真实 `app.asar/dsh/desktop-runtime.json`（304 sharedPackages / 550 files）
- 验证主体：agent 在纯净 profile 内做**安装 + 启动 + #488 回归级**验证（用户本次指示「你来验收一下」）；
  本清单只声明这些项，**不声称**做过浏览器功能走查
- 回归夹具：profile 名册插入 `issue488-regression-app`，peer 声明裸名 `dsh-client-ui-primitives` /
  `dsh-client-ui-layout`、`react` / `react-dom`（误报面）+ `left-pad-xyz-nonexistent`（真缺失面）

## 已验证（可复现判据）

- [x] 安装成功：tarball 装完，`dsh-shared@0.1.7` 作为 dependencies 自动补齐
- [x] 冷启动无报错：`dsh-web.log` 仅一行就绪 `dsh web: http://127.0.0.1:3099/?token=…`，
      无 `failed to import` / `Cannot find module`；进程在加载插件树后仍存活
- [x] 误报归零：#488 场景（裸名 primitives / layout、react / react-dom）在
      `$DSH_HOME/guardian/startup-issues.json` 中 **0 条**；修复前裸名 primitives 会判缺失并给出
      `dsh plugin add dsh-client-ui-primitives`（诱导双实例）
- [x] 真缺失仍报：`left-pad-xyz-nonexistent` 仍为 `dependency-missing`，
      `installHint = dsh plugin add left-pad-xyz-nonexistent`
- [x] 宿主供给跳过可见：`skippedHostRows=163` + notes 说明，未被静默吞掉
- [x] 服务与鉴权：根路径无 token → 401；`/guardian/api/state` 带 token → 200（`safeMode:false`）；
      `$DSH_HOME/guardian/{state.json,startup-issues.json}` 按预期落盘
- [x] 收尾：实例停止、端口 3099 释放、隔离目录与回归夹具删除、`pgrep` 复查无残留进程

## 未验证项（如实记录，未跑过的没有写成通过）

- [ ] 浏览器功能级走查（guardian 面板页签交互、事件流、设置页）：本次改动只在 server 侧
      `dep-precheck`，client 产物未变；仍归用户按需走查
- [ ] 真实模型 / 真实网关出站路径
- [ ] Windows 桌面端（本次复验基于 macOS 桌面 asar 清单）