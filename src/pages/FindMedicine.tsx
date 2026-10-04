import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, Search, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import { errMsg, money, num } from '../lib/format'
import { fmtKm, useLocation } from '../lib/geo'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, Empty, ErrorBox, Modal, PageHeader, Rating, Skeleton } from '../components/ui'
import type { AvailabilityRow } from '../lib/types'

// Consumer: search a medicine -> pharmacies that stock it (nearest first) -> reserve from one
export default function FindMedicine() {
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useState('')
  const [last, setLast] = useState('')
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [alt, setAlt] = useState<AvailabilityRow | null>(null)
  const [sort, setSort] = useState<'distance' | 'price'>('distance')

  async function search(e?: FormEvent, query = q) {
    e?.preventDefault()
    if (query.trim().length < 2) return
    setLoading(true); setErr(''); setLast(query.trim())
    try { setRows(await api.searchAvailability(query.trim(), loc.coords?.lat, loc.coords?.lng)) } catch (x) { setErr(errMsg(x)) } finally { setLoading(false) }
  }

  const sorted = [...(rows ?? [])].sort((a, b) =>
    sort === 'price' ? a.unit_price - b.unit_price : (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.unit_price - b.unit_price)

  return (
    <>
      <PageHeader title="Find a medicine" subtitle="Search by brand or generic name to see pharmacies with stock"
        actions={<button className="btn" onClick={() => { loc.locate() }} disabled={loc.busy}><MapPin size={16} /> {loc.coords ? 'Using your location' : 'Use my location'}</button>} />
      {loc.error && <Alert tone="err">{loc.error}</Alert>}
      <form className="row gap" onSubmit={search}>
        <div className="search-box wide grow"><Search size={16} /><input placeholder="e.g. Paracetamol, Azithromycin…" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
        <button className="btn primary" disabled={loading}>Search</button>
      </form>
      {loading && <Skeleton rows={4} />}
      {err && <ErrorBox message={err} />}
      {rows && rows.length === 0 && <Empty title={`No pharmacy has “${last}” in stock`} hint="Try the generic name, or check again later." />}
      {rows && rows.length > 0 && (
        <>
          <div className="row between wrap">
            <span className="muted">{rows.length} result(s) for “{last}”{!loc.coords && ' · enable location to sort by distance'}</span>
            <select value={sort} onChange={e => setSort(e.target.value as 'distance' | 'price')}><option value="distance">Nearest first</option><option value="price">Lowest price</option></select>
          </div>
          <div className="cards">
            {sorted.map(r => (
              <div key={r.seller_id + r.medicine_id} className="card result">
                <div className="row between"><div><b>{r.medicine}</b> <span className="muted">{r.strength} · {r.dosage_form}</span></div>
                  <div className="price">{money(r.unit_price)}</div></div>
                {r.requires_rx && <Badge tone="info">Prescription required</Badge>}
                <div className="row between"><Link to={`/pharmacy/${r.seller_id}`}><b>{r.org_name}</b></Link>{r.verified && <Badge tone="good">verified</Badge>}</div>
                <div className="muted small">{r.city}{r.address && ` · ${r.address}`}{r.distance_km != null && <> · <b>{fmtKm(r.distance_km)} away</b></>}</div>
                <div className="row between"><Rating value={r.rating_avg} count={r.rating_count} /><span className="muted small">{num(r.available)} in stock</span></div>
                <div className="row gap">
                  <button className="btn primary grow" onClick={() => nav(`/orders/new/${r.seller_id}?prefill=${r.medicine_id}:1`)}>Reserve</button>
                  {r.generic_name && <button className="btn" onClick={() => setAlt(r)}><Sparkles size={14} /> Alternatives</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {alt && <AlternativesModal row={alt} onClose={() => setAlt(null)} onPick={name => { setAlt(null); setQ(name); void search(undefined, name) }} />}
    </>
  )
}

function AlternativesModal({ row, onClose, onPick }: { row: AvailabilityRow; onClose: () => void; onPick: (name: string) => void }) {
  const { data, error, loading } = useAsync(() => api.alternatives(row.medicine_id), [row.medicine_id])
  return (
    <Modal title={`Same salt as ${row.medicine}`} onClose={onClose}>
      <p className="muted">Other brands with the same generic ingredient (<b>{row.generic_name}</b>) that are in stock. Ask your pharmacist if a switch is suitable.</p>
      {loading && <Skeleton rows={3} />}
      {error && <ErrorBox message={error} />}
      {data && data.length === 0 && <p>No in-stock alternatives right now.</p>}
      <ul className="plain">{data?.map(a => (
        <li key={a.medicine_id} className="row between">
          <span><b>{a.name}</b> <span className="muted">{a.strength} · {a.pack_size}</span><div className="muted small">{a.sellers} pharmacy(ies) · MRP {money(a.mrp)}</div></span>
          <button className="btn sm" onClick={() => onPick(a.name)}>Find</button>
        </li>
      ))}</ul>
    </Modal>
  )
}
