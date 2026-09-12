/**
 * dsh-my-observability — 资源阈值判定（**dsh-shared 原语的消费方**，issue #198 第三批）。
 *
 * 第三批把阈值判定与看门狗状态机抽到 `dsh-shared` 的 `resource-rules` /
 * `resource-guard`，本文件只做**别名 re-export**：
 *  - 保留插件内既有的导入路径与名称（`DEFAULT_LIMITS` 等），路由/测试/配置契约不变；
 *  - 判定口径（50MB/h 写入速率、50MB 文件、10% CPU、500MB RSS；相等不算超限；
 *    连续 3 次确认）由 shared 单点维护，插件不再各存一份。
 *
 * 原语边界与反例见 plugins/dsh-shared/README.md 与 docs/共享工具包/概述.md。
 */
export { DEFAULT_RESOURCE_LIMITS as DEFAULT_LIMITS, evaluateResourceAlerts, shouldEnterDegrade, shouldExitDegrade, } from 'dsh-shared';
