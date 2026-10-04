import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Heart, MapPin, Phone, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, fmtDate, roleLabel } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Avatar, Badge, Empty, ErrorBox, Rating, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'

export default function PharmacyPage() {
  const { id } = useParams()
  const { profile, session } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const { data: p, error, loading, reload } = useAsync(() => api.pharmacy(id!), [id])
  if (loading && !p) return <Skeleton rows={6} />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!p) return <Empty title="Profile not found" />
  const consumer = profile!.role === 'consumer'
  const mapUrl = p.lat != null && p.lng != null ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}` : null

  return (
    <>
      <button className="back-link" onClick={() => nav(-1)}><ArrowLeft size={14} /> Back</button>
      <section className="card profile-head">
        <Avatar name={p.org_name} size={64} />
        <div className="grow">
          <div className="row gap wrap"><h1>{p.org_name}</h1>{p.verified && <Badge tone="good"><ShieldCheck size={12} /> verified</Badge>}</div>
          <p className="muted">{roleLabel[p.role]}</p>
          <Rating value={p.rating_avg} count={p.rating_count} />
          <div className="row gap wrap muted small meta-row">
            <span><MapPin size={14} /> {[p.address, p.city].filter(Boolean).join(', ') || '—'}</span>
            {p.phone && <span><Phone size={14} /> {p.phone}</span>}
            {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Open map</a>}
          </div>
        </div>
        <div className="stack">
          {consumer && p.role === 'retailer' && <>
            <button className="btn primary" onClick={() => nav(`/orders/new/${p.id}`)}>Browse &amp; reserve</button>
            <button className="btn" onClick={async () => { try { await api.setFavorite(session!.user.id, p.id, !p.is_favorite); reload() } catch (x) { toast.err(errMsg(x)) } }}>
              <Heart size={16} fill={p.is_favorite ? 'currentColor' : 'none'} /> {p.is_favorite ? 'Saved' : 'Save pharmacy'}</button>
          </>}
          {!consumer && (profile!.role === 'retailer' || profile!.role === 'distributor') && p.role !== 'retailer' &&
            <button className="btn primary" onClick={() => nav(`/marketplace?seller=${p.id}`)}>Buy from them</button>}
        </div>
      </section>
      {p.about && <section className="card"><h2>About</h2><p>{p.about}</p></section>}
      <section className="card"><h2>{p.medicines_in_stock} medicines in stock</h2></section>
      <section className="card">
        <h2>Reviews</h2>
        {p.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
        <ul className="plain">{p.reviews.map((r, i) => (
          <li key={i}><div className="row between"><Rating value={r.rating} /><span className="muted small">{r.who} · {fmtDate(r.at)}</span></div>{r.comment && <p>{r.comment}</p>}</li>
        ))}</ul>
      </section>
    </>
  )
}
