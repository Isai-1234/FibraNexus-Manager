/** IP o hostname sin máscara CIDR */
export function cleanDeviceHost(ip?: string | null): string | null {
  if (!ip?.trim()) return null
  const clean = ip.trim().split('/')[0].trim()
  return clean || null
}

/** URL HTTP(S) para abrir la interfaz web del equipo en la red */
export function deviceWebUrl(ip?: string | null, https = false): string | null {
  const host = cleanDeviceHost(ip)
  if (!host) return null
  if (/^https?:\/\//i.test(host)) return host
  return `${https ? 'https' : 'http'}://${host}`
}

export function openDeviceWeb(ip?: string | null) {
  const url = deviceWebUrl(ip)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
