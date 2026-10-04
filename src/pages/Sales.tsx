import { useState } from 'react'
import { Printer, Undo2 } from 'lucide-react'
import { printDoc } from '../lib/print'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, fmtDateTime, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, Modal, PageHeader, Skeleton, Stat } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import ReceiptDoc from '../components/ReceiptDoc'
import { useToast } from '../components/Toast'
import type { SaleBill } from '../lib/types'

export default function Sales() {
  const { profile } = useAuth()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.bills(), [])
  const [sel, setSel] = useState<SaleBill | null>(null)
  const [refund, setRefund] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'all'>('today')

  const since = range === 'all' ? 0 : new Date(new Date().setHours(0, 0, 0, 0)).getTime() - (range === 'today' ? 0 : (range === '7d' ? 6 : 29)) * 86400000
  const rows = (data ?? []).filter(b => new Date(b.created_at).getTime() >= since)
  const net = (b: SaleBill) => Number(b.total) - Number(b.refunded_total)
  const revenue = rows.reduce((s, b) => s + net(b), 0)
  const byMode = rows.reduce<Record<string, number>>((m, b) => { m[b.payment_mode] = (m[b.payment_mode] ?? 0) + net(b); return m }, {})

  async function doRefund() {
    if (!sel) return
    const lines = Object.entries(refund).filter(([, q]) => q > 0).map(([line_id, quantity]) => ({ line_id, quantity }))
    if (lines.length === 0) return
    setBusy(true)
    try { const amt = await api.refundBill(sel.id, lines, 'Customer return'); toast.ok(`Refunded ${money(amt)} — stock restored`); setSel(null); setRefund({}); reload() }
    catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  const cols: Column<SaleBill>[] = [
    { key: 'bill_no', header: 'Bill', render: b => <b>{b.bill_no}</b> },
    { key: 'created_at', header: 'Time', render: b => fmtDateTime(b.created_at) },
    { key: 'customer', header: 'Customer', value: b => `${b.customer_name} ${b.customer_phone}`.trim() || 'Walk-in', render: b => b.customer_name || b.customer_phone || <span className="muted">Walk-in</span> },
    { key: 'items', header: 'Items', align: 'right', value: b => (b.sale_bill_lines ?? []).reduce((s, l) => s + l.quantity, 0) },
    { key: 'payment_mode', header: 'Payment', render: b => <Badge>{b.payment_mode}</Badge> },
    { key: 'total', header: 'Total', align: 'right', render: b => money(b.total) },
    { key: 'refunded_total', header: 'Refunded', align: 'right', render: b => (Number(b.refunded_total) ? <span className="neg">− {money(b.refunded_total)}</span> : '—') },
  ]

  return (
    <>
      <PageHeader title="Sales & bills" subtitle="Counter sales history with receipts and refunds" />
      <div className="stats">
        <Stat label={range === 'today' ? "Today's revenue" : 'Revenue'} value={money(revenue)} tone="good" hint={`${rows.length} bill(s)`} />
        <Stat label="Average bill" value={money(rows.length ? revenue / rows.length : 0)} />
        {Object.entries(byMode).map(([m, v]) => <Stat key={m} label={`${m.toUpperCase()}`} value={money(v)} />)}
      </div>
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={rows} columns={cols} rowKey={b => b.id} exportName="sales" searchPlaceholder="Search bill, customer…" onRowClick={b => { setSel(b); setRefund({}) }}
        initialSort={{ key: 'created_at', dir: 'desc' }}
        toolbar={<select value={range} onChange={e => setRange(e.target.value as typeof range)}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select>}
        empty={{ title: 'No bills in this period', hint: 'Create one from Point of sale.' }} />}

      {sel && (
        <Modal title={sel.bill_no} onClose={() => setSel(null)} wide>
          <ReceiptDoc bill={sel} shop={profile!} />
          <h3 className="no-print">Refund items</h3>
          <div className="table-wrap flat no-print"><table>
            <thead><tr><th>Item</th><th className="r">Sold</th><th className="r">Returned</th><th className="r">Refund qty</th></tr></thead>
            <tbody>{(sel.sale_bill_lines ?? []).map(l => (
              <tr key={l.id}><td>{l.medicines?.name} <span className="muted">batch {l.batches?.batch_no}</span></td><td className="r">{l.quantity}</td><td className="r">{l.returned_qty}</td>
                <td className="r"><input className="inline-num" type="number" min="0" max={l.quantity - l.returned_qty} disabled={l.quantity - l.returned_qty <= 0}
                  value={refund[l.id] ?? ''} onChange={e => setRefund({ ...refund, [l.id]: Math.min(l.quantity - l.returned_qty, Math.max(0, Number(e.target.value))) })} /></td></tr>))}</tbody>
          </table></div>
          <div className="row gap end no-print">
            <button className="btn" onClick={() => printDoc('a4')}><Printer size={16} /> Print A4</button>
            <button className="btn" onClick={() => printDoc('thermal')}><Printer size={16} /> Thermal</button>
            <button className="btn danger" disabled={busy || !Object.values(refund).some(q => q > 0)} onClick={doRefund}><Undo2 size={16} /> Refund selected</button>
          </div>
        </Modal>
      )}
    </>
  )
}
