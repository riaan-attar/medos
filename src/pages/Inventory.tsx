import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { daysUntil, errMsg, fmtDate, money, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, ErrorBox, Field, Modal, PageHeader, Skeleton, Tabs } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import { useToast } from '../components/Toast'
import type { InventoryRow, Listing } from '../lib/types'

type Tab = 'batches' | 'pricing'

function state(r: InventoryRow): { label: string; tone: 'bad' | 'warn' | 'info' | 'good'; rank: number } {
  const b = r.batches
  if (b.status === 'recalled') return { label: 'recalled', tone: 'bad', rank: 0 }
  const d = daysUntil(b.expiry_date)
  if (d < 0) return { label: 'expired', tone: 'bad', rank: 1 }
  if (d <= 30) return { label: `${d}d left`, tone: 'warn', rank: 2 }
  if (d <= 90) return { label: `${d}d left`, tone: 'info', rank: 3 }
  return { label: 'ok', tone: 'good', rank: 4 }
}

export default function Inventory() {
  const { session } = useAuth()
  const uid = session!.user.id
  const toast = useToast()
  const inv = useAsync(() => api.inventory(uid), [uid])
  const lst = useAsync(() => api.listings(uid), [uid])
  const acks = useAsync(() => api.myAcks(), [])
  const [tab, setTab] = useState<Tab>('batches')
  const [filter, setFilter] = useState<'all' | 'attention'>('all')
  const [adj, setAdj] = useState<InventoryRow | null>(null)
  const [ack, setAck] = useState<InventoryRow | null>(null)
  const [adjF, setAdjF] = useState({ type: 'damage', qty: 1, note: '' })
  const [ackF, setAckF] = useState({ status: 'quarantined', note: '' })
  const [busy, setBusy] = useState(false)

  const rows = (inv.data ?? []).filter(r => filter === 'all' || state(r).rank <= 2)
  const recalled = (inv.data ?? []).filter(r => r.batches.status === 'recalled')
  const ackOf = (batchId: string) => acks.data?.find(a => a.batch_id === batchId)

  async function submitAdj(e: FormEvent) {
    e.preventDefault(); if (!adj) return; setBusy(true)
    try { await api.adjustStock(adj.batch_id, adjF.qty, adjF.type, adjF.note); toast.ok('Stock updated'); setAdj(null); inv.reload(); lst.reload() }
    catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  async function submitAck(e: FormEvent) {
    e.preventDefault(); if (!ack) return; setBusy(true)
    try { await api.ackRecall(ack.batch_id, ackF.status, ackF.note); toast.ok('Recall response sent'); setAck(null); acks.reload() }
    catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  async function saveListing(l: Listing, patch: { unit_price?: number; reorder_level?: number }) {
    try { await api.updateListing(l.id, patch); toast.ok('Saved'); lst.reload() } catch (x) { toast.err(errMsg(x)); lst.reload() }
  }

  const cols: Column<InventoryRow>[] = [
    { key: 'med', header: 'Medicine', value: r => `${r.batches.medicines.name} ${r.batches.medicines.strength}`,
      render: r => <><b>{r.batches.medicines.name}</b> <span className="muted">{r.batches.medicines.strength} · {r.batches.medicines.pack_size}</span></> },
    { key: 'batch', header: 'Batch', value: r => r.batches.batch_no },
    { key: 'expiry', header: 'Expiry', value: r => r.batches.expiry_date, render: r => fmtDate(r.batches.expiry_date) },
    { key: 'state', header: 'State', value: r => state(r).rank, render: r => {
      const s = state(r)
      return <><Badge tone={s.tone}>{s.label}</Badge>{r.batches.status === 'recalled' && r.batches.recall_reason && <div className="muted small">{r.batches.recall_reason}</div>}</>
    } },
    { key: 'reserved', header: 'Reserved', align: 'right', render: r => (r.reserved ? <span className="muted">{num(r.reserved)}</span> : '—') },
    { key: 'quantity', header: 'On hand', align: 'right', render: r => <b>{num(r.quantity)}</b> },
    { key: 'act', header: '', noSort: true, noCsv: true, align: 'right', render: r => (
      <div className="row gap end">
        {r.batches.status === 'recalled' && (ackOf(r.batch_id)
          ? <Badge tone="good">{ackOf(r.batch_id)!.status}</Badge>
          : <button className="btn danger sm" onClick={() => { setAckF({ status: 'quarantined', note: '' }); setAck(r) }}><ShieldAlert size={14} /> Respond</button>)}
        <button className="btn ghost sm" onClick={() => {
          const bad = r.batches.status === 'recalled' ? 'recall_writeoff' : daysUntil(r.batches.expiry_date) < 0 ? 'expired_writeoff' : 'damage'
          setAdjF({ type: bad, qty: 1, note: '' }); setAdj(r)
        }}><SlidersHorizontal size={14} /> Adjust</button>
      </div>) },
  ]

  const lcols: Column<Listing>[] = [
    { key: 'med', header: 'Medicine', value: l => l.medicines.name, render: l => <><b>{l.medicines.name}</b> <span className="muted">{l.medicines.strength}</span></> },
    { key: 'mrp', header: 'MRP', align: 'right', value: l => l.medicines.mrp, render: l => money(l.medicines.mrp) },
    { key: 'price', header: 'Your price', align: 'right', value: l => l.unit_price, render: l => (
      <input className="inline-num" type="number" step="0.01" min="0" max={l.medicines.mrp} defaultValue={l.unit_price}
        onBlur={e => Number(e.target.value) !== Number(l.unit_price) && saveListing(l, { unit_price: Number(e.target.value) })} />) },
    { key: 'reorder', header: 'Reorder level', align: 'right', value: l => l.reorder_level, render: l => (
      <input className="inline-num" type="number" min="0" defaultValue={l.reorder_level}
        onBlur={e => Number(e.target.value) !== l.reorder_level && saveListing(l, { reorder_level: Number(e.target.value) })} />) },
    { key: 'sellable', header: 'Sellable now', align: 'right', value: l => availOf(l), render: l => {
      const a = availOf(l)
      return a < l.reorder_level ? <Badge tone="warn">{num(a)} (low)</Badge> : num(a)
    } },
  ]
  function availOf(l: Listing) {
    return (inv.data ?? []).filter(r => r.batches.medicine_id === l.medicine_id && r.batches.status === 'active' && daysUntil(r.batches.expiry_date) >= 0)
      .reduce((s, r) => s + r.quantity - r.reserved, 0)
  }

  return (
    <>
      <PageHeader title="Inventory" subtitle="Everything you hold, by batch — reserved stock is held for accepted orders"
        actions={<Link to="/reorder" className="btn">Reorder suggestions</Link>} />
      {recalled.length > 0 && <Alert tone="err">{recalled.length} recalled batch(es) in your stock. Quarantine them and respond to the manufacturer.</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'batches', label: 'Batches' }, { id: 'pricing', label: 'Pricing & reorder levels' }]} />

      {tab === 'batches' && (<>
        {inv.loading && !inv.data && <Skeleton />}
        {inv.error && <ErrorBox message={inv.error} onRetry={inv.reload} />}
        {inv.data && <DataTable rows={rows} columns={cols} rowKey={r => r.id} exportName="inventory" searchPlaceholder="Search medicine or batch…" initialSort={{ key: 'expiry', dir: 'asc' }}
          toolbar={<select value={filter} onChange={e => setFilter(e.target.value as 'all' | 'attention')}>
            <option value="all">All stock</option><option value="attention">Needs attention</option></select>}
          empty={{ title: 'No stock to show', hint: 'Stock appears here when you produce a batch or receive an order.' }} />}
      </>)}

      {tab === 'pricing' && (<>
        {lst.loading && !lst.data && <Skeleton />}
        {lst.error && <ErrorBox message={lst.error} onRetry={lst.reload} />}
        {lst.data && <DataTable rows={lst.data} columns={lcols} rowKey={l => l.id} exportName="pricing" searchPlaceholder="Search medicines…" empty={{ title: 'Nothing listed yet' }} />}
        <p className="muted small">Prices can never exceed MRP. Edit a value and click away to save.</p>
      </>)}

      {adj && (
        <Modal title={`Adjust ${adj.batches.medicines.name} · ${adj.batches.batch_no}`} onClose={() => setAdj(null)}>
          <form onSubmit={submitAdj} className="stack">
            <p className="muted">Holding <b>{num(adj.quantity)}</b> units{adj.reserved > 0 && <>, of which <b>{num(adj.reserved)}</b> are reserved for open orders</>}.</p>
            <Field label="Reason">
              <select value={adjF.type} onChange={e => setAdjF({ ...adjF, type: e.target.value })}>
                <option value="damage">Damaged / lost (reduce)</option>
                <option value="expired_writeoff">Expired write-off (reduce)</option>
                <option value="recall_writeoff">Recalled write-off (reduce)</option>
                <option value="adjustment">Count correction (+ or −)</option>
              </select>
            </Field>
            <Field label={adjF.type === 'adjustment' ? 'Change (use negative to reduce)' : 'Quantity to remove'}>
              <input type="number" required value={adjF.qty} onChange={e => setAdjF({ ...adjF, qty: Number(e.target.value) })} />
            </Field>
            <Field label="Note"><input value={adjF.note} onChange={e => setAdjF({ ...adjF, note: e.target.value })} /></Field>
            <div className="row gap end"><button type="button" className="btn ghost" onClick={() => setAdj(null)}>Cancel</button><button className="btn primary" disabled={busy}>Apply</button></div>
          </form>
        </Modal>
      )}
      {ack && (
        <Modal title={`Respond to recall — ${ack.batches.batch_no}`} onClose={() => setAck(null)}>
          <form onSubmit={submitAck} className="stack">
            <p className="muted">{ack.batches.recall_reason || 'The manufacturer recalled this batch.'}</p>
            <Field label="What did you do?">
              <select value={ackF.status} onChange={e => setAckF({ ...ackF, status: e.target.value })}>
                <option value="quarantined">Quarantined — set aside, not for sale</option>
                <option value="returned">Returned to supplier</option>
                <option value="disposed">Disposed / destroyed</option>
              </select>
            </Field>
            <Field label="Note"><input value={ackF.note} onChange={e => setAckF({ ...ackF, note: e.target.value })} /></Field>
            <div className="row gap end"><button type="button" className="btn ghost" onClick={() => setAck(null)}>Cancel</button><button className="btn primary" disabled={busy}>Send response</button></div>
          </form>
        </Modal>
      )}
    </>
  )
}
