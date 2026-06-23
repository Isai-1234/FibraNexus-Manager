/** IP, hostname o URL de la interfaz web del equipo */
export function cleanDeviceHost(ip?: string | null): string | null {
  if (!ip?.trim()) return null
  const raw = ip.trim()
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      return u.href.replace(/\/$/, '')
    } catch {
      return raw
    }
  }
  const host = raw.split('/')[0].trim()
  return host || null
}

/** URL HTTP(S) para abrir la interfaz web del equipo en la red local */
export function deviceWebUrl(ip?: string | null): string | null {
  const host = cleanDeviceHost(ip)
  if (!host) return null
  if (/^https?:\/\//i.test(host)) return host
  return `http://${host}`
}

export function openDeviceWeb(ip?: string | null) {
  const url = deviceWebUrl(ip)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
