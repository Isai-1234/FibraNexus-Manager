import type { ReactNode } from 'react'
import { cleanDeviceHost, deviceWebUrl } from '../lib/deviceWeb'

type Props = {
  ip?: string | null
  className?: string
  title?: string
  children?: ReactNode
  onClick?: (e: React.MouseEvent) => void
}

/** Enlace externo a la interfaz web del equipo (antena, CPE, etc.) en la red */
export default function DeviceIpLink({ ip, className = '', title, children, onClick }: Props) {
  const host = cleanDeviceHost(ip)
  const url = deviceWebUrl(ip)
  if (!host) return null

  return (
    <a
      href={url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title || `Abrir ${host} en el navegador`}
      onClick={(e) => {
        if (!url) e.preventDefault()
        onClick?.(e)
        e.stopPropagation()
      }}
    >
      {children ?? host}
    </a>
  )
}
