# language: zh-CN
# 需求来源：GitHub issue + docs/任务可靠性/概述.md（需求 13：配置可视化，issue #27）
# 验收基准：host-config.mjs 的 Gherkin 化表达

功能: 任务可靠性配置可视化
  作为 DSH 用户
  我想要在设置页查看和编辑任务可靠性插件的配置项
  以便不手动编辑配置文件也能调整超时重试、自动继续等行为

  场景: 设置页读取当前配置
    假如 任务可靠性插件已启动
    当 读取配置接口
    那么 响应状态码为 200
    并且 配置包含默认值 "retryMax=3 maxLoop=8 maxVerify=3"
    并且 配置包含 "autopilot=false rateMaxActions=12"

  场景: 保存配置后读取值正确
    假如 任务可靠性插件已启动
    当 保存配置 "retryMax=5 maxLoop=10 autopilot=true"
    那么 响应状态码为 200
    并且 读取配置得到 "retryMax=5 maxLoop=10 autopilot=true"

  场景: 保存后重试上限立即生效
    假如 任务可靠性插件已启动
    当 保存配置 "retryMax=1"
    并且 代理 "s-1" 的模型请求以 TIMEOUT 失败
    那么 插件返回重试动作且不委托 next
    当 代理 "s-1" 的模型请求以 TIMEOUT 失败
    那么 插件委托 next 处理

  场景: 配置持久化重启不丢
    假如 任务可靠性插件已启动
    当 保存配置 "retryMax=9 autopilot=true"
    并且 模拟重启
    那么 读取配置得到 "retryMax=9 autopilot=true"

  场景: 非法配置被拒绝
    假如 任务可靠性插件已启动
    当 保存非法配置 "null"
    那么 响应状态码为 400
    并且 读取配置得到 "retryMax=3"（未被修改）
