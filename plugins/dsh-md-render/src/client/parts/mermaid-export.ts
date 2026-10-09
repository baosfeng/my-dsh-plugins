// ── mermaid 图表导出：PNG / SVG 下载 + 复制源码 ────────────────────────
// 失败一律经卡片提示条转可见提示，绝不静默（与合并前的 dsh-mermaid-render 同款行为）。
// 复制实现复用 copy.ts 的 copyText（同一 factory 作用域），不重复一份。

/** 导出处理器。 */
interface ExportHandlers {
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}

/** 默认文件名：mermaid-<序号>.<ext>（序号取自 entryId，如 dsh-md-render-mermaid-3 → 3）。 */
function buildExportFileName(entryId: string, ext: string): string {
  const m = /(\d+)/.exec(String(entryId || ''))
  return 'mermaid-' + (m ? m[1] : '1') + '.' + ext
}

/** 序列化 SVG DOM 为字符串；缺 xmlns 时补上（Image 加载 SVG 必需）。 */
function serializeSvg(svgEl: SVGElement): string {
  const xml = new XMLSerializer().serializeToString(svgEl)
  return xml.includes('xmlns') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
}

/** 触发浏览器下载：Blob → 临时 a[download] → click → 延迟 revoke URL。 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 下载 SVG：序列化 → Blob(image/svg+xml) → 下载。 */
function downloadSvgFile(svgEl: SVGElement, fileName: string): void {
  const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' })
  downloadBlob(blob, fileName)
}

/** canvas → PNG blob → 下载（load 回调内，失败 reject）。 */
function encodePng(
  img: HTMLImageElement,
  url: string,
  fileName: string,
  resolve: () => void,
  reject: (e: Error) => void,
): void {
  try {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d 上下文不可用')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((pngBlob) => {
      URL.revokeObjectURL(url)
      if (!pngBlob) {
        reject(new Error('PNG 编码失败'))
        return
      }
      downloadBlob(pngBlob, fileName)
      resolve()
    }, 'image/png')
  } catch (err) {
    URL.revokeObjectURL(url)
    reject(err instanceof Error ? err : new Error(String(err)))
  }
}

/** 下载 PNG：SVG → Image → canvas(2x) → toBlob → 下载；失败 reject。 */
function downloadPngFile(svgEl: SVGElement, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let url = ''
    try {
      const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' })
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => encodePng(img, url, fileName, resolve, reject)
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('SVG 图片加载失败'))
      }
      img.src = url
    } catch (err) {
      URL.revokeObjectURL(url)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** 从卡片 DOM 取渲染出的 SVG 元素（按 entryId 定位，避免多卡片串扰）。 */
function findCardSvg(entryId: string): SVGElement | null {
  if (typeof document === 'undefined' || document === null) return null
  const host = document.querySelector('[data-dsh-md-render-mermaid="' + entryId + '"]')
  if (!host || !host.querySelector) return null
  return host.querySelector('svg')
}

/** 组装卡片导出 handler：返回 { onPng, onSvg, onCopy }。 */
function makeExportHandlers(
  entryId: string,
  source: string,
  flashNotice: (type: string, text: string) => void,
): ExportHandlers {
  return {
    onPng: () => {
      const svgEl = findCardSvg(entryId)
      if (!svgEl) {
        flashNotice('error', '图表尚未渲染完成，无法导出 PNG')
        return
      }
      downloadPngFile(svgEl, buildExportFileName(entryId, 'png'))
        .then(() => flashNotice('ok', 'PNG 已下载'))
        .catch((err) => flashNotice('error', 'PNG 导出失败：' + errMsg(err)))
    },
    onSvg: () => {
      const svgEl = findCardSvg(entryId)
      if (!svgEl) {
        flashNotice('error', '图表尚未渲染完成，无法导出 SVG')
        return
      }
      try {
        downloadSvgFile(svgEl, buildExportFileName(entryId, 'svg'))
        flashNotice('ok', 'SVG 已下载')
      } catch (err) {
        flashNotice('error', 'SVG 导出失败：' + errMsg(err))
      }
    },
    onCopy: () => {
      copyText(source)
        .then(() => flashNotice('ok', '源码已复制'))
        .catch((err) => flashNotice('error', '复制失败：' + errMsg(err)))
    },
  }
}

exports.buildExportFileName = buildExportFileName
exports.serializeSvg = serializeSvg
exports.findCardSvg = findCardSvg
exports.makeExportHandlers = makeExportHandlers
