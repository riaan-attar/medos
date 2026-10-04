import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { MovementType, Movement } from '../lib/types'

const LABEL: Record<MovementType, string> = {
  production: 'Produced', transfer_in: 'Received', transfer_out: 'Shipped', sale: 'Sold',
  adjustment: 'Adjustment', damage: 'Damaged', expired_writeoff: 'Expired write-off', recall_writeoff: 'Recall write-off',
  return_in: 'Return received', return_out: 'Return sent', sale_return: 'Customer refund',
}

export default function Ledger() {
  const { session } = useAuth()
  const uid = session!.user.id
  const { data, error, loading, reload } = useAsync(() => api.movements(uid, 1000), [uid])
  const [type, setType] = useState('all')
  const rows = (data ?? []).filter(m => type === 'all' || m.movement_type === type)

  const cols: Column<Movement>[] = [
    { key: 'created_at', header: 'When', render: m => fmtDateTime(m.created_at) },
    { key: 'movement_type', header: 'Type', value: m => LABEL[m.movement_type], render: m => <Badge tone={m.quantity > 0 ? 'good' : 'neutral'}>{LABEL[m.movement_type]}</Badge> },
    { key: 'med', header: 'Medicine', value: m => m.medicines?.name, render: m => <>{m.medicines?.name} <span className="muted">{m.medicines?.strength}</span></> },
    { key: 'batch', header: 'Batch', value: m => m.batches?.batch_no },
    { key: 'cp', header: 'Counterparty', value: m => m.counterparty?.org_name || m.counterparty?.full_name || '' },
    { key: 'quantity', header: 'Change', align: 'right', render: m => <b className={m.quantity > 0 ? 'pos' : 'neg'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</b> },
    { key: 'note', header: 'Note', render: m => (m.order_id ? <Link to={`/orders/${m.order_id}`}>{m.note}</Link> : <span className="muted">{m.note}</span>) },
  ]

  return (
    <>
      <PageHeader title="Stock ledger" subtitle="Immutable audit trail of every unit in and out" />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={rows} columns={cols} rowKey={m => m.id} exportName="stock-ledger" pageSize={15} searchPlaceholder="Search medicine, batch, note…"
        toolbar={<select value={type} onChange={e => setType(e.target.value)}><option value="all">All movements</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
        initialSort={{ key: 'created_at', dir: 'desc' }} empty={{ title: 'No movements yet' }} />}
    </>
  )
}
