# language: zh-CN
# 需求来源：GitHub issue + docs/插件管理/概述.md（R1-R8）+ issue #28 + issue #90
# 验收基准：host-api.mjs / host-manage.mjs / host-registry.mjs 的 Gherkin 化表达；
# 新增需求（issue #28：已安装列表只显示用户安装的插件；issue #90：插件详情页）须在此补充场景
功能: 插件管理
  作为 DSH 用户
  我想要在设置页统一管理插件生命周期
  以便浏览市场、安装/卸载、检查更新、查看插件详情并只看到自己安装的插件

  场景: 已安装列表只显示用户安装的插件
    假如 loader 已加载官方插件 "@deepseek-ai/dsh-base"
    并且 loader 已加载官方插件 "cordis:include"
    并且 loader 已加载用户插件 "dsh-a"
    并且 loader 已加载用户插件 "@scope/dsh-b"
    当 请求已安装清单
    那么 响应包含 2 个条目
    并且 条目 "dsh-a" 存在且 official 为 false
    并且 条目 "@scope/dsh-b" 存在且 official 为 false
    并且 响应不包含官方插件 "@deepseek-ai/dsh-base"
    并且 响应不包含官方插件 "cordis:include"

  场景: 官方命名空间判定
    假如 插件名为 "@deepseek-ai/dsh-base"
    那么 该插件被判定为官方
    假如 插件名为 "cordis:include"
    那么 该插件被判定为官方
    假如 插件名为 "@koishijs/plugin-x"
    那么 该插件被判定为官方
    假如 插件名为 "dsh-my-notify"
    那么 该插件不被判定为官方
    假如 插件名为 "@anionex/dsh-vision-toolkit"
    那么 该插件不被判定为官方

  场景: 卸载与更新检查的候选集是已安装清单中的用户插件
    假如 loader 已加载官方插件 "@deepseek-ai/dsh-base"
    并且 loader 已加载用户插件 "dsh-a"
    当 请求已安装清单
    那么 响应包含 1 个条目
    并且 条目 "dsh-a" 存在
    并且 响应不包含官方插件 "@deepseek-ai/dsh-base"

  场景: 市场搜索不受官方过滤影响
    当 搜索关键词 "dsh" 返回官方与用户结果
    那么 搜索结果包含 "@deepseek-ai/dsh-base"
    并且 搜索结果包含 "dsh-a"

  场景: 插件详情返回 README、版本历史与对等依赖缺失
    当 请求插件详情 "dsh-a"
    那么 详情包含 README "hello readme"
    并且 详情版本历史包含 "1.0.0"
    并且 详情元数据包含许可证 "MIT"
    并且 详情对等依赖包含缺失 "dsh-shared"
    并且 详情对等依赖不缺失 "cordis"

  场景: 加载失败时插件详情返回失败
    当 加载不存在的插件详情 "ghost"
    那么 详情加载失败且给出错误消息

  场景: 跨站 API 请求被拒绝
    当 用非回环 host 请求已安装清单
    那么 响应状态码为 403
