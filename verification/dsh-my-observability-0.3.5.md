# 发版前验证清单 — dsh-my-observability@0.3.5

- 本次发版内容：`dsh-shared` peer → dependencies
- 验证环境：纯净独立 `DSH_HOME=/tmp/dsh-verify-batch`（全新目录，未复制任何生产配置），
  profile `batch1` 由 shipped `web` 模板派生（`dsh --profile batch1 --from-default-profile web`）
- 安装方式：`dsh plugin --profile batch1 add <tarball>`——与市场用户 `dsh plugin add <pkg>` 同一条链路
  （pnpm 装包 + dependencies 自动解析），不是把源码 link 进 profile
- 覆盖范围：9 个待发版包**同一次**安装、同一次启动（验证共存与注册无冲突），非单插件隔离
- 验证主体：agent 在纯净 profile 内做**安装 + 启动级**验证。口径来自用户此前明确要求：
  「找个纯净的 profile，然后启动一下，只要没报错就可以了」——本清单只声明该项，
  **不声称**做过浏览器功能走查

## 已验证（可复现判据）

- [x] 安装成功且依赖自动补齐：9 个包一次装完；`dsh-shared@0.1.6` 作为 dependencies 自动装入
      （修复前它是 peer，pnpm 不装 → 单装即 failed to import）
- [x] 启动无报错：日志无 `failed to import` / `Cannot find module` / `failed to load`；
      唯一的 stderr 是宿主既有的 Node `DEP0180 fs.Stats` 弃用告警（非插件输出）
- [x] 就绪与鉴权：出现 `dsh web: http://127.0.0.1:3096/?token=…`；根路径无 token → 401
- [x] 插件运行时副作用正常：`$DSH_HOME/guardian`、`$DSH_HOME/memory`、`task-reliability.json` 均按预期落盘；
      `/guardian/api/state` 带 token → 200
- [x] 缺陷本体回归对照：同一纯净环境装 npm 已发布旧版 `dsh-my-context@0.1.5` → 启动日志出现
      `my-context (dsh-my-context): failed to import`；装本次修复包 → 该行消失

## 未验证项（如实记录，未跑过的没有写成通过）

- [ ] 浏览器功能级走查（各页签交互、设置页、事件流联动）：按仓库约定归用户本人完成
- [ ] 真实模型 / 真实网关出站路径
- [ ] Windows 桌面端
