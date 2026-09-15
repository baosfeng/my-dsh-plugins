# language: zh-CN
# 需求来源：GitHub issue + docs/通知提醒/概述.md（需求 13：配置可视化，issue #27）
# 验收基准：host-config.mjs 的 Gherkin 化表达

功能: 通知提醒配置可视化
  作为 DSH 用户
  我想要在设置页查看和编辑通知插件的配置项
  以便不手动编辑配置文件也能调整通知行为

  场景: 设置页读取当前配置
    假如 通知插件已启动
    当 读取配置接口
    那么 响应状态码为 200
    并且 配置包含默认值 "end=true ask=true approval=true"
    并且 配置包含 "dedupeMs=3000"

  场景: 保存配置后读取值正确
    假如 通知插件已启动
    当 保存配置 "end=false subagentEnd=true dedupeMs=7000"
    那么 响应状态码为 200
    并且 读取配置得到 "end=false subagentEnd=true dedupeMs=7000"

  场景: 保存后立即生效（关闭 end 后不再推送结束通知）
    假如 通知插件已启动
    并且 有客户端订阅了实时通道
    当 保存配置 "end=false"
    并且 顶层代理 "s-off" 变为空闲
    那么 客户端未收到任何通知

  场景: 配置持久化重启不丢
    假如 通知插件已启动
    当 保存配置 "end=false apiToken=persist-tok"
    并且 模拟重启
    那么 读取配置得到 "end=false apiToken=persist-tok"

  场景: 非法配置被拒绝
    假如 通知插件已启动
    当 保存非法配置 "end=yes"
    那么 响应状态码为 400
    并且 读取配置得到 "end=true"（未被修改）
