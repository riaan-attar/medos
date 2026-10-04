import { useState, type FormEvent } from 'react'
import { LocateFixed, Moon, Sun, SunMoon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, roleLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useTheme, type Theme } from '../lib/theme'
import { Alert, Badge, Field, PageHeader, Tabs } from '../components/ui'
import { useToast } from '../components/Toast'

type Tab = 'profile' | 'location' | 'security' | 'appearance'

export default function Settings() {
  const { profile, session, refreshProfile } = useAuth()
  const toast = useToast()
  const p = profile!
  const business = p.role === 'manufacturer' || p.role === 'distributor' || p.role === 'retailer'
  const [tab, setTab] = useState<Tab>('profile')
  const [f, setF] = useState({ full_name: p.full_name, org_name: p.org_name, phone: p.phone, city: p.city, address: p.address, license_no: p.license_no, gstin: p.gstin, about: p.about })
  const [pos, setPos] = useState({ lat: p.lat != null ? String(p.lat) : '', lng: p.lng != null ? String(p.lng) : '' })
  const [pw, setPw] = useState({ a: '', b: '' })
  const [busy, setBusy] = useState(false)
  const { theme, set } = useTheme()
  const set$ = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { await api.updateProfile(p.id, f); await refreshProfile(); toast.ok('Profile saved') } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  async function savePos(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await api.updateProfile(p.id, { lat: pos.lat === '' ? null : Number(pos.lat), lng: pos.lng === '' ? null : Number(pos.lng) })
      await refreshProfile(); toast.ok('Location saved')
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  function detect() {
    navigator.geolocation?.getCurrentPosition(
      g => setPos({ lat: g.coords.latitude.toFixed(6), lng: g.coords.longitude.toFixed(6) }),
      () => toast.err('Could not get your location'), { timeout: 10000 })
  }
  async function changePw(e: FormEvent) {
    e.preventDefault()
    if (pw.a.length < 6) { toast.err('Password must be at least 6 characters'); return }
    if (pw.a !== pw.b) { toast.err('Passwords do not match'); return }
    setBusy(true)
    try { const { error } = await supabase.auth.updateUser({ password: pw.a }); if (error) throw error; toast.ok('Password updated'); setPw({ a: '', b: '' }) }
    catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  const themes: { id: Theme; label: string; icon: React.ElementType }[] = [{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'System', icon: SunMoon }]

  return (
    <>
      <PageHeader title="Settings" subtitle={session?.user.email} actions={<><Badge tone="info">{roleLabel[p.role]}</Badge>{business && (p.verified ? <Badge tone="good">verified</Badge> : <Badge tone="warn">awaiting verification</Badge>)}</>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'profile', label: 'Profile' }, ...(p.role !== 'admin' ? [{ id: 'location' as const, label: 'Location' }] : []), { id: 'security', label: 'Security' }, { id: 'appearance', label: 'Appearance' }]} />

      {tab === 'profile' && (
        <form className="card narrow-lg stack" onSubmit={save}>
          <div className="grid2">
            <Field label="Name"><input value={f.full_name} onChange={set$('full_name')} /></Field>
            {business && <Field label="Business name"><input value={f.org_name} onChange={set$('org_name')} /></Field>}
            <Field label="Phone"><input value={f.phone} onChange={set$('phone')} /></Field>
            <Field label="City"><input value={f.city} onChange={set$('city')} /></Field>
            {business && <Field label="Address"><input value={f.address} onChange={set$('address')} /></Field>}
            {business && <Field label="Drug licence no."><input value={f.license_no} onChange={set$('license_no')} /></Field>}
            {business && <Field label="GSTIN" hint="Printed on your invoices"><input value={f.gstin} onChange={set$('gstin')} /></Field>}
          </div>
          {business && <Field label="About your business" hint="Shown on your public profile"><textarea rows={3} value={f.about} onChange={set$('about')} /></Field>}
          <button className="btn primary" disabled={busy}>Save changes</button>
        </form>
      )}

      {tab === 'location' && (
        <form className="card narrow-lg stack" onSubmit={savePos}>
          {p.role === 'retailer' || p.role === 'distributor' || p.role === 'manufacturer'
            ? <Alert tone="info">Customers sort pharmacies by distance. Set your shop location so they can find you.</Alert>
            : <Alert tone="info">Your coordinates are only used if you choose to share them.</Alert>}
          <div className="grid2">
            <Field label="Latitude"><input type="number" step="any" min="-90" max="90" value={pos.lat} onChange={e => setPos({ ...pos, lat: e.target.value })} /></Field>
            <Field label="Longitude"><input type="number" step="any" min="-180" max="180" value={pos.lng} onChange={e => setPos({ ...pos, lng: e.target.value })} /></Field>
          </div>
          <div className="row gap"><button type="button" className="btn" onClick={detect}><LocateFixed size={16} /> Use my current location</button><button className="btn primary" disabled={busy}>Save location</button></div>
        </form>
      )}

      {tab === 'security' && (
        <form className="card narrow-lg stack" onSubmit={changePw}>
          <h2>Change password</h2>
          <Field label="New password"><input type="password" minLength={6} value={pw.a} onChange={e => setPw({ ...pw, a: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><input type="password" minLength={6} value={pw.b} onChange={e => setPw({ ...pw, b: e.target.value })} autoComplete="new-password" /></Field>
          <button className="btn primary" disabled={busy}>Update password</button>
        </form>
      )}

      {tab === 'appearance' && (
        <section className="card narrow-lg">
          <h2>Theme</h2>
          <div className="role-grid">{themes.map(t => (
            <button key={t.id} type="button" className={`role-card ${theme === t.id ? 'sel' : ''}`} onClick={() => set(t.id)}><t.icon size={20} /><strong>{t.label}</strong></button>
          ))}</div>
        </section>
      )}
    </>
  )
}
