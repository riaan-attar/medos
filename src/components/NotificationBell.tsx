import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/format'
import type { AppNotification } from '../lib/types'

export default function NotificationBell() {
  const { session } = useAuth()
  const nav = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(() => { api.notifications().then(setItems).catch(() => {}) }, [])

  useEffect(() => {
    if (!session) return
    const uid = session.user.id
    load()
    const ch = supabase.channel('notif-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session, load])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const unread = items.filter(n => !n.read)

  async function openItem(n: AppNotification) {
    if (!n.read) await api.markRead([n.id]).catch(() => {})
    setOpen(false); load()
    if (n.link) nav(n.link)
  }

  return (
    <div className="popover-wrap" ref={box}>
      <button className="icon-btn bell" onClick={() => setOpen(o => !o)} aria-label={`Notifications (${unread.length} unread)`}>
        <Bell size={19} />{unread.length > 0 && <span className="dot">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="popover-head">
            <strong>Notifications</strong>
            {unread.length > 0 && (
              <button className="link small" onClick={async () => { await api.markRead(unread.map(n => n.id)); load() }}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <ul>
            {items.length === 0 && <li className="muted palette-empty">You're all caught up</li>}
            {items.slice(0, 7).map(n => (
              <li key={n.id} className={n.read ? '' : 'unread'} onClick={() => openItem(n)}>
                <div className="row between"><b>{n.title}</b><small className="muted">{timeAgo(n.created_at)}</small></div>
                {n.body && <div className="muted small">{n.body}</div>}
              </li>
            ))}
          </ul>
          <Link to="/notifications" className="popover-foot" onClick={() => setOpen(false)}>View all</Link>
        </div>
      )}
    </div>
  )
}
