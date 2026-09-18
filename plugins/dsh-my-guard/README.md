# dsh-my-guard

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="安全护栏面板：告警列表（提示注入命中 + 确认按钮）+ 投毒扫描结果（可疑脚本/私钥）" src="https://unpkg.com/dsh-my-guard/assets/guard-panel.png" width="640" />
  <br/>
  <img alt="自定义护栏规则 + 告警通知：规则编辑（正则/模式/严重级）+ 规则测试 + dsh-my-notify 通知开关" src="https://unpkg.com/dsh-my-guard/assets/guard-rules-panel.png" width="640" />
  <br/>
  <img alt="设置页配置面板（设置 → 插件 → 安全护栏）：护栏模式 + 投毒扫描 / 提示注入检测开关" src="https://unpkg.com/dsh-my-guard/assets/guard-settings-panel.png" width="640" />
</div>

**DSH 安全护栏插件**：**执行前护栏**在破坏性命令（`rm -rf /` 等）执行前观察 / 确认 / 拦截；**安装前投毒扫描**在 `dsh plugin add` 时扫描包内容（可疑脚本 / 密钥 / 恶意依赖）并告警；**提示注入检测**用规则 + 启发式识别 prompt injection / jailbreak 尝试。

## 功能

- **执行前护栏**：在 `tools/pre-execute` 上匹配破坏性模式——删除根 / 家目录、格式化磁盘、直接写块设备、fork 炸弹、根目录全权限、关机 / 重启、`curl … | sh` 下载执行——命中记录 high 告警。
- **三种模式**：`observe`（默认，只告警不改变工具与审批流程）/ `ask`（触发 DSH 原生审批，用户确认后才执行）/ `deny`（直接拦截，工具返回错误）。
- **投毒扫描**：识别到 `dsh plugin add <pkg>` 后异步扫描包内容（`link:` / 本地路径直接扫目录，包名经 npm registry 下载 tarball 扫描，**绝不执行包内代码**），检测可疑 install / postinstall 脚本、私钥与各类 Token、已知恶意包名、二进制与脚本文件；也可在面板或 `POST /guard/api/scan` 手动扫描。
- **提示注入检测**：监听 `session/event` 的 `user/message`（过滤 `source.kind === 'plugin'` 的插件注入消息，避免误报），命中忽略指令 / 覆盖系统提示词 / jailbreak / 角色提权 / 密钥外泄 / 编码混淆 / 关闭安全机制等规则即记 injection 告警（high / medium）。
- **可视化配置**：设置 → 插件 →「安全护栏」页签编辑模式 / 检测开关 / 通知（保存即写回 profile patch 并热生效）；自定义正则规则在侧边栏「安全护栏」面板编辑。
- **自定义护栏规则**：可添加自定义 bash 危险模式（正则 + 模式 + 严重级 + 描述），与内置规则合并生效，命中取最严格模式（deny > ask > observe）与最严重级；自定义规则**只升不降**，内置 deny 不会被降级；面板「规则测试」可实时预览合并决策。
- **告警记录 + 确认**：三类告警统一持久化 `$DSH_HOME/guard/alerts.json`（防抖 + 原子写，重启恢复），上限 500 条 FIFO 淘汰；侧边栏「安全护栏」页签查看告警并逐条「确认」。
- **高严重级通知**（可选）：经 dsh-my-notify 的 `POST /notify/api/trigger` 推送，同类告警冷却防刷屏，异步 fire-and-forget、失败静默。

## 配置

`cordis.patch.yml` 对应插件行的 `config` 字段，均为可选：

```yaml
- insert:
    - id: guard
      name: 'dsh-my-guard'
    - config:
        mode: 'observe' # observe 只告警 / ask 审批确认 / deny 直接拦截
        poisonScan: true # 投毒扫描自动联动
        injection: true # 提示注入检测
        notifyEnabled: false # 高严重级告警经 dsh-my-notify 推送
        notifyCooldownMs: 60000 # 同类型告警通知冷却（ms）
        # customRules: '[{"pattern":"touch /etc/evil","mode":"deny","severity":"high"}]'
        #   ↑ 自定义护栏规则（JSON 字符串；在侧边栏「安全护栏」面板编辑保存）
```

**可视化编辑（两个入口，都写回 profile patch 并热生效）**：

- **设置 → 插件 →「安全护栏」页签**：`mode`（三选一）、`poisonScan`、`injection`、`notifyEnabled`、`notifyCooldownMs`（界面按秒编辑，写回毫秒）；自定义规则只显示条数并指引到侧边栏面板。
- **侧边栏「安全护栏」面板**：`customRules`（正则 + 模式 + 严重级）与通知开关 / 冷却，并提供规则测试。

两个入口走同一份配置写回通道（写 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 的 `guard` 行，DSH 的 watchUserPatches 热重载），并立即更新内存——当前实例无需重启即生效。非法值（未知 mode、非布尔开关、负冷却、非法正则）一律回退默认或丢弃，不会写坏配置。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-guard --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-guard
```

- server 端改动需重启 `dsh web`；client 端改动浏览器硬刷新即可。

## 限制与说明

- **observe 模式不拦截**：默认只记录告警、工具照常执行；需要真正拦截 / 确认请配 `mode: 'ask'` 或 `mode: 'deny'`。
- **投毒扫描只读**：绝不执行包内脚本 / 代码；tarball 解压到临时目录扫描，扫完清理。
- **检测范围有限**：注入检测只覆盖消息文本，护栏只匹配 bash 命令行模式；告警上限 500 条，超出淘汰最旧。

## 相关文档

→ [安全护栏模块文档](../../docs/安全护栏/概述.md) · [CHANGELOG](CHANGELOG.md)
