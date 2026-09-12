/**
 * dsh-shared — 资源看门狗共享类型（issue #198 第三批）。
 *
 * 单独成文件避免 resource-rules（纯函数）与 resource-guard（状态机）互相 import
 * 形成环，也便于消费方只取类型。
 */

/** 一次采样（缺项表示该维度未采集；宿主可加自定义维度）。 */
export interface ResourceSample {
  time?: number
  cpuPercent?: number
  memoryBytes?: number
  fileBytes?: number
  writeRateBytesPerHour?: number
  [dimension: string]: number | undefined
}
