// ── 资源监控区块（写放大/资源超限预警，见 lib/resource-monitor.js）──────
// 依赖 replay.js 先拼接（apiJson）与 i18n.js（strings）。纯函数声明文本。

const RESOURCE_POLL_MS = 15000

function fmtResourceBytes(bytes: any): string {
  if (!Number.isFinite(bytes)) return '-'
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** 资源采样状态：可见时每 15s 轮询 /observability/api/resources。 */
function useResourceState(visible: boolean): any {
  const [resource, setResource] = useState(null)
  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    const tick = () => {
      if (alive)
        apiJson('/observability/api/resources')
          .then(setResource)
          .catch(() => {})
    }
    tick()
    const timer = setInterval(tick, RESOURCE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [visible])
  return resource
}

function ResourceMetric({ label, value }: { label: string; value: unknown }): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-resource-metric' },
    createElement('span', { className: 'dsh-my-observability-resource-label' }, label),
    createElement('span', { className: 'dsh-my-observability-resource-value' }, value),
  )
}

/** 资源面板：四指标 + 告警列表（write-rate/file-size level=error 红色，cpu/memory warn 黄色）。 */
function ResourcePanel({ resource }: { resource: any }): unknown {
  if (resource === null || resource === undefined) {
    return createElement('div', { className: 'dsh-my-observability-resource' }, strings.resourceLoading())
  }
  const alerts = Array.isArray(resource.alerts) ? resource.alerts : []
  return createElement(
    'div',
    { className: 'dsh-my-observability-resource' },
    createElement('div', { className: 'dsh-my-observability-resource-head' }, strings.resourceTitle()),
    createElement(
      'div',
      { className: 'dsh-my-observability-resource-grid' },
      createElement(ResourceMetric, { label: strings.resourceFile(), value: fmtResourceBytes(resource.fileBytes) }),
      createElement(ResourceMetric, {
        label: strings.resourceRate(),
        value: `${fmtResourceBytes(resource.writeRateBytesPerHour)}/h`,
      }),
      createElement(ResourceMetric, {
        label: strings.resourceCpu(),
        value: `${Math.round(resource.cpuPercent ?? 0)}%`,
      }),
      createElement(ResourceMetric, { label: strings.resourceMem(), value: fmtResourceBytes(resource.memoryBytes) }),
    ),
    alerts.length > 0
      ? createElement(
          'div',
          { className: 'dsh-my-observability-resource-alerts' },
          alerts.map((alert) =>
            createElement(
              'div',
              { className: `dsh-my-observability-resource-alert dsh-my-observability-resource-alert-${alert.level}` },
              alert.message,
            ),
          ),
        )
      : null,
  )
}
