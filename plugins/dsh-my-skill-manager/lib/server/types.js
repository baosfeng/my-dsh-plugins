/**
 * dsh-my-skill-manager — 宿主运行时类型契约（server 端最小集合）。
 *
 * 插件只依赖宿主的少量 API：skills / webServer / sessions / logger /
 * on / effect。DSH 的 cordis、webServer、skills 服务由宿主提供，这里手写
 * 最小结构契约，避免把宿主类型包作为依赖安装。
 *
 * 与宿主实现的对应关系（DSH 0.2.x）：
 *  - `ctx.skills.list({ cwd })` → SkillSummary[]（含 path / invocation /
 *    source / provider）；`ctx.skills.get(name, { cwd })` → SkillDefinition。
 *  - `ctx.skills.registerProvider(create)` → 返回 unregister disposer；控制面
 *    `control.invalidate()` 让目录缓存立即失效。
 *  - `tools/pre-execute` 事件：(execution, next) → next() 的链式拦截器。
 *  - 信任源：webStartup.trustedHosts + webServer.host（dsh-shared 封装）。
 */
export {};
