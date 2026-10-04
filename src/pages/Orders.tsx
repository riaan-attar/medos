import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { fmtDateTime, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { ErrorBox, PageHeader, Skeleton, StatusBadge, Tabs } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { Order } from '../lib/types'

export default function Orders() {
  const { session, profile } = useAuth()
  const nav = useNavigate()
  const uid = session!.user.id
  const role = profile!.role
  const { data, error, loading, reload } = useAsync(() => api.orders(uid), [uid])
  const canSell = role === 'manufacturer' || role === 'distributor' || role === 'retailer'
  const canBuy = role !== 'manufacturer'
  const [tab, setTab] = useState<'in' | 'out'>(canSell ? 'in' : 'out')
  const [status, setStatus] = useState('all')

  const all = data ?? []
  const list = all.filter(o => (tab === 'in' ? o.seller_id === uid : o.buyer_id === uid)).filter(o => status === 'all' || o.status === status)
  const count = (t: 'in' | 'out') => all.filter(o => (t === 'in' ? o.seller_id === uid : o.buyer_id === uid)).length
  const pendingIn = all.filter(o => o.seller_id === uid && o.status === 'pending').length

  const cols: Column<Order>[] = [
    { key: 'order_no', header: 'Order', render: o => <b>{o.order_no}</b> },
    { key: 'party', header: tab === 'in' ? 'Customer' : 'Supplier', value: o => (tab === 'in' ? o.buyer : o.seller)?.org_name || (tab === 'in' ? o.buyer : o.seller)?.full_name || '',
      render: o => { const p = tab === 'in' ? o.buyer : o.seller; return <>{p?.org_name || p?.full_name || '—'}<div className="muted small">{p?.city}</div></> } },
    { key: 'created_at', header: 'Placed', render: o => fmtDateTime(o.created_at) },
    { key: 'total', header: 'Total', align: 'right', render: o => money(o.total) },
    { key: 'status', header: 'Status', render: o => <StatusBadge status={o.status} buyerRole={o.buyer?.role} /> },
  ]

  return (
    <>
      <PageHeader title={role === 'consumer' ? 'My orders' : 'Orders'} subtitle="Track every order from request to delivery" />
      <Tabs value={tab} onChange={setTab} tabs={[
        ...(canSell ? [{ id: 'in' as const, label: <>Received <span className="count">{count('in')}</span>{pendingIn > 0 && <span className="count warn">{pendingIn} new</span>}</> }] : []),
        ...(canBuy ? [{ id: 'out' as const, label: <>Placed <span className="count">{count('out')}</span></> }] : []),
      ]} />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={list} columns={cols} rowKey={o => o.id} exportName="orders" searchPlaceholder="Search orders…" onRowClick={o => nav(`/orders/${o.id}`)}
        initialSort={{ key: 'created_at', dir: 'desc' }}
        toolbar={<select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>{['pending', 'accepted', 'partially_shipped', 'shipped', 'delivered', 'rejected', 'cancelled'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>}
        empty={{ title: 'No orders here yet', hint: canBuy && tab === 'out' ? 'Place your first order from the marketplace.' : undefined }} />}
    </>
  )
}
