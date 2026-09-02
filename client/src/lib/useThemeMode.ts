import { useEffect, useState } from 'react'
import { getStoredTheme, THEME_STORAGE_KEY, type ThemeMode } from './theme'

function readThemeFromDom(): ThemeMode {
  if (typeof document === 'undefined') return getStoredTheme()
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

/** Sincroniza con `document.documentElement.classList` (toggle de tema). */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeFromDom())

  useEffect(() => {
    const sync = () => setMode(readThemeFromDom())
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) sync()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return mode
}
