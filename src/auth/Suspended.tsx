import { Ban } from 'lucide-react'
import { useAuth } from './AuthContext'

export default function Suspended() {
  const { signOut } = useAuth()
  return (
    <div className="center-screen">
      <div className="card narrow center">
        <Ban size={36} color="var(--bad)" />
        <h1>Account suspended</h1>
        <p className="muted">Your account has been suspended by an administrator. Please contact support.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
