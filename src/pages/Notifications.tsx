import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, Empty, ErrorBox, PageHeader, Skeleton, Tabs } from '../components/ui'

const CAT: Record<string, { label: string; tone: 'info' | 'good' | 'warn' | 'bad' | 'neutral' }> = {
  order: { label: 'Order', tone: 'info' }, payment: { label: 'Payment', tone: 'good' }, return: { label: 'Return', tone: 'warn' },
  recall: { label: 'Recall', tone: 'bad' }, account: { label: 'Account', tone: 'neutral' }, general: { label: 'Update', tone: 'neutral' },
}

export default function Notifications() {
  const { data, error, loading, reload } = useAsync(() => api.notifications(), [])
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const unread = (data ?? []).filter(n => !n.read)
  const list = tab === 'unread' ? unread : data ?? []

  return (
    <>
      <PageHeader title="Notifications" actions={unread.length > 0 && <button className="btn sm" onClick={async () => { await api.markRead(unread.map(n => n.id)); reload() }}><CheckCheck size={14} /> Mark all read</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: <>Unread <span className="count">{unread.length}</span></> }]} />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && list.length === 0 && <Empty icon={<Bell size={26} />} title="You're all caught up" />}
      <ul className="notes">
        {list.map(n => {
          const c = CAT[n.category] ?? CAT.general
          return (
            <li key={n.id} className={n.read ? '' : 'unread'}>
              <div className="row between"><span className="row gap"><Badge tone={c.tone}>{c.label}</Badge><b>{n.title}</b></span><small className="muted">{timeAgo(n.created_at)}</small></div>
              {n.body && <div className="muted">{n.body}</div>}
              <div className="row gap">
                {n.link && <Link to={n.link} className="small" onClick={() => !n.read && api.markRead([n.id])}>Open →</Link>}
                <button className="icon-btn" aria-label="Delete notification" onClick={async () => { await api.deleteNotification(n.id); reload() }}><Trash2 size={14} /></button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
