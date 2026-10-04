import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CheckCircle2, Minus, Pause, Play, Plus, Printer, ScanLine, Search, Trash2, UserRound } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { daysUntil, errMsg, fmtDate, fmtDateTime, money, num, timeAgo } from '../lib/format'
import { printDoc } from '../lib/print'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, Empty, ErrorBox, Modal, PageHeader, Skeleton } from '../components/ui'
import BarcodeScanner from '../components/BarcodeScanner'
import ReceiptDoc from '../components/ReceiptDoc'
import { useToast } from '../components/Toast'
import type { HeldBill, SaleBill } from '../lib/types'

interface Product { schedule: string; medicine_id: string; name: string; strength: string; pack_size: string; barcode: string; mrp: number; price: number; available: number; nearest: string; rx: boolean }
type Mode = 'cash' | 'upi' | 'card' | 'credit'
const NO_RX = { patient: '', doctor: '', doctorReg: '', rxNo: '' }

export default function POS() {
  const { profile } = useAuth()
  const uid = profile!.id
  const toast = useToast()
  const inv = useAsync(() => api.inventory(uid), [uid])
  const lst = useAsync(() => api.listings(uid), [uid])
  const customers = useAsync(() => api.customers(), [])
  const balances = useAsync(() => api.customerBalances().catch(() => []), [])
  const held = useAsync(() => api.heldBills(), [])
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [discount, setDiscount] = useState(0)
  const [mode, setMode] = useState<Mode>('cash')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<SaleBill | null>(null)
  const [rxF, setRxF] = useState(NO_RX)
  const [scanning, setScanning] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const search = useRef<HTMLInputElement>(null)

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

  const priceOf = (p: Product) => prices[p.medicine_id] ?? p.price
  const shown = products.filter(p => !q || `${p.name} ${p.strength} ${p.barcode}`.toLowerCase().includes(q.toLowerCase()))
  const lines = products.filter(p => cart[p.medicine_id] > 0)
  const subtotal = lines.reduce((s, p) => s + priceOf(p) * cart[p.medicine_id], 0)
  const total = Math.max(0, subtotal - discount)
  const needsRx = lines.some(p => p.schedule === 'H' || p.schedule === 'H1')
  const hasH1 = lines.some(p => p.schedule === 'H1')
  const known = customers.data?.find(c => c.phone === phone.trim())
  const owed = Number(balances.data?.find(b => b.customer_id === known?.id)?.balance ?? 0)
  const creditBlocked = mode === 'credit' && phone.trim().length < 6
  const canCharge = lines.length > 0 && !busy && !(needsRx && !rxF.doctor.trim()) && !creditBlocked

  const setQty = useCallback((p: Product, n: number) => setCart(c => ({ ...c, [p.medicine_id]: Math.min(p.available, Math.max(0, n)) })), [])

  function addByCode(code: string): 'ok' | 'miss' {
    const c = code.trim()
    const hit = products.find(p => p.barcode && p.barcode === c)
    if (!hit) return 'miss'
    setCart(cur => ({ ...cur, [hit.medicine_id]: Math.min(hit.available, (cur[hit.medicine_id] ?? 0) + 1) }))
    return 'ok'
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !q.trim()) return
    const exact = products.find(p => p.barcode && p.barcode === q.trim())
    const target = exact ?? (shown.length === 1 ? shown[0] : undefined)
    if (target) { setQty(target, (cart[target.medicine_id] ?? 0) + 1); setQ('') }
  }

  const reset = () => { setCart({}); setPrices({}); setName(''); setPhone(''); setDiscount(0); setMode('cash'); setRxF(NO_RX) }

  async function charge() {
    if (!canCharge) return
    setBusy(true)
    try {
      const id = await api.createBill(lines.map(p => ({ medicine_id: p.medicine_id, quantity: cart[p.medicine_id], unit_price: priceOf(p) })), name, phone, discount, mode, needsRx ? { ...rxF, patient: rxF.patient || name } : {})
      const bill = await api.bill(id)
      setDone(bill); reset()
      inv.reload(); customers.reload(); balances.reload()
      toast.ok(`Bill ${bill.bill_no} created`)
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  async function hold() {
    if (lines.length === 0) return
    try {
      await api.holdBill(uid, name || phone || `${lines.length} item(s)`, { cart, prices, name, phone, discount, mode, rx: rxF })
      reset(); held.reload(); toast.ok('Bill put on hold')
    } catch (x) { toast.err(errMsg(x)) }
  }

  async function resume(h: HeldBill) {
    if (lines.length > 0 && !confirm('Replace the current bill with the held one?')) return
    const d = h.payload
    // drop anything no longer sellable
    const ok: Record<string, number> = {}
    for (const [id, n] of Object.entries(d.cart)) { const p = products.find(x => x.medicine_id === id); if (p) ok[id] = Math.min(n, p.available) }
    const dropped = Object.keys(d.cart).length - Object.keys(ok).length
    setCart(ok); setPrices(d.prices ?? {}); setName(d.name); setPhone(d.phone); setDiscount(d.discount); setMode(d.mode); setRxF(d.rx ?? NO_RX)
    await api.deleteHeldBill(h.id); held.reload(); setShowHeld(false)
    toast.ok(dropped ? `Resumed — ${dropped} item(s) are no longer in stock and were removed` : 'Bill resumed')
  }

  // keyboard shortcuts: F2 search · F4 hold · F9 charge
  const shortcuts = useRef({ charge, hold })
  shortcuts.current = { charge, hold }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); search.current?.focus() }
      else if (e.key === 'F4') { e.preventDefault(); void shortcuts.current.hold() }
      else if (e.key === 'F9') { e.preventDefault(); void shortcuts.current.charge() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const heldCount = held.data?.length ?? 0

  return (
    <>
      <PageHeader title="Point of sale" subtitle="Scan or search, add to the bill, charge. Batches are picked earliest-expiry first."
        actions={<>
          <span className="muted small no-print">F2 search · F4 hold · F9 charge</span>
          <button className="btn" onClick={() => setShowHeld(true)}><Play size={16} /> Held bills{heldCount > 0 && <span className="count warn">{heldCount}</span>}</button>
        </>} />
      {(inv.loading || lst.loading) && !inv.data && <Skeleton />}
      {inv.error && <ErrorBox message={inv.error} onRetry={inv.reload} />}
      {inv.data && products.length === 0 && <Empty title="Nothing sellable in stock" hint="Expired, recalled and reserved stock is excluded." />}
      {products.length > 0 && (
        <div className="pos">
          <div>
            <div className="row gap">
              <div className="search-box wide grow"><ScanLine size={16} /><input ref={search} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Search medicine or type/scan a barcode, press Enter to add…" /></div>
              <button className="btn" onClick={() => setScanning(true)} aria-label="Scan with camera"><Camera size={16} /> Scan</button>
            </div>
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
            {lines.length === 0 && <p className="muted">Tap a product or scan a barcode to add it.</p>}
            <ul className="plain">{lines.map(p => {
              const pr = priceOf(p)
              return (
                <li key={p.medicine_id} className="bill-line">
                  <div><b>{p.name}</b>
                    <div className="small row gap"><input className="inline-num" style={{ width: 74 }} type="number" step="0.01" min="0" max={p.mrp} value={pr}
                      onChange={e => setPrices(x => ({ ...x, [p.medicine_id]: Math.min(p.mrp, Math.max(0, Number(e.target.value))) }))} aria-label={`Price for ${p.name}`} />
                      {pr < p.mrp && <span className="muted">MRP {money(p.mrp)} · {Math.round((1 - pr / p.mrp) * 100)}% off</span>}</div></div>
                  <div className="stepper">
                    <button className="icon-btn" onClick={() => setQty(p, cart[p.medicine_id] - 1)} aria-label="Decrease"><Minus size={14} /></button>
                    <input type="number" min="0" max={p.available} value={cart[p.medicine_id]} onChange={e => setQty(p, Number(e.target.value))} />
                    <button className="icon-btn" onClick={() => setQty(p, cart[p.medicine_id] + 1)} aria-label="Increase"><Plus size={14} /></button>
                  </div>
                  <b>{money(pr * cart[p.medicine_id])}</b>
                  <button className="icon-btn" onClick={() => setQty(p, 0)} aria-label="Remove"><Trash2 size={15} /></button>
                </li>)
            })}</ul>
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
            {known && <div className="muted small">Returning customer: {known.name}{owed > 0 && <> · <span className="balance-chip owes">owes {money(owed)}</span></>}</div>}
            <div className="grid2 tight">
              <label className="field"><span>Discount (₹)</span><input type="number" min="0" max={subtotal} value={discount || ''} placeholder="0" onChange={e => setDiscount(Math.min(subtotal, Math.max(0, Number(e.target.value))))} /></label>
              <label className="field"><span>Payment</span><select value={mode} onChange={e => setMode(e.target.value as Mode)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="credit">On credit (udhaar)</option></select></label>
            </div>
            {creditBlocked && <Alert tone="warn">Enter the customer's phone number — credit sales are tracked against it.</Alert>}
            {mode === 'credit' && !creditBlocked && owed > 0 && <Alert tone="info">This customer already owes {money(owed)}. New balance after this bill: <b>{money(owed + total)}</b>.</Alert>}
            <div className="cart-totals">
              <div className="row between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {discount > 0 && <div className="row between muted"><span>Discount</span><span>− {money(discount)}</span></div>}
              <div className="row between total"><span>Total</span><b>{money(total)}</b></div>
            </div>
            <div className="row gap">
              <button className="btn" disabled={lines.length === 0} onClick={hold}><Pause size={16} /> Hold <kbd className="hint">F4</kbd></button>
              <button className="btn primary grow lg" disabled={!canCharge} onClick={charge}>{busy ? 'Processing…' : mode === 'credit' ? `Add ${money(total)} to credit` : `Charge ${money(total)}`} <kbd className="hint">F9</kbd></button>
            </div>
          </aside>
        </div>
      )}

      {scanning && <BarcodeScanner onClose={() => setScanning(false)} onScan={code => { const r = addByCode(code); if (r === 'miss') toast.err(`No sellable item with barcode ${code}`); return r }} />}

      {showHeld && (
        <Modal title="Held bills" onClose={() => setShowHeld(false)}>
          {held.data?.length === 0 && <p className="muted">Nothing on hold. Use <b>Hold</b> to park a bill while you serve someone else.</p>}
          <ul className="plain">{held.data?.map(h => (
            <li key={h.id} className="row between wrap">
              <span><b>{h.label}</b><div className="muted small">{Object.keys(h.payload.cart).length} item(s) · {timeAgo(h.created_at)} · {fmtDateTime(h.created_at)}</div></span>
              <span className="row gap"><button className="btn primary sm" onClick={() => resume(h)}><Play size={14} /> Resume</button>
                <button className="icon-btn" aria-label="Discard held bill" onClick={async () => { await api.deleteHeldBill(h.id); held.reload() }}><Trash2 size={15} /></button></span>
            </li>))}</ul>
        </Modal>
      )}

      {done && (
        <Modal title="Bill created" onClose={() => setDone(null)}>
          <div className="row gap success-row"><CheckCircle2 color="var(--good)" /> <b>{done.bill_no}</b> · {money(done.total)} · {done.payment_mode}</div>
          <ReceiptDoc bill={done} shop={profile!} />
          <div className="row gap end no-print">
            <button className="btn ghost" onClick={() => setDone(null)}>New sale</button>
            <button className="btn" onClick={() => printDoc('a4')}><Printer size={16} /> Print A4</button>
            <button className="btn primary" onClick={() => printDoc('thermal')}><Printer size={16} /> Thermal receipt</button>
          </div>
        </Modal>
      )}
    </>
  )
}
