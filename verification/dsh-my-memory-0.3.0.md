# 发版前人工自测清单 — dsh-my-memory@0.3.0

- 验证环境：用户本人运行中的 DSH 实例（Web GUI `http://127.0.0.1:58191`，宿主 0.2.1-rc.5）；插件处于启用态（`GET /my-memory/api/agent-memory` 返回 200）
- 版本区间：0.2.0 → 0.3.0（minor：新增面板分组/晋升建议、目录重排与上限上调、写入去重、项目可读名、目录跨进程自愈）
- 确认依据：**用户本人在对话中确认「已经没问题了，开始发版」**（2026-11-01）。浏览器走查由用户本人完成；agent 未代跑浏览器，只做了下列只读/单测取证。

## 功能级验证项（逐条勾选）

- [x] **Agent 记忆 tab 按项目分组折叠**：全局恒在最前，项目按最后写入时间倒序，最近项目默认展开，其余折叠成「项目名 · N 条」
      - agent 侧佐证：`GET /my-memory/api/agent-memory` 返回 `{ groups, archived, suggestions }`，实测 4 组（global + 3 个项目），旧的 `items` 平铺结构已不存在
- [x] **项目可读名**：卡片标题显示 `项目名 / 文件名`（如 `android-monitor / decisions.md`），悬停仍是全路径；目录前缀为 `my-dsh-plugins/坑` 这类短标签
      - agent 侧佐证：`index.json.projects` = `{"c1a9a5e21a94":"android-monitor","8bad3c8c5a2e":"norvels"}`；目录渲染前缀实测为 `ba7b32/坑` 等
- [x] **跨项目晋升建议条**：同一事实出现在 ≥2 个项目时顶部出现建议条；含项目专属标识的条目按钮置灰并给原因
      - agent 侧佐证：当前库无跨项目聚簇（`suggestions: []`），晋升路径由 `test/agent-memory-promote.mjs` 16 条用例覆盖（含回滚）
- [x] **目录常驻且全量可见**：系统提示词里一行一条列出全部条目，前缀为短标签
      - agent 侧佐证：真实库 8 文件 91 条 → 目录 **91 行 / 7176 字节**，无「另有 N 条未展开」
- [x] **目录跨进程自愈**：命令行脚本 / 第二个实例写进来的条目，本进程 ≤1s 内出现在目录里
      - agent 侧佐证：`catalog.ts` 的节流 mtime 指纹校验（`DEFAULT_REVALIDATE_MS = 1000`）；`test/agent-memory-catalog.mjs` 注入时钟与指纹覆盖「无变化返回同一字符串」「变化即重建」
- [x] **写入去重**：与其它文件已有条目相似度 ≥ 0.5 时拒写并指出重复位置；同一条写入内部重复同样拒写；短句（<12 字）只认完全相同
      - agent 侧佐证：`test/agent-memory-duplicates.mjs` 6 条用例；真实会话中 `agent_memory_write` 正常写入未被误拦
- [x] **既有能力回归**：作用域徽标、删除二次确认、归档区展开与一键恢复、行内编辑（按钮已用设计系统 `dsh-my-memory-iconbtn`）
      - agent 侧佐证：`test/client-style-contract.mjs`（类名全部有定义）、`test/agent-memory-recovery.mjs`、`test/agent-memory-panel.mjs`
- [x] **真实模型路径**：`agent_memory_{list,read,write,delete}` 在真实会话里可用（本次会话即由真实模型调用该套工具读写记忆）
- [x] **插件测试**：`npm test` 全绿（vitest 292 用例 + cucumber 27 scenarios / 170 steps）

## 未验证项与环境限制

- **隔离实例（独立 DSH_HOME）未起**：本次沿用用户当前运行实例取证，未另起 `/tmp/dsh-verify-*`；因此「重启实例后回读一致」「刷新浏览器后 client bundle 重载」两项按用户本人日常使用确认，agent 未独立复测。
- **跨项目晋升的端到端点击未复测**：当前真实库没有可晋升聚簇，无法在浏览器里点到「晋升到 user.md」；该路径只有单测覆盖。
- **真实网关 / 网络路径**：本插件不发起出站请求，无此类验证项。
- 目录上限由 70 行 / 6 KB 上调为 100 行 / 8 KB（发布前实测 91 条全量可见，7176 字节 ≈ 1.8k token 名义）；真写满 100 行时仍按「全局优先 + 项目轮转」丢弃并给「另有 N 条」尾注。
