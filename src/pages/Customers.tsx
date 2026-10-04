import { useState, type FormEvent } from 'react'
import { HandCoins, History } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, fmtDate, fmtDateTime, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, ErrorBox, Field, Modal, PageHeader, Skeleton, Stat } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import { useToast } from '../components/Toast'
import type { CustomerBalance } from '../lib/types'

export default function Customers() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.customerBalances(), [])
  const [only, setOnly] = useState<'all' | 'owing'>('all')
  const [pay, setPay] = useState<CustomerBalance | null>(null)
  const [hist, setHist] = useState<CustomerBalance | null>(null)
  const rows = (data ?? []).filter(r => only === 'all' || Number(r.balance) > 0.005)
  const owed = (data ?? []).reduce((s, r) => s + Math.max(0, Number(r.balance)), 0)
  const owing = (data ?? []).filter(r => Number(r.balance) > 0.005).length

  const cols: Column<CustomerBalance>[] = [
    { key: 'name', header: 'Customer', render: r => <b>{r.name || 'Unnamed'}</b> },
    { key: 'phone', header: 'Phone' },
    { key: 'bills', header: 'Bills', align: 'right' },
    { key: 'spent', header: 'Total spent', align: 'right', render: r => money(r.spent) },
    { key: 'balance', header: 'Owes you', align: 'right', value: r => Number(r.balance), render: r => (Number(r.balance) > 0.005 ? <b className="balance-chip owes">{money(r.balance)}</b> : <span className="muted">—</span>) },
    { key: 'last_activity', header: 'Last credit activity', render: r => fmtDate(r.last_activity) },
    { key: 'act', header: '', noSort: true, noCsv: true, align: 'right', render: r => (
      <div className="row gap end">
        <button className="btn ghost sm" onClick={() => setHist(r)}><History size={14} /> Ledger</button>
        {Number(r.balance) > 0.005 && <button className="btn primary sm" onClick={() => setPay(r)}><HandCoins size={14} /> Collect</button>}
      </div>) },
  ]

  return (
    <>
      <PageHeader title="Customers" subtitle="Customers are added automatically when you enter a phone number at the counter. Credit sales build a running balance." />
      <div className="stats">
        <Stat label="Customers" value={data?.length ?? '—'} />
        <Stat label="Credit outstanding" value={money(owed)} tone={owed ? 'warn' : undefined} hint={`${owing} customer(s) owe you`} />
      </div>
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={rows} columns={cols} rowKey={r => r.customer_id} exportName="customers" searchPlaceholder="Search name or phone…" initialSort={{ key: 'balance', dir: 'desc' }}
        toolbar={<select value={only} onChange={e => setOnly(e.target.value as typeof only)}><option value="all">All customers</option><option value="owing">Only those who owe</option></select>}
        empty={{ title: 'No customers yet', hint: 'Add a phone number on a bill to build your customer list.' }} />}
      {pay && <CollectModal c={pay} allowed={can('customers')} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); toast.ok('Payment recorded') }} />}
      {hist && <LedgerModal c={hist} onClose={() => setHist(null)} />}
    </>
  )
}

function CollectModal({ c, allowed, onClose, onDone }: { c: CustomerBalance; allowed: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const bal = Number(c.balance)
  const [amount, setAmount] = useState(bal)
  const [mode, setMode] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { await api.collectPayment(c.customer_id, amount, mode, note); onDone() } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Collect payment — ${c.name || c.phone}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!allowed && <Alert tone="err">Your role cannot record payments.</Alert>}
        <p className="muted">Outstanding: <b>{money(bal)}</b></p>
        <div className="grid2">
          <Field label="Amount received (₹)"><input type="number" step="0.01" min="0.01" max={bal} required value={amount} onChange={e => setAmount(Number(e.target.value))} /></Field>
          <Field label="Mode"><select value={mode} onChange={e => setMode(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></Field>
        </div>
        <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="row gap end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !allowed}>Record payment</button></div>
      </form>
    </Modal>
  )
}

function LedgerModal({ c, onClose }: { c: CustomerBalance; onClose: () => void }) {
  const { data, error, loading } = useAsync(() => api.customerLedger(c.customer_id), [c.customer_id])
  // running balance, oldest first
  const asc = [...(data ?? [])].reverse()
  let run = 0
  const withBal = asc.map(e => { run += e.kind === 'charge' ? Number(e.amount) : -Number(e.amount); return { ...e, run } }).reverse()
  return (
    <Modal title={`Ledger — ${c.name || c.phone}`} onClose={onClose} wide>
      {loading && <Skeleton rows={3} />}
      {error && <ErrorBox message={error} />}
      {data && data.length === 0 && <p className="muted">No credit activity yet.</p>}
      {withBal.length > 0 && (
        <div className="table-wrap flat"><table>
          <thead><tr><th>When</th><th>Entry</th><th>Bill</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead>
          <tbody>{withBal.map(e => (
            <tr key={e.id}><td>{fmtDateTime(e.created_at)}</td>
              <td><Badge tone={e.kind === 'charge' ? 'warn' : 'good'}>{e.kind === 'charge' ? 'credit sale' : e.kind === 'payment' ? `payment${e.mode ? ` (${e.mode})` : ''}` : 'refund'}</Badge>{e.note && <span className="muted small"> {e.note}</span>}</td>
              <td>{e.sale_bills?.bill_no ?? '—'}</td>
              <td className={`r ${e.kind === 'charge' ? 'neg' : 'pos'}`}>{e.kind === 'charge' ? '+' : '−'}{money(e.amount)}</td><td className="r"><b>{money(e.run)}</b></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  )
}
