import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

type Kind = 'ok' | 'err'
interface T { id: number; kind: Kind; text: string }
const Ctx = createContext<(kind: Kind, text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random()
    setItems(x => [...x, { id, kind, text }])
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), 4500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} /> : <XCircle size={18} />} <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => {
  const push = useContext(Ctx)
  return useMemo(() => ({ ok: (t: string) => push('ok', t), err: (t: string) => push('err', t) }), [push])
}
