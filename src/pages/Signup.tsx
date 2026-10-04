import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Factory, ShoppingBag, Store, Warehouse } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { errMsg } from '../lib/format'
import { Alert, Field } from '../components/ui'
import { api } from '../lib/api'
import { roleLabel } from '../lib/format'
import { useEffect } from 'react'
import type { InviteInfo } from '../lib/types'
import AuthShell from '../components/AuthShell'
import type { Role } from '../lib/types'

type SignupRole = Exclude<Role, 'admin'>
const ROLES: { value: SignupRole; label: string; desc: string; icon: React.ElementType }[] = [
  { value: 'manufacturer', label: 'Factory / Manufacturer', desc: 'Produce batches, sell to distributors & retailers', icon: Factory },
  { value: 'distributor', label: 'Dealer / Wholesaler', desc: 'Buy from factories, supply retailers', icon: Warehouse },
  { value: 'retailer', label: 'Retailer / Pharmacy', desc: 'Stock shelves, bill customers', icon: Store },
  { value: 'consumer', label: 'Customer', desc: 'Find medicines & verify authenticity', icon: ShoppingBag },
]

export default function Signup() {
  const { signUp } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const initial = ROLES.find(r => r.value === params.get('role'))?.value ?? 'retailer'
  const [role, setRole] = useState<SignupRole>(initial)
  const [f, setF] = useState({ email: '', password: '', full_name: '', org_name: '', phone: '', city: '', address: '', license_no: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [agree, setAgree] = useState(false)
  const [code, setCode] = useState(params.get('invite') ?? '')
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [codeErr, setCodeErr] = useState('')
  const [useCode, setUseCode] = useState(!!params.get('invite'))
  useEffect(() => {
    setInvite(null); setCodeErr('')
    if (!useCode || code.trim().length < 6) return
    api.checkInvite(code).then(i => { setInvite(i); if (!i) setCodeErr('Invite code is invalid or expired') }).catch(() => setCodeErr('Could not check the invite code'))
  }, [code, useCode])
  const business = role !== 'consumer' && !invite
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      if (useCode && !invite) { setErr('Enter a valid invite code or switch to a new account'); setBusy(false); return }
      const r = await signUp({ ...f, role, invite_code: invite ? code.trim() : undefined })
      if (r.needsConfirmation) setDone(true); else nav('/')
    } catch (x) { setErr(errMsg(x)) } finally { setBusy(false) }
  }

  if (done) return (
    <AuthShell title="Check your email">
      <p>We sent a confirmation link to <b>{f.email}</b>. Confirm it, then <Link to="/login">sign in</Link>.</p>
    </AuthShell>
  )

  return (
    <AuthShell title="Create your account" subtitle="Pick how you take part in the supply chain." wide>
      <form className="stack" onSubmit={submit}>
        {err && <Alert tone="err">{err}</Alert>}
        <label className="check"><input type="checkbox" checked={useCode} onChange={e => setUseCode(e.target.checked)} /> I was invited to join a business (I have an invite code)</label>
        {useCode && (
          <div className="stack">
            <Field label="Invite code"><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. 3F9A21BC" /></Field>
            {invite && <Alert tone="ok">You're joining <b>{invite.org_name}</b> ({roleLabel[invite.role]}) as <b>{invite.member_role}</b>.</Alert>}
            {codeErr && <Alert tone="err">{codeErr}</Alert>}
          </div>
        )}
        {!useCode && <div className="role-grid">
          {ROLES.map(r => (
            <button type="button" key={r.value} className={`role-card ${role === r.value ? 'sel' : ''}`} onClick={() => setRole(r.value)}>
              <r.icon size={20} /><strong>{r.label}</strong><small>{r.desc}</small>
            </button>
          ))}
        </div>}
        <div className="grid2">
          <Field label="Your name"><input required value={f.full_name} onChange={set('full_name')} /></Field>
          {business && <Field label="Business name"><input required value={f.org_name} onChange={set('org_name')} /></Field>}
          <Field label="Email"><input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
          <Field label="Password" hint="At least 6 characters"><input type="password" required minLength={6} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="City"><input required={business} value={f.city} onChange={set('city')} /></Field>
          {business && <Field label="Address"><input value={f.address} onChange={set('address')} /></Field>}
          {business && <Field label="Drug licence no." hint="Verified by an admin"><input value={f.license_no} onChange={set('license_no')} /></Field>}
        </div>
        <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} required /> <span>I agree to the <Link to="/legal/terms" target="_blank">Terms</Link> and <Link to="/legal/privacy" target="_blank">Privacy Policy</Link></span></label>
        <button className="btn primary block lg" disabled={busy || !agree}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="center"><Building2 size={14} /> Already registered? <Link to="/login">Sign in</Link></p>
    </AuthShell>
  )
}
