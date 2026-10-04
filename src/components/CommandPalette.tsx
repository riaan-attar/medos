import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { EXTRA, NAV } from './nav'
import type { Order } from '../lib/types'

interface Item { id: string; label: string; hint?: string; to: string; icon?: React.ElementType }

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const { profile, session } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    if (session && profile && profile.role !== 'admin') api.orders(profile!.id).then(setOrders).catch(() => {})
  }, [session, profile])

  const items = useMemo<Item[]>(() => {
    if (!profile) return []
    const pages: Item[] = [
      ...NAV[profile.role].map(n => ({ id: n.to, label: n.label, hint: 'Page', to: n.to, icon: n.icon })),
      { id: 'settings', label: EXTRA.settings.label, hint: 'Page', to: EXTRA.settings.to, icon: EXTRA.settings.icon },
      { id: 'notif', label: EXTRA.notifications.label, hint: 'Page', to: EXTRA.notifications.to, icon: EXTRA.notifications.icon },
    ]
    const ords: Item[] = orders.map(o => ({
      id: o.id, label: o.order_no, to: `/orders/${o.id}`,
      hint: `${o.status.replace('_', ' ')} · ${(o.buyer_id === profile?.id ? o.seller : o.buyer)?.org_name ?? ''}`,
    }))
    const needle = q.trim().toLowerCase()
    const all = [...pages, ...ords]
    return (needle ? all.filter(i => (i.label + ' ' + (i.hint ?? '')).toLowerCase().includes(needle)) : pages).slice(0, 12)
  }, [profile, orders, q, session])

  function go(i: Item) { nav(i.to); onClose() }

  return (
    <div className="modal-backdrop top" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={ref} value={q} placeholder="Jump to a page or order…"
            onChange={e => { setQ(e.target.value); setSel(0) }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
              else if (e.key === 'Enter' && items[sel]) go(items[sel])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul>
          {items.length === 0 && <li className="muted palette-empty">No results</li>}
          {items.map((i, idx) => {
            const Icon = i.icon
            return (
              <li key={i.id} className={idx === sel ? 'sel' : ''} onMouseEnter={() => setSel(idx)} onClick={() => go(i)}>
                {Icon && <Icon size={16} />}<span>{i.label}</span><small className="muted">{i.hint}</small>
                {idx === sel && <CornerDownLeft size={14} className="enter" />}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
