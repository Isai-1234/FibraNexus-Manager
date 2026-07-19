import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { applyTheme, getStoredTheme, toggleTheme, type ThemeMode } from '../lib/theme'

type Props = {
  className?: string
}

/** Toggle claro/oscuro — preferencia en localStorage `fibranexus-theme` */
export default function ThemeToggle({ className = '' }: Props) {
  const [mode, setMode] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' ? getStoredTheme() : 'dark',
  )

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  function onToggle() {
    setMode(toggleTheme())
  }

  const isLight = mode === 'light'

  return (
    <button
      type="button"
      onClick={onToggle}
      title={isLight ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}
      aria-label={isLight ? 'Tema oscuro' : 'Tema claro'}
      className={`inline-flex items-center justify-center p-2 rounded-lg border border-line bg-surface-card text-ink-muted hover:text-ink hover:bg-surface-raised transition ${className}`}
    >
      {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  )
}
