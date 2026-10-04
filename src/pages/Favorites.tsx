import { useNavigate } from 'react-router-dom'
import { Heart } from 'lucide-react'
import { api } from '../lib/api'
import { useLocation, fmtKm } from '../lib/geo'
import { useAsync } from '../lib/useAsync'
import { Badge, Empty, ErrorBox, PageHeader, Rating, Skeleton } from '../components/ui'

export default function Favorites() {
  const nav = useNavigate()
  const loc = useLocation()
  const { data, error, loading, reload } = useAsync(() => api.suppliers(loc.coords?.lat, loc.coords?.lng), [loc.coords?.lat, loc.coords?.lng])
  const favs = (data ?? []).filter(s => s.is_favorite)
  return (
    <>
      <PageHeader title="Saved pharmacies" subtitle="Your go-to pharmacies, one tap away" />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && favs.length === 0 && <Empty icon={<Heart size={26} />} title="No saved pharmacies yet" hint="Open a pharmacy profile and tap “Save pharmacy”." />}
      <div className="cards">
        {favs.map(s => (
          <button key={s.id} className="card tile left" onClick={() => nav(`/pharmacy/${s.id}`)}>
            <div className="row between"><h3>{s.org_name}</h3>{s.verified && <Badge tone="good">verified</Badge>}</div>
            <p className="muted">{s.city}{s.distance_km != null && ` · ${fmtKm(s.distance_km)}`}</p>
            <div className="row between"><span>{s.medicines_in_stock} in stock</span><Rating value={s.rating_avg} count={s.rating_count} /></div>
          </button>
        ))}
      </div>
    </>
  )
}
