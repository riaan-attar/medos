import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Factory, ShoppingBag, Store, Warehouse } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { errMsg } from '../lib/format'
import { Alert, Field } from '../components/ui'
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
  const business = role !== 'consumer'
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await signUp({ ...f, role })
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
        <div className="role-grid">
          {ROLES.map(r => (
            <button type="button" key={r.value} className={`role-card ${role === r.value ? 'sel' : ''}`} onClick={() => setRole(r.value)}>
              <r.icon size={20} /><strong>{r.label}</strong><small>{r.desc}</small>
            </button>
          ))}
        </div>
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
        <button className="btn primary block lg" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="center"><Building2 size={14} /> Already registered? <Link to="/login">Sign in</Link></p>
    </AuthShell>
  )
}
