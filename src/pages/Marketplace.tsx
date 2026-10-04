import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bike, FileUp, LocateFixed, MapPin, Minus, Plus, Search, ShoppingCart, Star, Store } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { daysUntil, errMsg, fmtDate, money, num, roleLabel, supplierRole } from '../lib/format'
import { fmtKm, useLocation } from '../lib/geo'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, Empty, ErrorBox, PageHeader, Rating, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (x: number) => (x * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

// Shared by distributors, retailers and (preset seller) customers: pick a supplier, fill a cart, place the order.
export default function Marketplace({ presetSeller }: { presetSeller?: string }) {
  const { profile, session } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const sellerId = presetSeller ?? params.get('seller')
  const loc = useLocation()
  const suppliers = useAsync(() => api.suppliers(loc.coords?.lat, loc.coords?.lng), [loc.coords?.lat, loc.coords?.lng])
  const catalog = useAsync(() => (sellerId ? api.catalog(sellerId) : Promise.resolve([])), [sellerId])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')
  const [sq, setSq] = useState('')
  const [busy, setBusy] = useState(false)
  const [rx, setRx] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const prefilled = useRef(false)
  const consumer = profile!.role === 'consumer'
  const [mode, setMode] = useState<'pickup' | 'delivery'>('pickup')
  const addrs = useAsync(() => (consumer ? api.addresses() : Promise.resolve([])), [consumer])
  const [addrId, setAddrId] = useState<string>('')
  const [custom, setCustom] = useState({ address: '', phone: '', lat: null as number | null, lng: null as number | null })

  // ?prefill=medicineId:qty,... (from Reorder suggestions / "Reorder" button)
  useEffect(() => {
    if (prefilled.current || !catalog.data || catalog.data.length === 0) return
    const pf = params.get('prefill')
    if (!pf) return
    prefilled.current = true
    const next: Record<string, number> = {}
    for (const part of pf.split(',')) {
      const [id, n] = part.split(':')
      const item = catalog.data.find(c => c.medicine_id === id)
      if (item && Number(n) > 0) next[id] = Math.min(item.available, Number(n))
    }
    setCart(next)
  }, [catalog.data, params])

  const seller = suppliers.data?.find(s => s.id === sellerId)
  const items = useMemo(() => (catalog.data ?? []).filter(c => !q || (c.name + c.generic_name + c.category).toLowerCase().includes(q.toLowerCase())), [catalog.data, q])
  const lines = (catalog.data ?? []).filter(c => cart[c.medicine_id] > 0)
  const subtotal = lines.reduce((s, c) => s + c.unit_price * cart[c.medicine_id], 0)
  const tax = consumer ? 0 : lines.reduce((s, c) => s + (c.unit_price * cart[c.medicine_id] * c.gst_rate) / 100, 0)
  const needsRx = consumer && lines.some(c => c.requires_rx)
  const canDeliver = consumer && !!seller?.delivery_enabled
  const delivering = canDeliver && mode === 'delivery'
  const fee = delivering ? (seller!.delivery_free_above != null && subtotal >= Number(seller!.delivery_free_above) ? 0 : Number(seller!.delivery_fee)) : 0
  const saved = addrs.data?.find(a => a.id === addrId) ?? (addrId === '' ? addrs.data?.find(a => a.is_default) ?? addrs.data?.[0] : undefined)
  const dest = addrId === 'new' || !saved ? custom : { address: saved.address, phone: saved.phone, lat: saved.lat, lng: saved.lng }
  const distKm = delivering && seller?.lat != null && seller?.lng != null && dest.lat != null && dest.lng != null ? haversine(seller.lat, seller.lng, dest.lat, dest.lng) : null
  const outOfArea = distKm != null && distKm > Number(seller?.delivery_radius_km ?? 0)
  const belowMin = delivering && lines.length > 0 && subtotal < Number(seller!.delivery_min_order)
  const deliveryBlocked = delivering && (!dest.address.trim() || outOfArea || belowMin)

  const setQty = (id: string, max: number, n: number) => setCart(c => ({ ...c, [id]: Math.min(max, Math.max(0, n)) }))

  async function place() {
    if (!sellerId || lines.length === 0) return
    if (needsRx && !rx) { toast.err('Please attach your prescription'); return }
    if (deliveryBlocked) { toast.err(outOfArea ? 'This address is outside the delivery area' : belowMin ? `Minimum order for delivery is ₹${seller!.delivery_min_order}` : 'Enter a delivery address'); return }
    setBusy(true)
    try {
      const path = needsRx && rx ? await api.uploadPrescription(session!.user.id, rx) : null
      const id = await api.placeOrder(sellerId, lines.map(c => ({ medicine_id: c.medicine_id, quantity: cart[c.medicine_id] })), notes, path,
        delivering ? { address: dest.address.trim(), lat: dest.lat, lng: dest.lng, phone: dest.phone } : null)
      toast.ok('Order placed'); nav(`/orders/${id}`)
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  if (!sellerId) {
    const list = (suppliers.data ?? []).filter(s => !sq || (s.org_name + s.city).toLowerCase().includes(sq.toLowerCase()))
    return (
      <>
        <PageHeader title="Choose a supplier" subtitle={`You can buy from ${supplierRole[profile!.role] ?? 'suppliers'}`}
          actions={<button className="btn" onClick={loc.locate} disabled={loc.busy}><MapPin size={16} /> {loc.coords ? 'Location set' : 'Sort by distance'}</button>} />
        {loc.error && <Alert tone="err">{loc.error}</Alert>}
        <div className="search-box wide"><Search size={16} /><input value={sq} onChange={e => setSq(e.target.value)} placeholder="Search suppliers or city…" /></div>
        {suppliers.loading && !suppliers.data && <Skeleton />}
        {suppliers.error && <ErrorBox message={suppliers.error} onRetry={suppliers.reload} />}
        {suppliers.data && list.length === 0 && <Empty title="No suppliers available yet" hint="They appear here once they sign up and hold stock." />}
        <div className="cards">
          {list.map(s => (
            <button key={s.id} className="card tile left" onClick={() => setParams({ seller: s.id })}>
              <div className="row between"><h3>{s.org_name || s.full_name}</h3>{s.verified && <Badge tone="good">verified</Badge>}</div>
              <p className="muted">{roleLabel[s.role]} · {s.city || '—'}{s.distance_km != null && <> · <b>{fmtKm(s.distance_km)}</b></>}</p>
              <div className="row between"><span><b>{s.medicines_in_stock}</b> medicines in stock</span><Rating value={s.rating_avg} count={s.rating_count} /></div>
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        back={!presetSeller && <button className="back-link" onClick={() => { setParams({}); setCart({}) }}><ArrowLeft size={14} /> All suppliers</button>}
        title={seller ? (seller.org_name || seller.full_name) : 'Catalog'}
        subtitle={seller && <>{roleLabel[seller.role]} · {seller.city} <Rating value={seller.rating_avg} count={seller.rating_count} /> <Link to={`/pharmacy/${seller.id}`}>View profile</Link></>} />
      {catalog.loading && !catalog.data && <Skeleton />}
      {catalog.error && <ErrorBox message={catalog.error} onRetry={catalog.reload} />}
      {catalog.data?.length === 0 && <Empty title="This supplier has nothing in stock right now" />}
      {(catalog.data?.length ?? 0) > 0 && (
        <div className="grid-2-1 top">
          <div>
            <div className="search-box wide"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search medicines…" /></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Medicine</th><th className="r">Price</th><th className="r">Available</th><th>Expiry</th><th className="r">Qty</th></tr></thead>
              <tbody>{items.map(c => {
                const n = cart[c.medicine_id] ?? 0
                return (
                  <tr key={c.medicine_id}>
                    <td><b>{c.name}</b> <span className="muted">{c.strength} · {c.dosage_form} · {c.pack_size}</span>
                      {c.requires_rx && <> <Badge tone="info">Rx</Badge></>}
                      {!consumer && <div className="muted small">GST {c.gst_rate}% extra</div>}</td>
                    <td className="r">{money(c.unit_price)}<div className="muted small">MRP {money(c.mrp)}</div></td>
                    <td className="r">{num(c.available)}</td>
                    <td>{fmtDate(c.nearest_expiry)} {daysUntil(c.nearest_expiry) <= 90 && <Badge tone="warn">short</Badge>}</td>
                    <td className="r">
                      <div className="stepper">
                        <button className="icon-btn" onClick={() => setQty(c.medicine_id, c.available, n - 1)} disabled={n <= 0} aria-label="Decrease"><Minus size={14} /></button>
                        <input type="number" min="0" max={c.available} value={n || ''} placeholder="0" onChange={e => setQty(c.medicine_id, c.available, Number(e.target.value))} />
                        <button className="icon-btn" onClick={() => setQty(c.medicine_id, c.available, n + 1)} disabled={n >= c.available} aria-label="Increase"><Plus size={14} /></button>
                      </div>
                    </td>
                  </tr>)
              })}</tbody>
            </table></div>
          </div>
          <aside className="card sticky">
            <h2><ShoppingCart size={18} /> Your order</h2>
            {lines.length === 0 && <p className="muted">Add quantities to build an order.</p>}
            <ul className="plain">{lines.map(c => (
              <li key={c.medicine_id} className="row between"><span>{c.name} × {cart[c.medicine_id]}</span><b>{money(c.unit_price * cart[c.medicine_id])}</b></li>
            ))}</ul>
            {lines.length > 0 && <>
              <div className="cart-totals">
                <div className="row between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
                {!consumer && <div className="row between muted"><span>GST (est.)</span><span>{money(tax)}</span></div>}
                {delivering && <div className="row between muted"><span>Delivery fee</span><span>{fee > 0 ? money(fee) : 'Free'}</span></div>}
                <div className="row between total"><span>Total</span><b>{money(subtotal + tax + fee)}</b></div>
              </div>
              {consumer && (
                <div className="stack">
                  <div className="fulfil">
                    <button type="button" className={mode === 'pickup' ? 'sel' : ''} onClick={() => setMode('pickup')}><b><Store size={14} /> Pick up</b><small>Collect from the pharmacy</small></button>
                    <button type="button" className={mode === 'delivery' ? 'sel' : ''} disabled={!canDeliver} onClick={() => setMode('delivery')}><b><Bike size={14} /> Home delivery</b>
                      <small>{canDeliver ? `${Number(seller!.delivery_fee) > 0 ? '₹' + seller!.delivery_fee : 'Free'} · within ${seller!.delivery_radius_km} km` : 'Not offered here'}</small></button>
                  </div>
                  {delivering && (
                    <div className="stack">
                      {(addrs.data ?? []).map(a => (
                        <label key={a.id} className={`addr ${(saved?.id === a.id && addrId !== 'new') ? 'sel' : ''}`}><input type="radio" name="addr" checked={saved?.id === a.id && addrId !== 'new'} onChange={() => setAddrId(a.id)} />
                          <span><b>{a.label}</b><div className="muted small">{a.address}</div></span></label>
                      ))}
                      <label className={`addr ${addrId === 'new' || !saved ? 'sel' : ''}`}><input type="radio" name="addr" checked={addrId === 'new' || !saved} onChange={() => setAddrId('new')} /><span><b>Deliver somewhere else</b></span></label>
                      {(addrId === 'new' || !saved) && (
                        <div className="stack">
                          <textarea rows={2} placeholder="Full delivery address" value={custom.address} onChange={e => setCustom({ ...custom, address: e.target.value })} />
                          <input placeholder="Phone for the delivery person" value={custom.phone} onChange={e => setCustom({ ...custom, phone: e.target.value })} />
                          <button type="button" className="btn sm" onClick={() => navigator.geolocation?.getCurrentPosition(g => setCustom(c => ({ ...c, lat: g.coords.latitude, lng: g.coords.longitude })), () => toast.err('Could not get your location'), { timeout: 10000 })}>
                            <LocateFixed size={14} /> {custom.lat != null ? 'Location pinned ✓' : 'Pin my current location'}</button>
                        </div>
                      )}
                      {distKm != null && !outOfArea && <div className="muted small"><MapPin size={12} /> {distKm.toFixed(1)} km from the pharmacy</div>}
                      {outOfArea && <Alert tone="err">This address is {distKm!.toFixed(1)} km away — outside the {seller!.delivery_radius_km} km delivery area.</Alert>}
                      {belowMin && <Alert tone="warn">Add ₹{(Number(seller!.delivery_min_order) - subtotal).toFixed(0)} more to qualify for delivery (minimum ₹{seller!.delivery_min_order}).</Alert>}
                    </div>
                  )}
                </div>
              )}
              {needsRx && (
                <div className="rx-box">
                  <div className="row gap"><Star size={14} /> <b>Prescription required</b></div>
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={e => setRx(e.target.files?.[0] ?? null)} />
                  <button className="btn sm" onClick={() => fileRef.current?.click()}><FileUp size={14} /> {rx ? rx.name : 'Attach prescription'}</button>
                </div>
              )}
              <textarea rows={2} placeholder={consumer ? 'Pickup time or notes (optional)' : 'Notes for the seller (optional)'} value={notes} onChange={e => setNotes(e.target.value)} />
              <button className="btn primary block lg" disabled={busy || deliveryBlocked} onClick={place}>{busy ? 'Placing…' : consumer ? (delivering ? 'Order for delivery' : 'Reserve now') : 'Place order'}</button>
            </>}
          </aside>
        </div>
      )}
    </>
  )
}
