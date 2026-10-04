import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox, Star, X } from 'lucide-react'
import { initials, statusLabel } from '../lib/format'
import type { OrderStatus, Role } from '../lib/types'

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {back}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row gap wrap">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, tone, icon, to }: {
  label: string; value: ReactNode; hint?: string; tone?: 'warn' | 'bad' | 'good' | 'info'; icon?: ReactNode; to?: string
}) {
  const body = (
    <>
      <div className="stat-top"><span className="stat-label">{label}</span>{icon && <span className="stat-icon">{icon}</span>}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  )
  return to
    ? <Link className={`stat link ${tone ?? ''}`} to={to}>{body}</Link>
    : <div className={`stat ${tone ?? ''}`}>{body}</div>
}

export function StatusBadge({ status, buyerRole }: { status: OrderStatus; buyerRole?: Role | null }) {
  return <span className={`badge s-${status}`}>{statusLabel(status, buyerRole)}</span>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  return <span className={`badge t-${tone}`}>{children}</span>
}

export function Empty({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={26} />}</div>
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  )
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="loading" aria-busy="true"><span className="spinner" /> {text}</div>
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${95 - (i % 3) * 12}%` }} />)}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert err">
      <AlertCircle size={18} /> <span>{message}</span>
      {onRetry && <button className="link" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function Alert({ tone = 'warn', children }: { tone?: 'warn' | 'err' | 'ok' | 'info'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'err' ? AlertCircle : AlertTriangle
  return <div className={`alert ${tone}`}><Icon size={18} /><div>{children}</div></div>
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Replaces window.prompt for reasons / notes
export function PromptModal({ title, label, confirmLabel = 'Confirm', tone = 'primary', required, onClose, onSubmit }: {
  title: string; label: string; confirmLabel?: string; tone?: 'primary' | 'danger'; required?: boolean
  onClose: () => void; onSubmit: (value: string) => void | Promise<void>
}) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSubmit(v) } finally { setBusy(false) } }}>
        <Field label={label}><textarea rows={3} required={required} value={v} onChange={e => setV(e.target.value)} autoFocus /></Field>
        <div className="row gap end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${tone}`} disabled={busy}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>{initials(name)}</span>
}

export function Rating({ value, count }: { value: number | null | undefined; count?: number }) {
  if (!value) return <span className="muted small">No ratings yet</span>
  return (
    <span className="rating" title={`${value} out of 5`}>
      <Star size={14} fill="currentColor" /> {value.toFixed(1)}{count != null && <span className="muted"> ({count})</span>}
    </span>
  )
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="row" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button type="button" key={n} className={`star-btn ${n <= value ? 'on' : ''}`} onClick={() => onChange(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
          <Star size={24} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, max, tone }: { value: number; max: number; tone?: 'good' | 'warn' | 'bad' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return <div className={`progress ${tone ?? ''}`}><div style={{ width: `${pct}%` }} /></div>
}

export function Bars({ data }: { data: { day: string; in: number; out: number }[] }) {
  const max = Math.max(1, ...data.flatMap(d => [d.in, d.out]))
  return (
    <div className="bars" role="img" aria-label="Stock in and out over the last 14 days">
      {data.map(d => (
        <div key={d.day} className="bar-col" title={`${d.day}: +${d.in} / -${d.out}`}>
          <div className="bar-pair">
            <div className="bar in" style={{ height: `${(d.in / max) * 100}%` }} />
            <div className="bar out" style={{ height: `${(d.out / max) * 100}%` }} />
          </div>
          <small>{d.day.slice(8)}</small>
        </div>
      ))}
    </div>
  )
}
