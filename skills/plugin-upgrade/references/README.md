# references/ · 按需加载的参考材料

`SKILL.md` 只保留决策流程与纪律，细节材料放在这里按需读取。

- [pre-flight.md](pre-flight.md)：七类触点自查、版本走廊构建、ghost host 钉定与迁移任务摘要模板；
- [pre-flight-patterns.json](pre-flight-patterns.json)：触点扫描正则的唯一定义源，供可执行检查读取；
- [migration-hygiene.md](migration-hygiene.md)：与版本无关的工具链坑（增量误报、解析器严格度、改动生效面、依赖构建脚本拦截、测试语法）；
- [troubleshooting.md](troubleshooting.md)：迁移后症状 → 最可能根因速查。

## 将来新增版本迁移卡时的最小约定

1. 按 `from → to` 有向边连接走廊，不按文件名字典序（字典序里 `alpha.10` 排在 `alpha.2` 之前）；一条走廊跨多个版本时先读全，把「中间版本删除、目标版又恢复」合并成净状态再动手；
2. 每张卡至少引用一个一手来源，并钉到固定 tag 或 commit；release notes 只给方向、没有 API 坐标时，做法里必须要求回目标 tag 的类型定义复核，不许编造接口；
3. 字段至少包含：类型、适用面、触点编号、动作级别、症状、迁移做法、验证方式、来源；
4. 本地观察与一手来源冲突时并列记录、先复现，不静默选一方；
5. 缺走廊边时报告 unsupported gap，不假装有覆盖。
