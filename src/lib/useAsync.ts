import { useCallback, useEffect, useRef, useState } from 'react'
import { errMsg } from './format'

// Tiny data-loading hook: { data, error, loading, reload }
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const reload = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    fnRef.current()
      .then(d => { if (id === seq.current) { setData(d); setError(null) } })
      .catch(e => { if (id === seq.current) setError(errMsg(e)) })
      .finally(() => { if (id === seq.current) setLoading(false) })
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, deps)
  return { data, error, loading, reload }
}
