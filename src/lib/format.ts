import type { OrderStatus, Role } from './types'

export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n ?? 0))

export const num = (n: number | null | undefined) => new Intl.NumberFormat('en-IN').format(n ?? 0)

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const daysUntil = (d: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((new Date(d + 'T00:00:00').getTime() - today.getTime()) / 86400000)
}

export const roleLabel: Record<Role, string> = {
  manufacturer: 'Manufacturer',
  distributor: 'Distributor / Wholesaler',
  retailer: 'Retailer / Pharmacy',
  consumer: 'Customer',
  admin: 'Administrator',
}

export const statusLabel = (s: OrderStatus, buyerRole?: Role | null) =>
  s === 'delivered' && buyerRole === 'consumer' ? 'fulfilled' : s.replace('_', ' ')

export const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Something went wrong'

// Who each role may buy from
export const supplierRole: Partial<Record<Role, string>> = {
  distributor: 'manufacturers',
  retailer: 'distributors & manufacturers',
  consumer: 'pharmacies',
}

export const outstanding = (i: { total: number; credit_total: number; paid_total: number; status?: string }) =>
  i.status === 'void' ? 0 : Math.max(0, Math.round((Number(i.total) - Number(i.credit_total) - Number(i.paid_total)) * 100) / 100)

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

export const timeAgo = (d: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
