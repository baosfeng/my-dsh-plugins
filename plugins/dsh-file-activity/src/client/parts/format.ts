// ── path / time formatting helpers ────────────────────────────────────
function basenameOf(path: string): string {
  const norm = path.split('\\').join('/')
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? norm : norm.slice(idx + 1)
}

/** Compact relative time: 刚刚 / N 分钟前 / N 小时前 / N 天前 / MM/DD. */
function formatRelative(time: unknown): string {
  if (typeof time !== 'number' || !Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 30_000) return strings.justNow()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return strings.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return strings.hoursAgo(hours)
  const days = Math.floor(hours / 24)
  if (days < 7) return strings.daysAgo(days)
  const date = new Date(time)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** Local wall-clock HH:MM:SS (used in tooltips; full precision). */
function formatTime(time: number): string {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
