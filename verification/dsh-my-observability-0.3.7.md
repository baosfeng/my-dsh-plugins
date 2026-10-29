# 发版前人工自测清单 — dsh-my-observability@0.3.7

- 验证环境：隔离实例 DSH_HOME=`/private/tmp/dsh-verify-3157/dsh-home`（独立 HOME=`/private/tmp/dsh-verify-3157/user-home`）/ 端口 3157（有 DSH_HOME）与 3160（无 DSH_HOME）/ Chrome for Testing（agent-browser 驱动，独立浏览器）
- 待验插件处于启用态：是（隔离副本内移除 `disabled: true`，生产配置未改）
- 验证执行者：agent（用户明确授权「你自己新开一个端口进行独立验证」）

## 功能级验证项（逐条勾选）

- [x] 有 DSH_HOME：真实会话一轮后 `$DSH_HOME/observability/audit.jsonl` 生成 11 条事件（`agent_status` ×2 / `user_message` ×5 / `llm_stream` ×4），`GET /observability/api/events` 返回 200
- [x] 无 DSH_HOME（本次修复重点）：HOME 隔离实例同轮会话后，审计日志落 `$HOME/.dsh/observability/audit.jsonl`；**`$HOME/observability` 不存在**（修复前会写到这里）
- [x] 与 dsh-my-context 落点一致：两者在同一次真实事件流里各自写入，互不覆盖
- [x] client UI：设置页/面板相关入口渲染正常，浏览器 Console 无未捕获异常
- [x] 资源护栏：隔离实例全程磁盘写入为 append-only JSONC 行（无全量重写迹象），会话结束后无异常增长

## 未验证项与环境限制

- 用户日常 desktop profile 主实例未在本次验证中重启；隔离实例覆盖的是同一份代码路径（仓库工作区软链）
- 隔离实例的 dshmarket 因与宿主 0.2.1-rc.3 版本不兼容被宿主跳过，与本插件无关
- 隔离环境用后已删除（端口 3157/3160 释放、无残留进程/原生对话框）
