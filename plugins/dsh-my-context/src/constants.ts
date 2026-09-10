/**
 * dsh-my-context — shared constants.
 *
 * 上下文透镜 + 成本治理的常量：
 *  - 存储上限（请求记录 / 告警 FIFO 淘汰）
 */

/** 每会话请求记录上限（FIFO 淘汰，防无限膨胀）。 */
export const MAX_REQUESTS_PER_SESSION = 500

/** 每会话预算告警上限（FIFO 淘汰）。 */
export const MAX_ALERTS_PER_SESSION = 50

/** 每会话上下文溢出预警上限（FIFO 淘汰）。 */
export const MAX_OVERFLOWS_PER_SESSION = 50
