import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { errMsg } from '../lib/format'
import { Alert, Field } from '../components/ui'
import AuthShell from '../components/AuthShell'

export default function Login() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await signIn(email, password); nav('/') } catch (x) { setErr(errMsg(x)) } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your stock, orders and accounts.">
      <form className="stack" onSubmit={submit}>
        {err && <Alert tone="err">{err}</Alert>}
        <Field label="Email"><input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label="Password"><input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <button className="btn primary block lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="center">New to MedOS? <Link to="/signup">Create an account</Link></p>
      <p className="center"><Link to="/check" className="row gap center-row"><ShieldCheck size={16} /> Verify a medicine batch without signing in</Link></p>
    </AuthShell>
  )
}
