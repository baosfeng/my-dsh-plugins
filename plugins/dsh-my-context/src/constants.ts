/**
 * dsh-my-context — shared constants.
 *
 * 上下文透镜 + 成本治理的常量：
 *  - 内存上限（会话数 / 请求记录 / 告警 FIFO 淘汰）；
 *  - 落盘护栏（防抖 + 最小间隔 + 单次快照字节上限，issue #198 接入 dsh-shared）。
 *
 * 资源影响（resource-budget-review 五维，issue #198）：
 *  - 内存上界 = MAX_SESSIONS × 单会话上界（requests 500 / alerts 50 / overflows 50）
 *    ≈ 20 × 132KB（实测满载）≈ 2.6 MB；
 *  - 磁盘写 = 单次快照字节（≤ PERSIST_MAX_BYTES）÷ 最小写间隔（1s）→ 峰值 ≤ 8MB/s
 *    的硬上限，常态为「每轮对话一次」（防抖 500ms + 最小间隔 1s）；
 *  - 磁盘存量 = 单文件 ≤ PERSIST_MAX_BYTES（8MB，实测满载 2.58MB）。
 */

/** 每会话请求记录上限（FIFO 淘汰，防无限膨胀）。 */
export const MAX_REQUESTS_PER_SESSION = 500

/** 每会话预算告警上限（FIFO 淘汰）。 */
export const MAX_ALERTS_PER_SESSION = 50

/** 每会话上下文溢出预警上限（FIFO 淘汰）。 */
export const MAX_OVERFLOWS_PER_SESSION = 50

/** bySession 会话数上限（LRU 淘汰最久未使用；issue #198 审计缺口修正）。 */
export const MAX_SESSIONS = 20

/** 落盘防抖窗口（ms）：窗口内多次变更合并为一次写。 */
export const PERSIST_DEBOUNCE_MS = 500

/** 落盘最小间隔（ms）：与 dsh-shared atomicWriteJson 默认节流窗口一致，护栏不误伤。 */
export const PERSIST_MIN_INTERVAL_MS = 1000

/**
 * 单次快照字节上限（显式放宽 dsh-shared 默认 1MB）：
 * 状态自身有界（MAX_SESSIONS × 每会话上限），实测满载 2.58MB（20 会话 × 132KB），
 * 8MB 提供 ~3× 余量（header.system/tools 是唯一不受条目上限约束的部分）。
 */
export const PERSIST_MAX_BYTES = 8 * 1024 * 1024
