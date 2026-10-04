import { useCallback, useState } from 'react'

export interface Coords { lat: number; lng: number }
const KEY = 'medos-coords'

function load(): Coords | null {
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) as Coords : null } catch { return null }
}

export function useLocation() {
  const [coords, setCoords] = useState<Coords | null>(load)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locate = useCallback(() => {
    if (!navigator.geolocation) { setError('Location is not supported by this browser'); return }
    setBusy(true); setError('')
    navigator.geolocation.getCurrentPosition(
      p => {
        const c = { lat: p.coords.latitude, lng: p.coords.longitude }
        setCoords(c); setBusy(false)
        try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* ignore */ }
      },
      e => { setError(e.code === 1 ? 'Location permission denied' : 'Could not get your location'); setBusy(false) },
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }, [])
  const clear = useCallback(() => { setCoords(null); try { localStorage.removeItem(KEY) } catch { /* ignore */ } }, [])
  return { coords, error, busy, locate, clear }
}

export const fmtKm = (d: number | null | undefined) =>
  d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`
