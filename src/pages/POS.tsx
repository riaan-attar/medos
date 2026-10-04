import { useMemo, useState } from 'react'
import { CheckCircle2, Minus, Plus, Printer, ScanLine, Search, Trash2, UserRound } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { daysUntil, errMsg, fmtDate, money, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, Empty, ErrorBox, Modal, PageHeader, Skeleton } from '../components/ui'
import ReceiptDoc from '../components/ReceiptDoc'
import { useToast } from '../components/Toast'
import type { SaleBill } from '../lib/types'

interface Product { schedule: string; medicine_id: string; name: string; strength: string; pack_size: string; barcode: string; mrp: number; price: number; available: number; nearest: string; rx: boolean }

export default function POS() {
  const { profile } = useAuth()
  const uid = profile!.id
  const toast = useToast()
  const inv = useAsync(() => api.inventory(uid), [uid])
  const lst = useAsync(() => api.listings(uid), [uid])
  const customers = useAsync(() => api.customers(), [])
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [discount, setDiscount] = useState(0)
  const [mode, setMode] = useState<'cash' | 'upi' | 'card' | 'credit'>('cash')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<SaleBill | null>(null)
  const [rxF, setRxF] = useState({ patient: '', doctor: '', doctorReg: '', rxNo: '' })

  const products = useMemo<Product[]>(() => {
    const m = new Map<string, Product>()
    for (const r of inv.data ?? []) {
      const b = r.batches
      if (b.status !== 'active' || daysUntil(b.expiry_date) < 0) continue
      const free = r.quantity - r.reserved
      if (free <= 0) continue
      const med = b.medicines
      const price = lst.data?.find(l => l.medicine_id === med.id)?.unit_price ?? med.mrp
      const cur = m.get(med.id)
      if (cur) { cur.available += free; if (b.expiry_date < cur.nearest) cur.nearest = b.expiry_date }
      else m.set(med.id, { medicine_id: med.id, name: med.name, strength: med.strength, pack_size: med.pack_size, barcode: med.barcode, mrp: med.mrp, price: Number(price), available: free, nearest: b.expiry_date, rx: med.requires_rx, schedule: med.drug_schedule })
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [inv.data, lst.data])

  const shown = products.filter(p => !q || `${p.name} ${p.strength} ${p.barcode}`.toLowerCase().includes(q.toLowerCase()))
  const lines = products.filter(p => cart[p.medicine_id] > 0)
  const subtotal = lines.reduce((s, p) => s + p.price * cart[p.medicine_id], 0)
  const total = Math.max(0, subtotal - discount)
  const needsRx = lines.some(p => p.schedule === 'H' || p.schedule === 'H1')
  const hasH1 = lines.some(p => p.schedule === 'H1')
  const known = customers.data?.find(c => c.phone === phone.trim())

  const setQty = (p: Product, n: number) => setCart(c => ({ ...c, [p.medicine_id]: Math.min(p.available, Math.max(0, n)) }))

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !q.trim()) return
    const exact = products.find(p => p.barcode && p.barcode === q.trim())
    const target = exact ?? (shown.length === 1 ? shown[0] : undefined)
    if (target) { setQty(target, (cart[target.medicine_id] ?? 0) + 1); setQ('') }
  }

  async function charge() {
    setBusy(true)
    try {
      const id = await api.createBill(lines.map(p => ({ medicine_id: p.medicine_id, quantity: cart[p.medicine_id], unit_price: p.price })), name, phone, discount, mode, needsRx ? { ...rxF, patient: rxF.patient || name } : {})
      const bill = await api.bill(id)
      setDone(bill); setCart({}); setName(''); setPhone(''); setDiscount(0); setRxF({ patient: '', doctor: '', doctorReg: '', rxNo: '' })
      inv.reload(); customers.reload()
      toast.ok(`Bill ${bill.bill_no} created`)
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="Point of sale" subtitle="Scan or search, add to the bill, charge. Batches are picked earliest-expiry first." />
      {(inv.loading || lst.loading) && !inv.data && <Skeleton />}
      {inv.error && <ErrorBox message={inv.error} onRetry={inv.reload} />}
      {inv.data && products.length === 0 && <Empty title="Nothing sellable in stock" hint="Expired, recalled and reserved stock is excluded." />}
      {products.length > 0 && (
        <div className="pos">
          <div>
            <div className="search-box wide"><ScanLine size={16} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Search medicine or scan barcode, press Enter to add…" /></div>
            <div className="product-grid">
              {shown.map(p => {
                const n = cart[p.medicine_id] ?? 0
                const short = daysUntil(p.nearest) <= 90
                return (
                  <button key={p.medicine_id} className={`product ${n > 0 ? 'in' : ''}`} onClick={() => setQty(p, n + 1)}>
                    <b>{p.name}</b>
                    <span className="muted small">{p.strength} · {p.pack_size}</span>
                    <div className="row between"><span className="price">{money(p.price)}</span><span className="muted small">{num(p.available)} left</span></div>
                    <div className="row gap wrap">{p.schedule !== 'OTC' && <Badge tone={p.schedule === 'H1' ? 'warn' : 'info'}>{p.schedule}</Badge>}{short && <Badge tone="warn">exp {fmtDate(p.nearest)}</Badge>}{n > 0 && <Badge tone="good">× {n}</Badge>}</div>
                  </button>)
              })}
              {shown.length === 0 && <div className="muted"><Search size={16} /> No match</div>}
            </div>
          </div>

          <aside className="card sticky bill">
            <h2>Current bill</h2>
            {lines.length === 0 && <p className="muted">Tap a product to add it.</p>}
            <ul className="plain">{lines.map(p => (
              <li key={p.medicine_id} className="bill-line">
                <div><b>{p.name}</b><div className="muted small">{money(p.price)} each</div></div>
                <div className="stepper">
                  <button className="icon-btn" onClick={() => setQty(p, cart[p.medicine_id] - 1)} aria-label="Decrease"><Minus size={14} /></button>
                  <input type="number" min="0" max={p.available} value={cart[p.medicine_id]} onChange={e => setQty(p, Number(e.target.value))} />
                  <button className="icon-btn" onClick={() => setQty(p, cart[p.medicine_id] + 1)} aria-label="Increase"><Plus size={14} /></button>
                </div>
                <b>{money(p.price * cart[p.medicine_id])}</b>
                <button className="icon-btn" onClick={() => setQty(p, 0)} aria-label="Remove"><Trash2 size={15} /></button>
              </li>))}</ul>
            {needsRx && (
              <div className="rx-box">
                <b>{hasH1 ? 'Schedule H1 — recorded in the H1 register' : 'Prescription required (Schedule H)'}</b>
                <div className="grid2 tight" style={{ width: '100%' }}>
                  <input placeholder={hasH1 ? 'Patient name *' : 'Patient name'} value={rxF.patient} onChange={e => setRxF({ ...rxF, patient: e.target.value })} />
                  <input placeholder="Doctor name *" value={rxF.doctor} onChange={e => setRxF({ ...rxF, doctor: e.target.value })} />
                  <input placeholder="Doctor reg. no." value={rxF.doctorReg} onChange={e => setRxF({ ...rxF, doctorReg: e.target.value })} />
                  <input placeholder="Prescription no." value={rxF.rxNo} onChange={e => setRxF({ ...rxF, rxNo: e.target.value })} />
                </div>
              </div>
            )}
            <div className="grid2 tight">
              <div className="search-box"><UserRound size={16} /><input value={name} onChange={e => setName(e.target.value)} placeholder="Customer name" /></div>
              <div className="search-box"><input list="cust" value={phone} onChange={e => { setPhone(e.target.value); const c = customers.data?.find(x => x.phone === e.target.value.trim()); if (c && !name) setName(c.name) }} placeholder="Phone" />
                <datalist id="cust">{customers.data?.map(c => <option key={c.id} value={c.phone}>{c.name}</option>)}</datalist></div>
            </div>
            {known && <div className="muted small">Returning customer: {known.name}</div>}
            <div className="grid2 tight">
              <label className="field"><span>Discount (₹)</span><input type="number" min="0" max={subtotal} value={discount || ''} placeholder="0" onChange={e => setDiscount(Math.min(subtotal, Math.max(0, Number(e.target.value))))} /></label>
              <label className="field"><span>Payment</span><select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="credit">On credit</option></select></label>
            </div>
            <div className="cart-totals">
              <div className="row between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {discount > 0 && <div className="row between muted"><span>Discount</span><span>− {money(discount)}</span></div>}
              <div className="row between total"><span>Total</span><b>{money(total)}</b></div>
            </div>
            <button className="btn primary block lg" disabled={busy || lines.length === 0 || (needsRx && !rxF.doctor.trim())} onClick={charge}>{busy ? 'Processing…' : `Charge ${money(total)}`}</button>
          </aside>
        </div>
      )}

      {done && (
        <Modal title="Bill created" onClose={() => setDone(null)}>
          <div className="row gap success-row"><CheckCircle2 color="var(--good)" /> <b>{done.bill_no}</b> · {money(done.total)} · {done.payment_mode}</div>
          <ReceiptDoc bill={done} shop={profile!} />
          <div className="row gap end no-print"><button className="btn ghost" onClick={() => setDone(null)}>New sale</button><button className="btn primary" onClick={() => window.print()}><Printer size={16} /> Print receipt</button></div>
        </Modal>
      )}
    </>
  )
}
