import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { fmtDate, money, outstanding } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, PageHeader, Skeleton, Stat, Tabs } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { AccountBalance, Invoice } from '../lib/types'

export default function Accounts() {
  const { session } = useAuth()
  const uid = session!.user.id
  const nav = useNavigate()
  const inv = useAsync(() => api.invoices(), [])
  const bal = useAsync(() => api.balances(), [])
  const [tab, setTab] = useState<'invoices' | 'parties'>('invoices')
  const [dir, setDir] = useState<'all' | 'sales' | 'purchases'>('all')
  const [status, setStatus] = useState('open')

  const all = inv.data ?? []
  const rows = all.filter(i => (dir === 'all' || (dir === 'sales' ? i.seller_id === uid : i.buyer_id === uid))
    && (status === 'all' || (status === 'open' ? i.status === 'unpaid' || i.status === 'partial' : i.status === status)))
  const overdue = (i: Invoice) => outstanding(i) > 0 && i.due_date < new Date().toISOString().slice(0, 10)
  const recv = bal.data?.reduce((s, b) => s + Number(b.receivable), 0) ?? 0
  const pay = bal.data?.reduce((s, b) => s + Number(b.payable), 0) ?? 0
  const od = bal.data?.reduce((s, b) => s + Number(b.overdue), 0) ?? 0

  const cols: Column<Invoice>[] = [
    { key: 'invoice_no', header: 'Invoice', render: i => <b>{i.invoice_no}</b> },
    { key: 'order', header: 'Order', value: i => i.orders?.order_no },
    { key: 'dir', header: 'Type', value: i => (i.seller_id === uid ? 'Sale' : 'Purchase'), render: i => <Badge tone={i.seller_id === uid ? 'good' : 'info'}>{i.seller_id === uid ? 'sale' : 'purchase'}</Badge> },
    { key: 'party', header: 'Party', value: i => (i.seller_id === uid ? i.buyer : i.seller)?.org_name || (i.seller_id === uid ? i.buyer : i.seller)?.full_name },
    { key: 'created_at', header: 'Issued', render: i => fmtDate(i.created_at) },
    { key: 'due_date', header: 'Due', render: i => fmtDate(i.due_date) },
    { key: 'total', header: 'Total', align: 'right', render: i => money(i.total) },
    { key: 'paid_total', header: 'Paid', align: 'right', render: i => money(i.paid_total) },
    { key: 'due', header: 'Balance', align: 'right', value: i => outstanding(i), render: i => <b>{money(outstanding(i))}</b> },
    { key: 'status', header: 'Status', value: i => (overdue(i) ? 'overdue' : i.status), render: i => (
      <Badge tone={i.status === 'paid' ? 'good' : i.status === 'void' ? 'neutral' : overdue(i) ? 'bad' : 'warn'}>{overdue(i) ? 'overdue' : i.status}</Badge>) },
  ]
  const pcols: Column<AccountBalance>[] = [
    { key: 'org_name', header: 'Party', render: b => <b>{b.org_name}</b> },
    { key: 'role', header: 'Type' },
    { key: 'receivable', header: 'They owe you', align: 'right', render: b => (Number(b.receivable) > 0 ? <b className="pos">{money(b.receivable)}</b> : '—') },
    { key: 'payable', header: 'You owe', align: 'right', render: b => (Number(b.payable) > 0 ? <b className="neg">{money(b.payable)}</b> : '—') },
    { key: 'overdue', header: 'Overdue', align: 'right', render: b => (Number(b.overdue) > 0 ? <Badge tone="bad">{money(b.overdue)}</Badge> : '—') },
  ]

  return (
    <>
      <PageHeader title="Accounts" subtitle="Invoices, payments and who owes whom" />
      <div className="stats">
        <Stat label="Receivable" value={money(recv)} tone="good" hint="owed to you" />
        <Stat label="Payable" value={money(pay)} hint="you owe suppliers" />
        <Stat label="Overdue" value={money(od)} tone={od ? 'bad' : undefined} hint="across both sides" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices' }, { id: 'parties', label: 'By party' }]} />
      {tab === 'invoices' && (<>
        {inv.loading && !inv.data && <Skeleton />}
        {inv.error && <ErrorBox message={inv.error} onRetry={inv.reload} />}
        {inv.data && <DataTable rows={rows} columns={cols} rowKey={i => i.id} exportName="invoices" onRowClick={i => nav(`/orders/${i.order_id}`)} initialSort={{ key: 'created_at', dir: 'desc' }}
          toolbar={<>
            <select value={dir} onChange={e => setDir(e.target.value as 'all' | 'sales' | 'purchases')}><option value="all">Sales &amp; purchases</option><option value="sales">Sales only</option><option value="purchases">Purchases only</option></select>
            <select value={status} onChange={e => setStatus(e.target.value)}><option value="open">Open (unpaid / partial)</option><option value="all">All</option><option value="paid">Paid</option><option value="void">Void</option></select>
          </>}
          empty={{ title: 'No invoices', hint: 'An invoice is created when a seller accepts an order.' }} />}
      </>)}
      {tab === 'parties' && (<>
        {bal.loading && !bal.data && <Skeleton />}
        {bal.error && <ErrorBox message={bal.error} onRetry={bal.reload} />}
        {bal.data && <DataTable rows={bal.data} columns={pcols} rowKey={b => b.counterparty_id} exportName="balances" empty={{ title: 'All settled', hint: 'No outstanding balances.' }} />}
      </>)}
    </>
  )
}
