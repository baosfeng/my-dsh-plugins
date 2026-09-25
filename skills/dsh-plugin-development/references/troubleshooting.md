# 常见错误 · 运行时故障排查 · 需要避免的坑

> 承接 [../SKILL.md](../SKILL.md) 的「开发流程」第 7–8 步与 `plugin-runtime-debug` skill 的增量；排错用的症状表与修复纪律在本文件（被移出的正文逐字保留）。

## 常见错误

| 症状                                                                       | 根因                                                                                          | 解决                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"tab type ... already registered"`                                        | 重复注册：HMR 残留或 id 冲突                                                                  | 注册必须包 `ctx.effect`；id 全局唯一（内置 explorer/git/terminal 等不可占用）                                                                                                    |
| `cannot get property "tools" without inject`（tools）                       | 工具型插件没声明 `inject: ['tools']`（插件 fiber 里访问未声明的服务会抛这个）                  | `export const inject = ['tools']`；若已声明却仍见 `cannot get required service "tools" in inactive context`，那是等待期访问（服务未激活），改用 `ctx.inject([...], cb)`                                    |
| 工具注册了但 agent 从不调用                                                | `description` 写得不够好                                                                      | description 是 agent 决策依据，写清用途与参数                                                                                                                                    |
| Release workflow 在 `Verify the git tag matches package.json version` 失败 | 校验比较格式不一致（历史 bug：`expected` 带 `v` 前缀而 tag 解析的 `VERSION` 不带）            | 校验必须比较**裸版本**：`expected="$(node -p ...)"`（不带 v），与 tag `@v` 后部分一致；改后删 tag 重推（`git tag -d <tag> && git push origin :refs/tags/<tag>`）                 |
| schema 类型推断/校验失败                                                   | `required` 数组、`required: false`、缺 `additionalProperties`                                 | 属性级 `required: true`；对象 schema 显式 `additionalProperties: false`（官方 tools.zh.md）                                                                                      |
| 页面没效果                                                                 | 只改了 server 端没重启；或没硬刷新                                                            | server 改动重启 `dsh web`；client 改动 Cmd/Ctrl+Shift+R                                                                                                                          |
| `duplicate loader entry id`                                                | profile 里手动 insert + bundle patch 自动插入重复                                             | 删掉手动行，只用 `dsh plugin` 安装                                                                                                                                               |
| `ctx.sidebarRightTabs` undefined                                           | 没声明 inject，或服务未加载                                                                   | `inject: ['slots', 'sidebarRightTabs']`；可选场景用 `ctx.get` 判空降级                                                                                                           |
| 双 Cordis / 类型分裂                                                       | 同时引用 unscoped 与 scoped cordis                                                            | 全链统一一个 cordis（本仓库用 `cordis` peer + link 安装）                                                                                                                        |
| HMR 后状态错乱                                                             | disposer 没被 fiber 持有                                                                      | `ctx.effect(() => register(...))`，绝不裸调                                                                                                                                      |
| 页签偶发"纯文字无样式"                                                     | 样式注入放在服务判空早退（`if (service === undefined) return`）之后，HMR/服务重载瞬间跳过注入 | **样式注入必须放 `apply` 最前、无条件执行**（不依赖任何服务），每个 fiber 持自己的 `<style>`、disposer 只删自己的（详见 [踩坑：插件页签样式丢失](../../../docs/踩坑/README.md)） |

## 运行时故障排查（plugin-runtime-debug 增量）

> 插件在浏览器运行时行为异常（粘贴/附件/合成器"第一次成功后续失败"、chips/面板陈旧占位、版本芯片报错）时，**先读宿主源码契约，不要按 API 名字猜**——对方 skill 的排查方法补充到本仓库调试场景：

1. **读宿主源码契约**（npm 全局安装的 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/`）：打开插件调用的宿主 API 实现，读 doc 注释、guards、比较的类型。三个问题覆盖多数事故：
   - **offset 数的是哪个字符串**？发布快照字段与内部编辑器投影不一定是同一个字符串，喂错表示会静默失败（返回 false/no-op，不抛错）。
   - **每个"单位"在各表示中占多宽**？chips/tokens/attachments 等不透明内联单位在发布字段与 verb guard 的投影中宽度不同时，offset 只在无单位时正确。
   - **verb 拒绝时谁发现**？布尔返回的 verb 静默失败会变成下游状态 bug（调用方照删自己的簿记，UI 渲染"缺失"占位符）——审计每个调用点的"fire, ignore result, clean up anyway"形态。
2. **症状族定位**：首次成功后续失败 → 前次调用写入了状态改变了映射（修正推导后应用到**每个**传 offset 的调用点）；删除按钮留行 + 占位标签 → verb 拒绝但簿记已删（确认返回值后再退役簿记）；陈旧/幻影条目 → 从权威源派生视图，缓存只当加速器；版本芯片报错 latest → CDN 缓存滞后，用运行版本判定"当前 vs 更新"；整个 slot 静默消失 → slot 组件内 throw 被错误边界卸载（console-only），用防御性读取（`x?.items ?? []`）加固。
3. **修复纪律**：先精确陈述不匹配（哪个表示/哪个 guard/哪些调用点）再写修复；修**所有**传表示相关值的调用点，不只报错那个；用失败交互序列复现证明（连续两次操作行为一致 + 删除路径清空所有视图）。

## 需要避免的坑

> ⚠️ **开发前先读 [references/dsh-plugin-pitfalls.md](dsh-plugin-pitfalls.md)** — 14+ 个社区项目的实战踩坑清单（版本兼容 / 激活生命周期 / bundle 名册 / 构建 TS / 类型合并 / 运行时数据 / 安全进程 / UI 载体选型）。

- **不要**在 `apply` 里裸调 `registerTab`（不包 effect）——HMR/禁用后残留，下次激活报 already registered。
- **不要**在 client value-import 宿主 `@deepseek-ai/dsh-client-ui-*` 包——构建纯度门会挡；宿主能力只经 `inject` 服务名取，数据用 fetch 自己请求。
- **不要**在 README/文档里写 "Host 半"——本项目统一叫 **Server 端 / Client 端**。
- **不要**把 `.dsh-vision-toolkit/`、`node_modules/` 等提交进 git。
- 发版前核对：`package.json` 版本号、CHANGELOG 段落、tag 三者一致（workflow 会强校验版本，tag 格式错则直接失败）。
