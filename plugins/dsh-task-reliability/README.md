# dsh-task-reliability

**dsh-task-reliability**：DSH 任务可靠性保障——模型超时/请求失败自动重试、任务未完成自动继续、思考重复检测干预、休眠/重启与锁屏后任务恢复、ask 超时自动继续、输出截断自动补完、独立完成度校验 agent、自主决策模式（出行防中断）与远程触发接口。

![任务可靠性面板](https://unpkg.com/dsh-task-reliability/assets/screenshot-panel.png)

## 功能

- **任务注册表**：手动注册或自动跟踪任务，持久化到 `$DSH_HOME/task-reliability.json`（原子写 + 防抖）。
- **超时/失败自动重试**：接管 `agent/request-error` 的瞬态失败（TIMEOUT / ETIMEDOUT / ECONNRESET / TRANSPORT），指数退避 + 次数上限。
- **任务自动继续**：回合即将结束时若存在活动任务则注入继续指令，带防死循环护栏（循环上限/冷却/全局速率限制）。
- **输出截断自动补完**：普通对话回合因输出上限或异常中断且输出不完整时自动注入继续指令（受每会话上限 + 冷却约束；用户主动停止不自动继续）。
- **完成度校验 agent**：开启校验模式后，会话结束时用独立 agent 判断任务是否真正完成，未完成自动唤醒继续（带校验结论）。
- **思考重复干预**：检测 reasoning 段落重复（n-gram 相似度），终止循环回合并注入分级打断指令。
- **休眠/重启/锁屏恢复**：启动时扫描活动任务经 `agents.resume` 恢复会话并注入继续指令；停滞看门狗定期扫描长时间无进展的任务（锁屏/休眠/断网）自动唤醒，无需重启 DSH。
- **ask 超时自动继续**：`ask_user_question` 长时间无响应（默认 30 分钟）自动降级——记录待确认问题 + 注入继续指令 + 模拟回答，任务不挂起。
- **自主决策模式**：出行模式拦截 `ask_user_question` 自动决策，问题收集到待确认列表供回来批量回答，审批策略切换为自动批准。
- **远程触发接口**：`POST /task-reliability/api/trigger` 支持注册任务 / 切换模式 / 回答待确认问题 / 查询状态。
- **/task 斜杠命令**：`/task` 查看状态、`/task continue` 继续活动任务、`/task answer <id> <text>` 回答待确认问题、`/task autopilot on|off` 切换自主决策、`/task register <描述>` 注册任务。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-task-reliability --trust-lockfile`——无需克隆本仓库；依赖 `dsh-shared` 随 npm 自动安装。link 方式供本仓库开发者使用。

```bash
dsh plugin --profile web add link:<本目录绝对路径>
```

## 使用

- 入口：右侧栏「➕ 新标签页」（guide）菜单 → **任务可靠性**。本插件**不会自动打开**页签（`dsh-file-activity` 是「会话首次自动打开」，两者行为不同）。
- 面板：注册任务、切换「完成度校验」/「自主决策」开关、查看活动任务与待确认问题。
- 页签不出现时先查禁用位，见下「看不到「任务可靠性」页签？」。

远程触发示例：

```bash
curl -X POST http://127.0.0.1:3080/task-reliability/api/trigger \
  -H "Content-Type: application/json" \
  -d '{"action":"mode","autopilot":true}'
```

## 看不到「任务可靠性」页签？

页签不出现有两种原因，按顺序自查：

1. **插件被禁用**（最常见）。被禁用的插件「被加载但不运行」——client bundle 不进 manifest、页签不出现、**且没有任何报错**。查两处禁用来源：

```bash
grep -A1 'id: task-reliability' ~/.dsh/profiles/<profile>/cordis.patch.yml
cat ~/.dsh/profiles/<profile>/.dsh-market/state.json
```

出现 `disabled: true`（或出现在 disabled 列表里）→ 在「设置 → 插件」里把它打开。

2. **插件已启用，但页签不会自动打开**：右栏顶部「➕ 新标签页」→ 任务可靠性。

另外，会话里输入 `/task` 可确认插件是否加载：没有这个命令 = 插件没加载（安装未生效 / 被禁用 / 宿主过旧）。

## 配置

全部配置项也可在 **设置 → 插件 → 任务可靠性** 页签可视化编辑，点「保存」即写入 profile 的 `cordis.patch.yml` 并热重载生效。

- `apiToken`：远程接口令牌；配置后 trigger / mode / answer 需带 `x-task-reliability-token` 头。
- `retryMax`（3）/ `retryBaseMs`（1000）/ `retryableCodes`：重试次数上限、指数退避基数、触发重试的错误码集合。
- `maxLoop`（8）/ `steerCooldownMs`（8000）/ `rateMaxActions`（12）：每任务自动继续上限、两次继续最小间隔、每分钟动作数全局上限。
- `maxVerify`（3）：每任务完成度校验次数上限。
- `rescueOnTruncation`（true）/ `rescueMaxPerSession`（2）/ `rescueCooldownMs`（30000）：截断自动补完开关、每会话上限、间隔。
- `askTimeoutMs`（1800000，0=禁用）：ask 超时后记录待确认问题 + 注入继续指令 + 模拟回答。
- `watchdogIntervalMs`（300000）/ `stallTimeoutMs`（600000）：停滞看门狗检查间隔、停滞判定阈值（0=禁用）。
- `autopilot`（false）/ `autopilotGraceMs`（20000）：自主决策默认开关与缓冲（0 = 立即拦截）。
- `saveDebounceMs`（500）/ `resumeGraceMs`（2000）：状态落盘防抖窗口、启动后延迟恢复时间。

## 安全

所有 `/task-reliability/api/*` 路由先过 loopback 信任围栏，非本机来源一律 403；配置 `apiToken` 后远程动作（trigger / mode / answer）额外要求 token 头。

## 相关文档

→ [任务可靠性模块文档](../../docs/任务可靠性/概述.md)
