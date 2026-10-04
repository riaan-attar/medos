import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate, fmtDateTime, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, PageHeader, Skeleton, StatusBadge, Tabs } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { AuditRow, Batch, Medicine, Order } from '../lib/types'

type Tab = 'orders' | 'recalls' | 'audit'

export default function AdminActivity() {
  const [tab, setTab] = useState<Tab>('orders')
  const orders = useAsync(() => api.allOrders(), [])
  const recalls = useAsync(() => api.recalledBatches(), [])
  const audit = useAsync(() => api.audit(), [])

  const oc: Column<Order>[] = [
    { key: 'order_no', header: 'Order', render: o => <Link to={`/orders/${o.id}`}><b>{o.order_no}</b></Link> },
    { key: 'seller', header: 'Seller', value: o => o.seller?.org_name },
    { key: 'buyer', header: 'Buyer', value: o => o.buyer?.org_name || o.buyer?.full_name },
    { key: 'created_at', header: 'Placed', render: o => fmtDateTime(o.created_at) },
    { key: 'total', header: 'Total', align: 'right', render: o => money(o.total) },
    { key: 'status', header: 'Status', render: o => <StatusBadge status={o.status} buyerRole={o.buyer?.role} /> },
  ]
  const rc: Column<Batch & { medicines: Medicine }>[] = [
    { key: 'batch_no', header: 'Batch', render: b => <b>{b.batch_no}</b> },
    { key: 'med', header: 'Medicine', value: b => b.medicines.name },
    { key: 'expiry_date', header: 'Expiry', render: b => fmtDate(b.expiry_date) },
    { key: 'recall_reason', header: 'Reason' },
    { key: 'status', header: 'Status', render: () => <Badge tone="bad">recalled</Badge> },
  ]
  const ac: Column<AuditRow>[] = [
    { key: 'created_at', header: 'When', render: a => fmtDateTime(a.created_at) },
    { key: 'action', header: 'Action', render: a => <Badge>{a.action}</Badge> },
    { key: 'entity', header: 'Entity' },
    { key: 'actor_id', header: 'Actor', render: a => <span className="muted small">{a.actor_id?.slice(0, 8) ?? 'system'}</span> },
    { key: 'detail', header: 'Detail', value: a => JSON.stringify(a.detail), render: a => <span className="muted small">{JSON.stringify(a.detail)}</span> },
  ]

  return (
    <>
      <PageHeader title="Monitoring" subtitle="Platform-wide orders, recalls and an audit trail of sensitive actions" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'orders', label: 'All orders' }, { id: 'recalls', label: <>Recalls <span className="count">{recalls.data?.length ?? 0}</span></> }, { id: 'audit', label: 'Audit log' }]} />
      {tab === 'orders' && (orders.loading && !orders.data ? <Skeleton /> : orders.error ? <ErrorBox message={orders.error} onRetry={orders.reload} /> : <DataTable rows={orders.data ?? []} columns={oc} rowKey={o => o.id} exportName="all-orders" initialSort={{ key: 'created_at', dir: 'desc' }} />)}
      {tab === 'recalls' && (recalls.loading && !recalls.data ? <Skeleton /> : recalls.error ? <ErrorBox message={recalls.error} onRetry={recalls.reload} /> : <DataTable rows={recalls.data ?? []} columns={rc} rowKey={b => b.id} exportName="recalls" empty={{ title: 'No active recalls' }} />)}
      {tab === 'audit' && (audit.loading && !audit.data ? <Skeleton /> : audit.error ? <ErrorBox message={audit.error} onRetry={audit.reload} /> : <DataTable rows={audit.data ?? []} columns={ac} rowKey={a => a.id} exportName="audit-log" pageSize={15} initialSort={{ key: 'created_at', dir: 'desc' }} empty={{ title: 'No audit entries yet' }} />)}
    </>
  )
}
