/** Parsea rates MikroTik (10M, 10000000, etc.) a Mbps */
export function parseMikrotikRatePart(part: string): number | null {
  const s = String(part || '').trim()
  if (!s) return null

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    if (n >= 1_000_000) return n / 1_000_000
    if (n >= 1_000) return n / 1_000
    return n
  }

  const match = s.match(/^([\d.]+)\s*([kmgt])?/i)
  if (!match) return null
  const num = parseFloat(match[1])
  if (Number.isNaN(num)) return null
  const unit = (match[2] || 'm').toLowerCase()
  if (unit === 'g') return num * 1000
  if (unit === 'm') return num
  if (unit === 'k') return num / 1000
  return num
}

/** MikroTik max-limit = subida/bajada (upload/download) */
export function parseMikrotikMaxLimit(maxLimit: string | undefined) {
  if (!maxLimit) return { uploadMbps: null as number | null, downloadMbps: null as number | null }
  const [up, down] = maxLimit.split('/')
  return {
    uploadMbps: parseMikrotikRatePart(up),
    downloadMbps: parseMikrotikRatePart(down),
  }
}

export function formatMbps(mbps: number | null | undefined): string {
  if (mbps == null || Number.isNaN(mbps)) return '—'
  const n = mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10
  return `${n} Mbps`
}

export function formatQueueSpeedLabel(maxLimit: string | undefined): string {
  const { uploadMbps, downloadMbps } = parseMikrotikMaxLimit(maxLimit)
  const parts: string[] = []
  if (downloadMbps != null) parts.push(`${formatMbps(downloadMbps)} bajada`)
  if (uploadMbps != null) parts.push(`${formatMbps(uploadMbps)} subida`)
  return parts.length ? parts.join(' · ') : '—'
}
