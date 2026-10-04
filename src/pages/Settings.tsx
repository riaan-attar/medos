import { useState, type FormEvent } from 'react'
import { Copy, LocateFixed, Moon, Sun, SunMoon, Trash2, UserPlus } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, roleLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useTheme, type Theme } from '../lib/theme'
import { GST_STATES } from '../lib/gst'
import { Alert, Badge, ErrorBox, Field, Modal, PageHeader, Skeleton, Tabs } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { fmtDate } from '../lib/format'
import type { OrgInvite, TeamMember } from '../lib/types'
import { useToast } from '../components/Toast'

type Tab = 'profile' | 'location' | 'team' | 'security' | 'appearance'

export default function Settings() {
  const { profile, session, userProfile, isStaff, memberRole, can, refreshProfile } = useAuth()
  const toast = useToast()
  const p = profile!
  void userProfile
  const business = p.role === 'manufacturer' || p.role === 'distributor' || p.role === 'retailer'
  const canEditOrg = can('settings')
  const [tab, setTab] = useState<Tab>('profile')
  const [f, setF] = useState({ full_name: p.full_name, org_name: p.org_name, phone: p.phone, city: p.city, address: p.address, license_no: p.license_no, gstin: p.gstin, about: p.about, state_code: p.state_code })
  const [pos, setPos] = useState({ lat: p.lat != null ? String(p.lat) : '', lng: p.lng != null ? String(p.lng) : '' })
  const [pw, setPw] = useState({ a: '', b: '' })
  const [busy, setBusy] = useState(false)
  const { theme, set } = useTheme()
  const set$ = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { await api.updateProfile(p.id, { ...f, state: GST_STATES.find(s => s.code === f.state_code)?.name ?? '' }); await refreshProfile(); toast.ok('Profile saved') } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
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
      <PageHeader title="Settings" subtitle={session?.user.email} actions={<>{isStaff && <Badge tone="neutral">{memberRole} at {p.org_name}</Badge>}<Badge tone="info">{roleLabel[p.role]}</Badge>{business && (p.verified ? <Badge tone="good">verified</Badge> : <Badge tone="warn">awaiting verification</Badge>)}</>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'profile', label: isStaff ? 'Business' : 'Profile' }, ...(p.role !== 'admin' ? [{ id: 'location' as const, label: 'Location' }] : []), ...(business && can('team') ? [{ id: 'team' as const, label: 'Team' }] : []), { id: 'security', label: 'Security' }, { id: 'appearance', label: 'Appearance' }]} />

      {tab === 'profile' && (
        <form className="card narrow-lg stack" onSubmit={save}>
          {!canEditOrg && <Alert tone="info">Only an owner or manager can edit business details.</Alert>}
          <div className="grid2">
            <Field label="Name"><input value={f.full_name} onChange={set$('full_name')} /></Field>
            {business && <Field label="Business name"><input value={f.org_name} onChange={set$('org_name')} /></Field>}
            <Field label="Phone"><input value={f.phone} onChange={set$('phone')} /></Field>
            <Field label="City"><input value={f.city} onChange={set$('city')} /></Field>
            {business && <Field label="Address"><input value={f.address} onChange={set$('address')} /></Field>}
            {business && <Field label="Drug licence no."><input value={f.license_no} onChange={set$('license_no')} /></Field>}
            {business && <Field label="GSTIN" hint="Printed on your invoices. First two digits set your state."><input value={f.gstin} onChange={e => { const v = e.target.value.toUpperCase(); setF(x => ({ ...x, gstin: v, state_code: /^[0-9]{2}/.test(v) ? v.slice(0, 2) : x.state_code })) }} /></Field>}
            {business && <Field label="State" hint="Decides CGST+SGST vs IGST on invoices"><select value={f.state_code} onChange={e => setF({ ...f, state_code: e.target.value })}><option value="">Select state…</option>{GST_STATES.map(s => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select></Field>}
          </div>
          {business && <Field label="About your business" hint="Shown on your public profile"><textarea rows={3} value={f.about} onChange={set$('about')} /></Field>}
          <button className="btn primary" disabled={busy || !canEditOrg}>Save changes</button>
        </form>
      )}

      {tab === 'team' && <TeamTab />}

      {tab === 'location' && (
        <form className="card narrow-lg stack" onSubmit={savePos}>
          {p.role === 'retailer' || p.role === 'distributor' || p.role === 'manufacturer'
            ? <Alert tone="info">Customers sort pharmacies by distance. Set your shop location so they can find you.</Alert>
            : <Alert tone="info">Your coordinates are only used if you choose to share them.</Alert>}
          <div className="grid2">
            <Field label="Latitude"><input type="number" step="any" min="-90" max="90" value={pos.lat} onChange={e => setPos({ ...pos, lat: e.target.value })} /></Field>
            <Field label="Longitude"><input type="number" step="any" min="-180" max="180" value={pos.lng} onChange={e => setPos({ ...pos, lng: e.target.value })} /></Field>
          </div>
          <div className="row gap"><button type="button" className="btn" onClick={detect}><LocateFixed size={16} /> Use my current location</button><button className="btn primary" disabled={busy || !canEditOrg}>Save location</button></div>
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

const STAFF_ROLES: { id: Exclude<import('../lib/types').MemberRole, 'owner'>; label: string; desc: string }[] = [
  { id: 'manager', label: 'Manager', desc: 'Everything except managing the team' },
  { id: 'pharmacist', label: 'Pharmacist', desc: 'Sell, refund, adjust stock, returns, customers' },
  { id: 'cashier', label: 'Cashier', desc: 'Counter sales and customers only' },
  { id: 'warehouse', label: 'Warehouse', desc: 'Batches, stock, receiving & shipping' },
  { id: 'accountant', label: 'Accountant', desc: 'Payments, credit terms and reports' },
]

function TeamTab() {
  const toast = useToast()
  const team = useAsync(() => api.team(), [])
  const invites = useAsync(() => api.invites(), [])
  const [adding, setAdding] = useState(false)
  const [role, setRole] = useState<(typeof STAFF_ROLES)[number]['id']>('cashier')
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signupUrl = (code: string) => `${window.location.origin}/signup?invite=${code}`

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { setCreated(await api.createInvite(role, email)); invites.reload() } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  async function change(m: TeamMember, patch: { role?: string; active?: boolean }) {
    try { await api.setMember(m.user_id, patch.role ?? m.member_role, patch.active ?? m.active); toast.ok('Team updated'); team.reload() } catch (x) { toast.err(errMsg(x)) }
  }
  const copy = (t: string) => { void navigator.clipboard.writeText(t); toast.ok('Copied') }

  return (
    <div className="stack">
      <section className="card">
        <div className="row between wrap"><h2>Team members</h2><button className="btn primary" onClick={() => { setCreated(null); setAdding(true) }}><UserPlus size={16} /> Invite staff</button></div>
        {team.loading && !team.data && <Skeleton rows={3} />}
        {team.error && <ErrorBox message={team.error} onRetry={team.reload} />}
        {team.data && team.data.length === 0 && <p className="muted">No staff yet. Invite someone to give them their own login.</p>}
        {team.data && team.data.length > 0 && (
          <div className="table-wrap flat"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>{team.data.map(m => (
              <tr key={m.user_id}>
                <td><b>{m.full_name || '—'}</b><div className="muted small">since {fmtDate(m.created_at)}</div></td><td>{m.email}</td>
                <td><select value={m.member_role} onChange={e => change(m, { role: e.target.value })}>{STAFF_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></td>
                <td>{m.active ? <Badge tone="good">active</Badge> : <Badge tone="bad">disabled</Badge>}</td>
                <td className="r"><button className="btn ghost sm" onClick={() => change(m, { active: !m.active })}>{m.active ? 'Disable' : 'Enable'}</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="card">
        <h2>Pending invites</h2>
        {invites.data?.length === 0 && <p className="muted">None.</p>}
        <ul className="plain">{invites.data?.map((i: OrgInvite) => (
          <li key={i.code} className="row between wrap">
            <span><b>{i.code}</b> <Badge>{i.member_role}</Badge> <span className="muted small">{i.email} · expires {fmtDate(i.expires_at)}</span></span>
            <span className="row gap"><button className="btn sm" onClick={() => copy(signupUrl(i.code))}><Copy size={14} /> Copy link</button>
              <button className="icon-btn" aria-label="Revoke invite" onClick={async () => { await api.revokeInvite(i.code); invites.reload() }}><Trash2 size={15} /></button></span>
          </li>))}</ul>
      </section>
      <section className="card"><h2>What each role can do</h2>
        <ul className="plain small">{STAFF_ROLES.map(r => <li key={r.id}><b>{r.label}</b> — <span className="muted">{r.desc}</span></li>)}</ul></section>
      {adding && (
        <Modal title="Invite staff" onClose={() => setAdding(false)}>
          {created ? (
            <div className="stack">
              <Alert tone="ok">Invite created. Share this link — it works once and expires in 7 days.</Alert>
              <div className="code-box">{signupUrl(created)}</div>
              <p className="muted small">Or give them the code <b>{created}</b> to enter on the sign-up page.</p>
              <div className="row gap end"><button className="btn" onClick={() => copy(signupUrl(created))}><Copy size={16} /> Copy link</button><button className="btn primary" onClick={() => setAdding(false)}>Done</button></div>
            </div>
          ) : (
            <form className="stack" onSubmit={create}>
              <Field label="Role"><select value={role} onChange={e => setRole(e.target.value as typeof role)}>{STAFF_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
              <p className="muted small">{STAFF_ROLES.find(r => r.id === role)?.desc}</p>
              <Field label="Their email (optional, for your reference)"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
              <div className="row gap end"><button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={busy}>Create invite</button></div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}
