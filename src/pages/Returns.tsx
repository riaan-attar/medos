import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { fmtDateTime, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { ReturnRow } from '../lib/types'

export default function Returns() {
  const { session } = useAuth()
  const uid = session!.user.id
  const nav = useNavigate()
  const { data, error, loading, reload } = useAsync(() => api.returns(), [])
  const cols: Column<ReturnRow>[] = [
    { key: 'return_no', header: 'Return', render: r => <b>{r.return_no}</b> },
    { key: 'order', header: 'Order', value: r => r.orders?.order_no },
    { key: 'dir', header: 'Direction', value: r => (r.seller_id === uid ? 'Incoming' : 'Outgoing'), render: r => <Badge tone={r.seller_id === uid ? 'warn' : 'info'}>{r.seller_id === uid ? 'incoming' : 'outgoing'}</Badge> },
    { key: 'party', header: 'Party', value: r => (r.seller_id === uid ? r.buyer : r.seller)?.org_name },
    { key: 'items', header: 'Items', value: r => r.return_items.map(i => `${i.order_items?.medicines.name} ×${i.quantity}`).join(', '), render: r => <span className="small">{r.return_items.map(i => `${i.order_items?.medicines.name} ×${i.quantity}`).join(', ')}</span> },
    { key: 'reason', header: 'Reason' },
    { key: 'credit_amount', header: 'Credit', align: 'right', render: r => (r.status === 'completed' ? money(r.credit_amount) : '—') },
    { key: 'status', header: 'Status', render: r => <Badge tone={r.status === 'completed' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn'}>{r.status}</Badge> },
    { key: 'created_at', header: 'Requested', render: r => fmtDateTime(r.created_at) },
  ]
  return (
    <>
      <PageHeader title="Returns" subtitle="Return requests you sent or received. Open an order to respond." />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={data} columns={cols} rowKey={r => r.id} exportName="returns" onRowClick={r => nav(`/orders/${r.order_id}`)}
        initialSort={{ key: 'created_at', dir: 'desc' }} empty={{ title: 'No returns', hint: 'Request a return from a delivered order.' }} />}
    </>
  )
}
