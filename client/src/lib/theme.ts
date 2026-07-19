export type ThemeMode = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'fibranexus-theme'

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* ignore */ }
  return 'dark'
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'light') {
    root.classList.add('light')
    root.classList.remove('dark')
  } else {
    root.classList.remove('light')
    root.classList.add('dark')
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch { /* ignore */ }
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === 'light' ? 'dark' : 'light'
  applyTheme(next)
  return next
}
