import type { MouseEvent, ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { cleanDeviceHost, deviceWebUrl, openDeviceWeb } from '../lib/deviceWeb'

type Props = {
  ip?: string | null
  className?: string
  title?: string
  children?: ReactNode
  showIcon?: boolean
}

/** Abre la interfaz web del CPE/antena en una pestaña nueva (no navega dentro de FibraNexus) */
export default function DeviceIpLink({ ip, className = '', title, children, showIcon = false }: Props) {
  const host = cleanDeviceHost(ip)
  const url = deviceWebUrl(ip)
  if (!host) return null

  const label = children ?? host

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    e.stopPropagation()
    openDeviceWeb(ip)
  }

  return (
    <a
      href={url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-0.5 ${className}`}
      title={title || `Abrir ${host} en el navegador (interfaz de la antena)`}
      onClick={handleClick}
    >
      {label}
      {showIcon && <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />}
    </a>
  )
}
