# 预检 · 宿主升级前的触点自查

> 启发式扫描，不是兼容性证明：七类触点零命中只说明「当前模式没扫到」。仍须单独跑依赖与配置检查，并执行构建、真实挂载与功能冒烟。

扫描用的正则模式见 [pre-flight-patterns.json](pre-flight-patterns.json)；搜索请用当前环境提供的工具，不要照抄固定命令。

## 0. 先盘配置与依赖清单

扫全部受版本管理的源码、测试、脚本、CI 与根配置，排除生成产物、vendor 与依赖目录。至少记下：

- 插件版本、`peerDependencies`、`engines` 与 `@deepseek-ai/*` 导入；
- 实际解析到的版本与 lockfile（只信仓库真正使用的包管理器）；
- 社区标准 manifest（若采用）；
- profile composition：`cordis.patch.yml`、`agent.cordis.yml`、历史 `cordis.yml`；
- 真实安装轨：registry 包、Git checkout、workspace/junction，还是复制安装。

这些文件所有权不同，不能统称 manifest；未知字段不要整对象回写。

## 1. 构建版本走廊

1. 用精确 tag 确认 from/to；
2. 按 `from → to` 有向边连接走廊，禁止按文件名字典序；
3. 先读完整条走廊，把「中间版本删除、目标版又恢复」这类净变化合并后再出计划；
4. 缺走廊边时报告 unsupported gap 并先查一手来源，不凭记忆改插件。

## 2. ghost host：把 from 钉到真正运行的进程

就地升级源码 checkout（`git pull` / 切 tag）后，已在运行的宿主仍在内存里执行旧代码，而版本命令、`package.json` 与目录名全都显示新版本。此时从磁盘推导 from 会把走廊整整错钉一代：静态自查读的是新代码，结论却套在旧进程上。

两条检查，必须在任何触点扫描之前做：

1. **问进程，不问磁盘**：进程启动时间早于 checkout 最后一次变更即为 ghost——比较进程启动时间与 checkout 最后一次提交时间；
2. **发探针，不读版本号**：挑一个两代行为已知不同的请求打给目标宿主，按响应归类代次。同一份 `git describe` 下的两个进程在磁盘上无法区分，只有响应能区分。

两项检查加探针已封装为 [ghost-host-check.mjs](../scripts/ghost-host-check.mjs)：`node skills/plugin-upgrade/scripts/ghost-host-check.mjs <hostPid> <checkoutDir> [port]`，退出码 1 = ghost，可直接作 shell 门禁。

确认 ghost 后：重启宿主再跑自查，或明确把走廊的 from 钉到该进程的真实代次并写进报告。不要用磁盘上的新代码解释旧进程的行为。重启可能拆掉你自己正在运行的会话，该决定的安全面见 [SKILL.md](../SKILL.md) 的全局宿主升级纪律——这里是它的识别面。

## 触点 1 · 源码 patch / monkey patch

记录宿主目标路径与替换意图；目标 tag 里找不到对应归属模块时标「待确认」，不要猜路径。普通的 `cordis.patch.yml` 属于 profile composition，单独归类；文件名里带 `patch` 不算本类命中。

## 触点 2 · 内部事件名与持久化事件

区分生产者、持久化、重载、传输与普通观察者五种角色；未知的必需事件不能因为出现在白名单里就放过。

## 触点 3 · 内部服务探针 / Remote

同时记录调用所在的 face（Host / Web Client / 普通 Cordis plugin）与包入口；内部架构迁移不能当成面向所有插件的公共 API 建议。

## 触点 4 · 直接读写宿主目录

行级搜索看不出数据流：命中路径拼接后要继续追变量来源与写出去向。绝不打印配置内容、token、`.npmrc` 或会话日志。

## 触点 5 · 内部 UI / 命令 / 工具注册

区分公共 seam 与内部路径；命中旧 client runtime、会话或聊天 selector、slot 增强时，继续检查客户端注入声明、直接类型依赖、keyed 快照结构与 type-only Context 增强。顺手可用的新能力只作建议，不自动采用。

## 触点 6 · 自建 HTTP / WS / RPC / DOM / CSS 通道

检查认证、Host/Origin、端口生命周期与 teardown；「只监听回环」不是跳过认证的理由。

## 触点 7 · 子进程与 stdout/stderr 解析

记录 argv、cwd、env、取消、退出码与 stdout/stderr 归属；能启动进程远不算验证完成。

## 迁移任务摘要模板

```markdown
## 触点自查（<plugin>，<from> → <to>）

| 触点 | 命中 | 文件/行 | 置信说明 |
|---|---:|---|---|
| 1 patch | | | |
| 2 事件 | | | |
| 3 服务/Remote | | | |
| 4 文件系统 | | | |
| 5 UI/命令/工具 | | | |
| 6 自建通道 | | | |
| 7 子进程/输出 | | | |

零命中说明：<扫描范围、排除目录、单独检查的依赖与配置>
必须验证：<构建与类型检查、真实 profile 挂载、功能路径>
```
