# 迁移后症状速查

> 症状 → 最可能根因的映射，对任何 DSH 版本迁移都适用。这不是完整故障目录：确认根因仍要读目标 tag 的一手源码；未列出的症状回到 [pre-flight.md](pre-flight.md) 的七类触点与 [SKILL.md](../SKILL.md) 的分层验证逐层排查。

| 症状                                                               | 最可能根因                                                                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 面板 / 悬浮球静默消失，插件不在 boot 图里，通常完全没有报错        | `dsh.client.inject` 仍引用已被移除的包（幽灵依赖），该 row 进不了图；或注册 id / assembly row 名与包名不一致；或 patch 层把它标成 `disabled: true` |
| 启动断言 `loaded without registering "<id>"`                       | 客户端 bundle 的注册 id（`__ModuleLoader__.load` 的 id 或打包 banner 里的插件 id）≠ `package.json` 的 `name`，或 assembly row 的 `name` 不是裸包名 |
| `web boot: N entries did not activate`、`waiting for service: xxx` | 引用了已被移除的内部服务（例如传输层拆除后仍 `require` 它），row 永远停在 pending；或 inject 仍指向已移除的包                                      |
| 插件能加载，但功能半失效，控制台报 factory 错误                    | 会话内容读取路径断裂（按 session 的快照结构被移除），或 composer 的 DOM 结构漂移                                                                   |
| 连接 / 选择工作区抛错但插件仍能启动                                | Client Runtime 拆分后工作区服务只剩列表与 CRUD，导航与目录选择器已迁到别处；旧的 baseline / recent 字段已删除                                      |
| 旧宿主报 `missed the module table`                                 | 客户端 bundle 在求值期硬依赖只存在于目标 cohort 的模块（跨 cohort 共存问题）                                                                       |

未列出的症状：先按七类触点重扫一遍，再用分层验证逐层定位，不要凭症状名字猜接口。
