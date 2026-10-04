import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'

export interface MapPoint { id: string; lat: number; lng: number; title: string; subtitle?: string; onOpen?: () => void; highlight?: boolean }

// divIcon avoids bundler problems with Leaflet's default marker images
const pin = (color: string, size = 28) => L.divIcon({
  className: 'map-pin',
  html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>`,
  iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size + 4],
})
const BRAND = pin('#0f766e'), HOT = pin('#d97706', 34), ME = pin('#2563eb', 30)

function Fit({ points, me }: { points: MapPoint[]; me?: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    const pts: [number, number][] = points.map(p => [p.lat, p.lng])
    if (me) pts.push([me.lat, me.lng])
    if (pts.length === 1) map.setView(pts[0], 15)
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 })
  }, [map, points, me])
  return null
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

interface Props {
  points?: MapPoint[]
  me?: { lat: number; lng: number } | null
  /** radius in km drawn around the first point (delivery area) */
  radiusKm?: number | null
  /** when set the map becomes a picker: click anywhere to choose a location */
  pick?: { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void }
  height?: number
}

const INDIA: [number, number] = [20.5937, 78.9629]

export default function MapView({ points = [], me, radiusKm, pick, height = 340 }: Props) {
  const picked = pick && pick.lat != null && pick.lng != null ? { lat: pick.lat, lng: pick.lng } : null
  const all = useMemo<MapPoint[]>(() => (picked ? [{ id: 'picked', lat: picked.lat, lng: picked.lng, title: 'Selected location' }] : points), [points, picked])
  const center: [number, number] = all[0] ? [all[0].lat, all[0].lng] : me ? [me.lat, me.lng] : INDIA
  const first = points[0]
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={center} zoom={all.length || me ? 13 : 5} scrollWheelZoom={!!pick} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {!pick && <Fit points={points} me={me} />}
        {pick && picked && <Fit points={[{ id: 'p', lat: picked.lat, lng: picked.lng, title: '' }]} />}
        {pick && <ClickToPick onPick={pick.onChange} />}
        {me && <Marker position={[me.lat, me.lng]} icon={ME}><Popup>You are here</Popup></Marker>}
        {radiusKm && first && <Circle center={[first.lat, first.lng]} radius={radiusKm * 1000} pathOptions={{ color: '#0f766e', fillOpacity: 0.07, weight: 1.5 }} />}
        {all.map(p => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={p.highlight ? HOT : BRAND}>
            <Popup>
              <b>{p.title}</b>
              {p.subtitle && <div style={{ fontSize: '.8rem' }}>{p.subtitle}</div>}
              {p.onOpen && <button className="link" onClick={p.onOpen}>Open →</button>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
