# 发版前人工自测清单 — dsh-my-context@0.1.9

- 验证环境：隔离实例 DSH_HOME=`/private/tmp/dsh-verify-3157/dsh-home`（独立 HOME=`/private/tmp/dsh-verify-3157/user-home`）/ 端口 3157（有 DSH_HOME）与 3160（无 DSH_HOME）/ Chrome for Testing（agent-browser 驱动，独立浏览器）
- 待验插件处于启用态：是（隔离副本内移除 `disabled: true`，生产配置未改）
- 验证执行者：agent（用户明确授权「你自己新开一个端口进行独立验证」）

## 功能级验证项（逐条勾选）

- [x] 有 DSH_HOME：一条真实模型会话（DeepSeek-V4.1-Flash 回复 PONG，16.2K tok）后，`$DSH_HOME/context/context.json` 生成 1 个会话 / 1 条请求记录
- [x] 无 DSH_HOME（本次修复重点）：同一套插件在 HOME 隔离实例下跑同一轮真实会话，数据落 `$HOME/.dsh/context/context.json`；**`$HOME/context` 不存在**（修复前会写到这里）
- [x] 重启回读：复用同一 DSH_HOME 重启实例后，会话统计仍可读、无重复写
- [x] client UI：页面渲染正常（「上下文洞察」入口可见），浏览器 Console 无未捕获异常
- [x] 插件间联动：与 dsh-my-observability / dsh-my-memory / dsh-my-notify / dsh-file-activity 等生产同款组合共存，无注册冲突、无「entry did not activate」

## 未验证项与环境限制

- 用户日常 desktop profile 主实例未在本次验证中重启；隔离实例覆盖的是同一份代码路径（仓库工作区软链）
- 隔离实例的 dshmarket 因与宿主 0.2.1-rc.3 版本不兼容被宿主跳过，与本插件无关
- 隔离环境用后已删除（端口 3157/3160 释放、无残留进程/原生对话框）
