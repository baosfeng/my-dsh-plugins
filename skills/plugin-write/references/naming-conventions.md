# 外部插件命名：本地声明、校验与改名纪律

> 官方命名语法（包/插件模块名/Loader 行/服务/工具/命令/Skill/事件/设置命名空间/Web 路由各自的合法形态）**不在本仓库维护**——按精确目标版本查官方参考源与图谱。
> 本文件只记本仓库的**本地声明契约、校验入口与不可自动改名**这三件事。

## 命名纪律

- **绝不为了清掉一条建议而改已发布的名字。** 工具、命令、服务、Skill、设置命名空间、事件、路由的改名都是**兼容性破坏**：报告偏差但保留已发布名，只有用户明确授权才改。
- 短名（如 `greet`、`metrics`、`my-plugin`）在官方语法下**合法**——社区前缀只是**建议**，不构成拒绝理由。
- 本仓库包名契约另有规定（`dsh-<功能>`、目录名 = 包名、页签 `id` 用包名、`kind` 用 `包名:xxx`），见 `dsh-plugin-development` skill 的「目录结构规范」。

## 本地声明：`dsh-plugin.naming.json`

放在外部插件仓库根：

```json
{
  "schemaVersion": 1,
  "policy": "dsh-plugin-naming/v1",
  "plugin": {
    "namespace": "alice",
    "name": "web-search",
    "coordinate": "alice/web-search",
    "packageName": "@alice/dsh-web-search"
  },
  "names": {
    "pluginNames": ["web-search"],
    "loaderIds": ["alice-web-search"],
    "services": ["aliceWebSearchIndex"],
    "tools": ["alice_web_search_query"],
    "commands": ["alice-web-search-refresh"],
    "skills": ["alice-web-search"],
    "skillProviders": ["alice-web-search-filesystem"],
    "events": ["alice-web-search/ready"],
    "settingsNamespaces": ["alice-web-search"],
    "routes": [{ "kind": "exact", "path": "/api/plugins/alice-web-search/query" }]
  }
}
```

- 每个数组都要保留（含空数组），且至少声明一个 plugin module name 与一个 Loader row ID；
- 可选 `$schema` 可指向本目录 `plugin-naming.schema.json` 的本地副本；
- 声明只**补充** `package.json`、bundle patch 与 profile composition——既不证明源码真的这么用，也**不预留任何名字**。

## 校验器（唯一入口）

```sh
node skills/plugin-write/scripts/validate-names.mjs \
  --manifest ./dsh-plugin.naming.json
```

- 策略文件唯一来源：`references/naming-policy.v1.json`（校验器默认读取，勿另存副本）；
- `--strict`：把前缀类**建议**升级为非零退出，仅在插件采用防撞名 profile 时用；
- `--format json` 供 CI 使用；**退出码** 0 = 兼容，1 = 存在错误或 strict 警告，2 = 参数非法 / 读不到输入 / JSON 畸形；
- 校验器**不发网络请求、不写文件**。

## 与中央注册表的边界

离线校验通过后才谈在线查询与登记（见 [registry-check.md](registry-check.md)）。四种状态必须分开：**没匹配** ≠ **没查上** ≠ **自动发现候选** ≠ **已审阅的正式登记**；自动发现候选**从不预留 ID**，只有审阅合并进 `main` 的条目参与冲突检查。
