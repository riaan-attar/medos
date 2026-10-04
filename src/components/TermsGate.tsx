import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg } from '../lib/format'
import { Alert, Modal } from './ui'

// Existing and new users must accept the terms once.
export default function TermsGate() {
  const { userProfile, refreshProfile, signOut } = useAuth()
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!userProfile || userProfile.accepted_terms_at) return null
  async function accept() {
    setBusy(true); setErr('')
    try { await api.updateProfile(userProfile!.id, { accepted_terms_at: new Date().toISOString() }); await refreshProfile() } catch (x) { setErr(errMsg(x)); setBusy(false) }
  }
  return (
    <Modal title="Before you continue" onClose={() => {}}>
      <div className="stack">
        <p>Please review and accept our <Link to="/legal/terms" target="_blank">Terms of Service</Link>, <Link to="/legal/privacy" target="_blank">Privacy Policy</Link> and <Link to="/legal/refunds" target="_blank">Refund Policy</Link>.</p>
        {err && <Alert tone="err">{err}</Alert>}
        <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I have read and agree to these terms</label>
        <div className="row gap end"><button className="btn ghost" onClick={signOut}>Sign out</button><button className="btn primary" disabled={!ok || busy} onClick={accept}>Accept &amp; continue</button></div>
      </div>
    </Modal>
  )
}
