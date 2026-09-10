# language: zh-CN
# 需求来源：OpenCode Go 网关要求推理请求携带 x-opencode-session（否则 400 MissingSessionID）
# 上游 discussion：https://github.com/deepseek-ai/deepseek-harness/discussions/5495
# 验收基准：test/header.mjs 的 Gherkin 化表达；新增需求须在此补充场景

功能: opencode 会话头注入
  作为 DSH 用户
  我想要走 opencode-go 的推理请求自动携带 x-opencode-session 会话头
  以便 OpenCode Go 网关不再返回 400 MissingSessionID

  场景: opencode 路由的推理请求带会话头
    假如 会话头注入插件已启动
    当 provider "opencode" 的会话 "session-9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F" 向 "https://opencode.ai/zen/go/v1/chat/completions" 发起推理
    那么 出站请求头 "x-opencode-session" 为 "9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F"
    并且 流内容为 "a"

  场景: 同一会话跨轮次得到同一个值
    假如 会话头注入插件已启动
    当 provider "opencode" 的会话 "sess-11111111-2222-4333-8444-555555555555" 向 "https://opencode.ai/zen/go/v1/chat/completions" 发起推理
    并且 provider "opencode" 的会话 "sess-11111111-2222-4333-8444-555555555555" 向 "https://opencode.ai/zen/go/v1/chat/completions" 再次发起推理
    那么 每一轮出站请求头 "x-opencode-session" 均为 "11111111-2222-4333-8444-555555555555"

  场景: 非 opencode provider 不注入
    假如 会话头注入插件已启动
    当 provider "deepseek" 的会话 "sess-1" 向 "https://opencode.ai/zen/go/v1/chat/completions" 发起推理
    那么 出站请求头 "x-opencode-session" 不存在

  场景: opencode 之外的主机不注入
    假如 会话头注入插件已启动
    当 provider "opencode" 的会话 "sess-1" 向 "https://api.example.com/v1/chat/completions" 发起推理
    那么 出站请求头 "x-opencode-session" 不存在

  场景: 无会话 id 时不注入（退化）
    假如 会话头注入插件已启动
    当 provider "opencode" 未提供会话 id 向 "https://opencode.ai/zen/go/v1/chat/completions" 发起推理
    那么 出站请求头 "x-opencode-session" 不存在
    并且 产生了 1 条退化告警

  场景: 已有会话头默认不覆盖
    假如 会话头注入插件已启动
    当 provider "opencode" 的会话 "sess-real" 向 "https://opencode.ai/zen/go/v1/chat/completions" 发起推理且已带会话头 "preset"
    那么 出站请求头 "x-opencode-session" 为 "preset"

  场景: 覆盖开关开启时覆盖已有会话头
    假如 会话头注入插件已启动且覆盖开关开启
    当 provider "opencode" 的会话 "sess-real" 向 "https://opencode.ai/zen/go/v1/chat/completions" 发起推理且已带会话头 "preset"
    那么 出站请求头 "x-opencode-session" 为 "sess-real"

  场景: 并发两个会话不串号
    假如 会话头注入插件已启动
    当 provider "opencode" 的会话 "a-11111111-1111-4111-8111-111111111111" 与会话 "b-22222222-2222-4222-8222-222222222222" 的推理流被交替消费
    那么 第 0 个出站请求头 "x-opencode-session" 为 "11111111-1111-4111-8111-111111111111"
    并且 第 1 个出站请求头 "x-opencode-session" 为 "22222222-2222-4222-8222-222222222222"

  场景: 消费方提前中断时关闭内层流
    假如 会话头注入插件已启动
    当 消费方在第一个 chunk 后中断 provider "opencode" 的会话 "sess-1" 的推理流
    那么 内层流已被关闭

  场景: 插件卸载后还原 fetch
    假如 会话头注入插件已启动
    当 插件被卸载
    那么 globalThis.fetch 已还原为安装前的值

  场景: 非法配置启动即报错
    当 用 providers 为空数组的配置启动插件
    那么 启动报错信息包含 "providers"
