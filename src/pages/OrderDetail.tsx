import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Check, CheckCircle2, CreditCard, FileText, FileUp, MessageSquare, PackageCheck, Printer, RotateCcw, Send, Star, Truck, X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, fmtDate, fmtDateTime, money, num, outstanding, timeAgo } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, ErrorBox, Field, Modal, PageHeader, PromptModal, Skeleton, StarInput, StatusBadge } from '../components/ui'
import InvoiceDoc from '../components/InvoiceDoc'
import { useToast } from '../components/Toast'
import type { OrderBundle, OrderStatus } from '../lib/types'

const STEPS: OrderStatus[] = ['pending', 'accepted', 'shipped', 'delivered']
const EVENT_LABEL: Record<string, string> = {
  placed: 'Order placed', accepted: 'Accepted — stock reserved', rejected: 'Rejected', cancelled: 'Cancelled', shipped: 'Shipment dispatched',
  handed_over: 'Handed over to customer', received: 'Received', closed_short: 'Closed short', payment: 'Payment recorded',
  return_requested: 'Return requested', return_approved: 'Return approved', return_rejected: 'Return rejected',
}

type Dialog = null | 'ship' | 'reject' | 'cancel' | 'close' | 'pay' | 'return' | 'invoice' | 'review'

export default function OrderDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const uid = profile!.id
  const toast = useToast()
  const nav = useNavigate()
  const { data: b, error, loading, reload } = useAsync(() => api.orderBundle(id!), [id])
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  if (loading && !b) return <Skeleton rows={8} />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!b) return null
  const { order: o, invoice: inv, shipments, returns } = b

  const isSeller = o.seller_id === uid
  const isBuyer = o.buyer_id === uid
  const toConsumer = o.buyer?.role === 'consumer'
  const items = o.order_items ?? []
  const remaining = items.reduce((s, i) => s + (i.quantity - i.shipped_qty), 0)
  const unreceived = shipments.filter(s => !s.received_at)
  const failed = o.status === 'rejected' || o.status === 'cancelled'
  const stepIdx = o.status === 'partially_shipped' ? 1 : STEPS.indexOf(o.status)
  const received = shipments.some(s => s.received_at)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try { await fn(); toast.ok(ok); setDialog(null); reload() } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  function reorder() {
    const prefill = items.map(i => `${i.medicine_id}:${i.quantity}`).join(',')
    nav(`/marketplace?seller=${o.seller_id}&prefill=${prefill}`)
  }

  return (
    <>
      <PageHeader
        back={<Link to="/orders" className="back-link"><ArrowLeft size={14} /> Orders</Link>}
        title={o.order_no}
        subtitle={<>Placed {fmtDateTime(o.created_at)} · <StatusBadge status={o.status} buyerRole={o.buyer?.role} /></>}
        actions={<>
          {inv && <button className="btn" onClick={() => setDialog('invoice')}><FileText size={16} /> Invoice</button>}
          {isBuyer && !toConsumer && <button className="btn" onClick={reorder}><RotateCcw size={16} /> Reorder</button>}
          {isBuyer && toConsumer && <button className="btn" onClick={reorder}><RotateCcw size={16} /> Reorder</button>}
        </>}
      />

      {!failed && (
        <ol className="steps">{STEPS.map((s, i) => (
          <li key={s} className={i <= stepIdx ? 'done' : ''}>{i < stepIdx || (i === stepIdx && o.status === 'delivered') ? <Check size={14} /> : null}
            {s === 'delivered' && toConsumer ? 'fulfilled' : s === 'shipped' && o.status === 'partially_shipped' ? 'partial' : s}</li>
        ))}</ol>
      )}
      {failed && <Alert tone="err">This order was {o.status}.{o.status_note && <> Reason: {o.status_note}</>}</Alert>}
      {o.status === 'pending' && isSeller && <Alert tone="info">Review this order. Accepting reserves the stock and issues the invoice.</Alert>}
      {o.status === 'partially_shipped' && <Alert tone="info">Partially shipped — {num(remaining)} unit(s) still to ship.</Alert>}

      <div className="grid-2-1 top">
        <div className="stack">
          <div className="grid2">
            <section className="card"><div className="doc-label">Supplier</div>
              <b><Link to={o.seller?.role !== 'consumer' ? `/pharmacy/${o.seller_id}` : '#'}>{o.seller?.org_name || o.seller?.full_name}</Link></b>
              <p className="muted">{o.seller?.city}</p></section>
            <section className="card"><div className="doc-label">Buyer</div>
              <b>{o.buyer?.org_name || o.buyer?.full_name}</b><p className="muted">{o.buyer?.city}</p></section>
          </div>

          {o.prescription_path && <PrescriptionLink path={o.prescription_path} />}

          <section className="card">
            <h2>Items</h2>
            <div className="table-wrap flat"><table>
              <thead><tr><th>Medicine</th><th className="r">Ordered</th><th className="r">Shipped</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id}>
                    <td><b>{i.medicines.name}</b> <span className="muted">{i.medicines.strength} · {i.medicines.pack_size}</span>{i.medicines.requires_rx && <> <Badge tone="info">Rx</Badge></>}</td>
                    <td className="r">{num(i.quantity)}</td>
                    <td className="r">{i.shipped_qty >= i.quantity ? <Badge tone="good">{num(i.shipped_qty)}</Badge> : num(i.shipped_qty)}</td>
                    <td className="r">{money(i.unit_price)}</td><td className="r">{money(i.quantity * i.unit_price)}</td>
                  </tr>))}
                <tr><td colSpan={4} className="r"><b>Subtotal</b></td><td className="r"><b>{money(o.total)}</b></td></tr>
              </tbody>
            </table></div>
            {o.notes && <p><b>Notes:</b> {o.notes}</p>}
          </section>

          <section className="card">
            <h2><Truck size={18} /> Shipments</h2>
            {shipments.length === 0 && <p className="muted">Nothing has shipped yet.</p>}
            {shipments.map((s, idx) => (
              <div key={s.id} className="shipment">
                <div className="row between wrap">
                  <b>Shipment {idx + 1}</b>
                  <span className="muted small">Dispatched {fmtDateTime(s.shipped_at)}{s.eta && <> · ETA {fmtDate(s.eta)}</>}</span>
                  {s.received_at ? <Badge tone="good">received {fmtDate(s.received_at)}</Badge> : <Badge tone="info">in transit</Badge>}
                </div>
                {s.tracking_note && <p className="muted small">Note: {s.tracking_note}</p>}
                <ul className="plain small">{s.shipment_lines.map(l => (
                  <li key={l.id} className="row between"><span>{l.order_items?.medicines.name} · batch <b>{l.batches?.batch_no}</b> · exp {fmtDate(l.batches?.expiry_date)}</span><span>{num(l.quantity)}</span></li>
                ))}</ul>
                {isBuyer && !s.received_at && !toConsumer && (
                  <button className="btn primary sm" disabled={busy} onClick={() => run(() => api.receiveShipment(s.id), 'Shipment received — stock added')}><PackageCheck size={14} /> Confirm receipt</button>
                )}
              </div>
            ))}
          </section>

          {inv && <InvoiceCard b={b} isSeller={isSeller} onPay={() => setDialog('pay')} onView={() => setDialog('invoice')} />}

          {returns.length > 0 && (
            <section className="card">
              <h2><RotateCcw size={18} /> Returns</h2>
              {returns.map(r => (
                <div key={r.id} className="shipment">
                  <div className="row between wrap"><b>{r.return_no}</b>
                    <Badge tone={r.status === 'completed' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn'}>{r.status}</Badge></div>
                  <p className="muted small">{r.reason || 'No reason given'}</p>
                  <ul className="plain small">{r.return_items.map(x => <li key={x.id} className="row between"><span>{x.order_items?.medicines.name} · batch {x.batches?.batch_no}</span><span>{x.quantity}</span></li>)}</ul>
                  {r.status === 'completed' && <p className="small">Credit note: <b>{money(r.credit_amount)}</b></p>}
                  {r.response_note && <p className="muted small">Response: {r.response_note}</p>}
                  {isSeller && r.status === 'requested' && (
                    <div className="row gap">
                      <button className="btn primary sm" disabled={busy} onClick={() => run(() => api.respondReturn(r.id, 'approve'), 'Return approved — credit issued')}>Approve</button>
                      <button className="btn danger sm" disabled={busy} onClick={() => run(() => api.respondReturn(r.id, 'reject', window.prompt('Reason for rejecting (optional)') ?? ''), 'Return rejected')}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          <ActionBar
            isSeller={isSeller} isBuyer={isBuyer} o={o} toConsumer={toConsumer} remaining={remaining} unreceived={unreceived.length} busy={busy}
            canReturn={isBuyer && !toConsumer && received} onDialog={setDialog}
            onAccept={() => run(() => api.advanceOrder(o.id, 'accept'), 'Order accepted — stock reserved')}
            onReceiveAll={() => run(() => api.advanceOrder(o.id, 'receive'), 'Received — stock added')}
          />

          {isBuyer && o.status === 'delivered' && (
            <section className="card row between wrap">
              {b.review
                ? <div className="row gap"><CheckCircle2 size={18} color="var(--good)" /> You rated this {b.review.rating}/5 <span className="muted">{b.review.comment}</span></div>
                : <span>How was your experience with {o.seller?.org_name}?</span>}
              <button className="btn" onClick={() => setDialog('review')}><Star size={16} /> {b.review ? 'Edit review' : 'Leave a review'}</button>
            </section>
          )}
        </div>

        <aside className="stack">
          <Timeline b={b} />
          <Messages b={b} uid={uid} onSent={reload} />
        </aside>
      </div>

      {dialog === 'ship' && <ShipDialog b={b} onClose={() => setDialog(null)} onSubmit={(q, eta, trk) => run(() => api.shipOrder(o.id, q, eta, trk), toConsumer ? 'Handed over' : 'Shipment dispatched')} />}
      {dialog === 'reject' && <PromptModal title="Reject order" label="Reason (optional)" confirmLabel="Reject order" tone="danger" onClose={() => setDialog(null)} onSubmit={v => run(() => api.advanceOrder(o.id, 'reject', v), 'Order rejected')} />}
      {dialog === 'cancel' && <PromptModal title="Cancel order" label="Reason (optional)" confirmLabel="Cancel order" tone="danger" onClose={() => setDialog(null)} onSubmit={v => run(() => api.advanceOrder(o.id, 'cancel', v), 'Order cancelled')} />}
      {dialog === 'close' && <PromptModal title="Close order short" label={`Cancel the remaining ${num(remaining)} unit(s) and finalise the invoice. Reason (optional):`} confirmLabel="Close short" tone="danger" onClose={() => setDialog(null)} onSubmit={v => run(() => api.advanceOrder(o.id, 'close', v), 'Order closed short')} />}
      {dialog === 'invoice' && inv && <InvoiceModal b={b} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && inv && <PayDialog b={b} onClose={() => setDialog(null)} onSubmit={(a, m, r, n) => run(() => api.recordPayment(inv.id, a, m, r, n), 'Payment recorded')} />}
      {dialog === 'return' && <ReturnDialog b={b} onClose={() => setDialog(null)} onSubmit={(it, reason) => run(() => api.requestReturn(o.id, it, reason), 'Return requested')} />}
      {dialog === 'review' && <ReviewDialog b={b} onClose={() => setDialog(null)} onSubmit={(r, c) => run(() => api.submitReview(o.id, r, c), 'Thanks for your review')} />}
    </>
  )
}

function ActionBar({ isSeller, isBuyer, o, toConsumer, remaining, unreceived, busy, canReturn, onDialog, onAccept, onReceiveAll }: {
  isSeller: boolean; isBuyer: boolean; o: OrderBundle['order']; toConsumer: boolean; remaining: number; unreceived: number
  busy: boolean; canReturn: boolean; onDialog: (d: Dialog) => void; onAccept: () => void; onReceiveAll: () => void
}) {
  const btns: React.ReactNode[] = []
  if (isSeller && o.status === 'pending') {
    btns.push(<button key="a" className="btn primary" disabled={busy} onClick={onAccept}><Check size={16} /> Accept order</button>)
    btns.push(<button key="r" className="btn danger" disabled={busy} onClick={() => onDialog('reject')}><X size={16} /> Reject</button>)
  }
  if (isSeller && (o.status === 'accepted' || o.status === 'partially_shipped') && remaining > 0) {
    btns.push(<button key="s" className="btn primary" disabled={busy} onClick={() => onDialog('ship')}><Truck size={16} /> {toConsumer ? 'Hand over to customer' : o.status === 'partially_shipped' ? 'Ship more' : 'Ship order'}</button>)
  }
  if (isSeller && o.status === 'partially_shipped') btns.push(<button key="c" className="btn" disabled={busy} onClick={() => onDialog('close')}>Close short</button>)
  if (isBuyer && unreceived > 1 && !toConsumer) btns.push(<button key="ra" className="btn primary" disabled={busy} onClick={onReceiveAll}><PackageCheck size={16} /> Receive all shipments</button>)
  if (canReturn) btns.push(<button key="rt" className="btn" disabled={busy} onClick={() => onDialog('return')}><RotateCcw size={16} /> Request return</button>)
  if (o.status === 'pending' || o.status === 'accepted') btns.push(<button key="x" className="btn ghost" disabled={busy} onClick={() => onDialog('cancel')}>Cancel order</button>)
  if (btns.length === 0) return null
  return <div className="row gap wrap action-bar">{btns}</div>
}

function InvoiceCard({ b, isSeller, onPay, onView }: { b: OrderBundle; isSeller: boolean; onPay: () => void; onView: () => void }) {
  const inv = b.invoice!
  const due = outstanding(inv)
  const overdue = due > 0 && new Date(inv.due_date) < new Date(new Date().toDateString())
  const tone = inv.status === 'paid' ? 'good' : inv.status === 'void' ? 'neutral' : overdue ? 'bad' : 'warn'
  return (
    <section className="card">
      <div className="row between wrap"><h2><CreditCard size={18} /> Invoice {inv.invoice_no}</h2><Badge tone={tone}>{overdue ? 'overdue' : inv.status}</Badge></div>
      <dl className="kv">
        <dt>Subtotal</dt><dd>{money(inv.subtotal)}</dd>
        {inv.tax > 0 && <><dt>GST</dt><dd>{money(inv.tax)}</dd></>}
        <dt>Total</dt><dd><b>{money(inv.total)}</b></dd>
        {inv.credit_total > 0 && <><dt>Credit notes</dt><dd>− {money(inv.credit_total)}</dd></>}
        <dt>Paid</dt><dd>{money(inv.paid_total)}</dd>
        <dt>Balance due</dt><dd><b>{money(due)}</b> <span className="muted small">due {fmtDate(inv.due_date)}</span></dd>
      </dl>
      {b.payments.length > 0 && (
        <ul className="plain small">{b.payments.map(p => (
          <li key={p.id} className="row between"><span>{fmtDate(p.paid_at)} · {p.method}{p.reference && ` · ${p.reference}`}</span><b>{money(p.amount)}</b></li>
        ))}</ul>
      )}
      <div className="row gap">
        <button className="btn sm" onClick={onView}><Printer size={14} /> View / print</button>
        {isSeller && due > 0 && inv.status !== 'void' && <button className="btn primary sm" onClick={onPay}><CreditCard size={14} /> Record payment</button>}
      </div>
    </section>
  )
}

function Timeline({ b }: { b: OrderBundle }) {
  return (
    <section className="card">
      <h2>Timeline</h2>
      <ol className="timeline">
        {b.events.map(e => (
          <li key={e.id}>
            <b>{EVENT_LABEL[e.event] ?? e.event}</b>
            {e.note && <div className="muted small">{e.note}</div>}
            <div className="muted small">{fmtDateTime(e.created_at)}</div>
          </li>
        ))}
        {b.events.length === 0 && <li className="muted">No events yet.</li>}
      </ol>
    </section>
  )
}

function Messages({ b, uid, onSent }: { b: OrderBundle; uid: string; onSent: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [b.messages.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try { await api.sendMessage(b.order.id, uid, text.trim()); setText(''); onSent() } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  return (
    <section className="card chat">
      <h2><MessageSquare size={18} /> Messages</h2>
      <div className="chat-log">
        {b.messages.length === 0 && <p className="muted small">Use this thread to coordinate delivery, pricing or issues.</p>}
        {b.messages.map(m => (
          <div key={m.id} className={`bubble ${m.sender_id === uid ? 'me' : ''}`}>{m.body}<small>{timeAgo(m.created_at)}</small></div>
        ))}
        <div ref={end} />
      </div>
      <form className="row gap" onSubmit={send}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a message…" />
        <button className="btn primary" disabled={busy || !text.trim()} aria-label="Send"><Send size={16} /></button>
      </form>
    </section>
  )
}

function PrescriptionLink({ path }: { path: string }) {
  const toast = useToast()
  return (
    <section className="card row between wrap">
      <span className="row gap"><FileUp size={18} /> Prescription attached</span>
      <button className="btn sm" onClick={async () => { try { window.open(await api.prescriptionUrl(path), '_blank', 'noopener') } catch (x) { toast.err(errMsg(x)) } }}>View prescription</button>
    </section>
  )
}

function ShipDialog({ b, onClose, onSubmit }: { b: OrderBundle; onClose: () => void; onSubmit: (q: Record<string, number> | null, eta: string | null, tracking: string) => void }) {
  const toConsumer = b.order.buyer?.role === 'consumer'
  const items = (b.order.order_items ?? []).filter(i => i.quantity > i.shipped_qty)
  const [q, setQ] = useState<Record<string, number>>(() => Object.fromEntries(items.map(i => [i.id, i.quantity - i.shipped_qty])))
  const [eta, setEta] = useState('')
  const [trk, setTrk] = useState('')
  const partial = items.some(i => q[i.id] < i.quantity - i.shipped_qty)
  return (
    <Modal title={toConsumer ? 'Hand over to customer' : 'Dispatch shipment'} onClose={onClose} wide>
      <form className="stack" onSubmit={e => { e.preventDefault(); onSubmit(toConsumer ? null : q, eta || null, trk) }}>
        <p className="muted">Stock is taken automatically from the earliest-expiry reserved batches.{!toConsumer && ' Reduce a quantity to ship in parts.'}</p>
        <div className="table-wrap flat"><table>
          <thead><tr><th>Medicine</th><th className="r">Remaining</th>{!toConsumer && <th className="r">Ship now</th>}</tr></thead>
          <tbody>{items.map(i => (
            <tr key={i.id}><td>{i.medicines.name} <span className="muted">{i.medicines.strength}</span></td><td className="r">{num(i.quantity - i.shipped_qty)}</td>
              {!toConsumer && <td className="r"><input className="inline-num" type="number" min="0" max={i.quantity - i.shipped_qty} value={q[i.id]}
                onChange={e => setQ({ ...q, [i.id]: Math.max(0, Math.min(i.quantity - i.shipped_qty, Number(e.target.value))) })} /></td>}</tr>))}</tbody>
        </table></div>
        {!toConsumer && <div className="grid2">
          <Field label="Expected delivery"><input type="date" value={eta} onChange={e => setEta(e.target.value)} /></Field>
          <Field label="Tracking / transporter note"><input value={trk} onChange={e => setTrk(e.target.value)} placeholder="e.g. Blue Dart AWB 123456" /></Field>
        </div>}
        {partial && <Alert tone="info">Partial shipment — the order stays open until the rest ships or you close it short.</Alert>}
        <div className="row gap end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary"><Truck size={16} /> {toConsumer ? 'Hand over' : 'Dispatch'}</button></div>
      </form>
    </Modal>
  )
}

function InvoiceModal({ b, onClose }: { b: OrderBundle; onClose: () => void }) {
  const [mode, setMode] = useState<'invoice' | 'packing'>('invoice')
  return (
    <Modal title="Invoice" onClose={onClose} wide>
      <div className="row gap no-print">
        <button className={`btn sm ${mode === 'invoice' ? 'primary' : ''}`} onClick={() => setMode('invoice')}>Invoice</button>
        <button className={`btn sm ${mode === 'packing' ? 'primary' : ''}`} onClick={() => setMode('packing')}>Packing slip</button>
        <div className="spacer" />
        <button className="btn primary sm" onClick={() => window.print()}><Printer size={14} /> Print</button>
      </div>
      <InvoiceDoc bundle={b} mode={mode} />
    </Modal>
  )
}

function PayDialog({ b, onClose, onSubmit }: { b: OrderBundle; onClose: () => void; onSubmit: (a: number, m: string, r: string, n: string) => void }) {
  const due = outstanding(b.invoice!)
  const [a, setA] = useState(due)
  const [m, setM] = useState('bank')
  const [r, setR] = useState('')
  const [n, setN] = useState('')
  return (
    <Modal title={`Record payment — ${b.invoice!.invoice_no}`} onClose={onClose}>
      <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(a, m, r, n) }}>
        <p className="muted">Outstanding balance: <b>{money(due)}</b></p>
        <div className="grid2">
          <Field label="Amount received (₹)"><input type="number" step="0.01" min="0.01" max={due} required value={a} onChange={e => setA(Number(e.target.value))} /></Field>
          <Field label="Method"><select value={m} onChange={e => setM(e.target.value)}>{['bank', 'upi', 'cash', 'cheque', 'card'].map(x => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <Field label="Reference (UTR / cheque no.)"><input value={r} onChange={e => setR(e.target.value)} /></Field>
        <Field label="Note"><input value={n} onChange={e => setN(e.target.value)} /></Field>
        <div className="row gap end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Record payment</button></div>
      </form>
    </Modal>
  )
}

function ReturnDialog({ b, onClose, onSubmit }: { b: OrderBundle; onClose: () => void; onSubmit: (items: { batch_id: string; quantity: number }[], reason: string) => void }) {
  // returnable = received quantity per batch minus quantity already in non-rejected returns
  const rec = new Map<string, { batch_no: string; name: string; qty: number }>()
  for (const s of b.shipments.filter(x => x.received_at)) for (const l of s.shipment_lines) {
    const cur = rec.get(l.batch_id)
    rec.set(l.batch_id, { batch_no: l.batches?.batch_no ?? '', name: l.order_items?.medicines.name ?? '', qty: (cur?.qty ?? 0) + l.quantity })
  }
  for (const r of b.returns.filter(x => x.status !== 'rejected')) for (const i of r.return_items) {
    const bid = [...rec.entries()].find(([, v]) => v.batch_no === i.batches?.batch_no)?.[0]
    if (bid) rec.get(bid)!.qty -= i.quantity
  }
  const rows = [...rec.entries()].filter(([, v]) => v.qty > 0)
  const [q, setQ] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('Damaged on arrival')
  const chosen = rows.filter(([id]) => (q[id] ?? 0) > 0).map(([id]) => ({ batch_id: id, quantity: q[id] }))
  return (
    <Modal title="Request a return" onClose={onClose} wide>
      <form className="stack" onSubmit={e => { e.preventDefault(); onSubmit(chosen, reason) }}>
        {rows.length === 0 ? <p className="muted">Nothing left to return on this order.</p> : (
          <div className="table-wrap flat"><table>
            <thead><tr><th>Medicine</th><th>Batch</th><th className="r">Returnable</th><th className="r">Return qty</th></tr></thead>
            <tbody>{rows.map(([id, v]) => (
              <tr key={id}><td>{v.name}</td><td>{v.batch_no}</td><td className="r">{v.qty}</td>
                <td className="r"><input className="inline-num" type="number" min="0" max={v.qty} value={q[id] ?? ''} onChange={e => setQ({ ...q, [id]: Math.min(v.qty, Math.max(0, Number(e.target.value))) })} /></td></tr>))}</tbody>
          </table></div>
        )}
        <Field label="Reason"><select value={reason} onChange={e => setReason(e.target.value)}>
          {['Damaged on arrival', 'Wrong item delivered', 'Near expiry', 'Quality complaint', 'Excess / ordered by mistake'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <p className="muted small">The supplier reviews your request. If approved, the units go back to them and a credit note reduces your invoice.</p>
        <div className="row gap end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={chosen.length === 0}>Submit request</button></div>
      </form>
    </Modal>
  )
}

function ReviewDialog({ b, onClose, onSubmit }: { b: OrderBundle; onClose: () => void; onSubmit: (rating: number, comment: string) => void }) {
  const [r, setR] = useState(b.review?.rating ?? 5)
  const [c, setC] = useState(b.review?.comment ?? '')
  return (
    <Modal title={`Rate ${b.order.seller?.org_name}`} onClose={onClose}>
      <form className="stack" onSubmit={e => { e.preventDefault(); onSubmit(r, c) }}>
        <StarInput value={r} onChange={setR} />
        <Field label="Comment (optional)"><textarea rows={3} maxLength={500} value={c} onChange={e => setC(e.target.value)} /></Field>
        <div className="row gap end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Submit</button></div>
      </form>
    </Modal>
  )
}
