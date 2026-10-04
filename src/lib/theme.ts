import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'medos-theme'

function read(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v } catch { /* storage blocked */ }
  return 'system'
}

export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}

export function initTheme() { applyTheme(read()) }

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => { applyTheme(theme) }, [theme])
  const set = useCallback((t: Theme) => {
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t) } catch { /* ignore */ }
    setTheme(t)
  }, [])
  return { theme, set }
}
