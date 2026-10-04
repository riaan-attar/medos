import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, FileCheck2, ShieldCheck, Truck } from 'lucide-react'

export default function AuthShell({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth-split">
      <aside className="auth-brand">
        <Link to="/" className="brand light"><span className="logo">✚</span> MedOS</Link>
        <div>
          <h2>From factory floor to pharmacy shelf — fully traceable.</h2>
          <ul className="auth-points">
            <li><Boxes size={18} /> Real-time inventory by batch &amp; expiry</li>
            <li><Truck size={18} /> Orders, partial shipments &amp; returns</li>
            <li><FileCheck2 size={18} /> GST invoices &amp; payment tracking</li>
            <li><ShieldCheck size={18} /> Public batch verification &amp; recalls</li>
          </ul>
        </div>
        <small>© MedOS · Medicine supply chain platform</small>
      </aside>
      <main className="auth-main">
        <div className={`auth-card ${wide ? 'wide' : ''}`}>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  )
}
