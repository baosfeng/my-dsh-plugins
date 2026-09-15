# language: zh-CN
# 需求来源：GitHub issue + docs/远程控制/概述.md（issue #75 验收标准的 Gherkin 化表达）
# 验收基准：host-smoke.mjs / events.mjs / commands.mjs / routes.mjs 的 Gherkin 化表达

功能: 远程控制
  作为 DSH 用户
  我想要在离开电脑后仍能收到关键事件并远程回答 ask、批准 approval
  以便会话不挂起、任务持续推进

  场景: ask 事件下发，手机远程回答后 agent 继续执行
    假如 远程控制插件已启用
    当 agent 调用 ask_user_question 询问 "是否继续部署？"
    那么 事件下行到外部通道，帧含 kind=ask、问题文本与可选选项
    当 查询状态接口
    那么 状态接口显示该会话有 1 个待回答的 ask
    当 外部经 POST /remote/api/command 提交 action=answer 与回答 "继续"
    那么 ask 等待方收到注入回答，agent 拿到 answers 继续执行
    当 查询状态接口
    那么 该 ask 从待回答列表消失

  场景: approval 事件下发，手机远程批准后工具放行
    假如 远程控制插件已启用
    当 DSH 发出 approval/request 原因="执行 bash 命令"，工具="bash"
    那么 事件下行到外部通道，帧含 kind=approval、原因与工具名
    当 外部经 POST /remote/api/command 提交 action=approve、outcome=allowed-once
    那么 approval 等待方返回 allowed-once，本批准对应的工具请求被放行
    当 查询状态接口
    那么 该 approval 从待批准队列消失

  场景: 未配置 token 时写指令被拒并留审计
    假如 插件配置了 apiToken "tok" 与一个接收事件的中转 webhook
    当 外部不带 x-remote-token 头提交写指令
    那么 接口返回 403 invalid x-remote-token
    当 查询审计接口
    那么 审计接口出现一条 ok=false、详情含 token 的记录

  场景: 未知指令被拒绝并留审计
    假如 远程控制插件已启用
    当 外部提交一个白名单外的动作 比如 action=hack
    那么 接口返回 400 unknown command
    当 查询审计接口
    那么 审计接口出现一条对应动作、ok=false 的记录

  场景: 会话结束事件下行并释放未决审批
    假如 远程控制插件已启用
    当 agent 进入 idle 本轮会话结束
    那么 事件下行到外部通道，帧含 kind=end
    并且 该会话未决议的 approval 被按 rejected 处理
    并且 该未决议的 ask 被视为过期，不再可回答