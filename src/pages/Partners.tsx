import { useState, type FormEvent } from 'react'
import { Pencil } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, Field, Modal, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import { useToast } from '../components/Toast'
import type { Profile, TradeRelation } from '../lib/types'

// Sellers to businesses: manage credit limits and negotiated discounts per buyer
export default function Partners() {
  const { profile } = useAuth()
  const uid = profile!.id
  const role = profile!.role as 'manufacturer' | 'distributor'
  const toast = useToast()
  const buyers = useAsync(() => api.buyerDirectory(role), [role])
  const rel = useAsync(() => api.relations(uid), [uid])
  const bal = useAsync(() => api.balances(), [])
  const [edit, setEdit] = useState<Profile | null>(null)
  const [f, setF] = useState({ credit: '', discount: '0' })
  const [busy, setBusy] = useState(false)

  const relOf = (id: string): TradeRelation | undefined => rel.data?.find(r => r.buyer_id === id)
  const owed = (id: string) => Number(bal.data?.find(b => b.counterparty_id === id)?.receivable ?? 0)

  async function save(e: FormEvent) {
    e.preventDefault(); if (!edit) return; setBusy(true)
    try {
      await api.saveRelation(uid, edit.id, f.credit === '' ? null : Number(f.credit), Number(f.discount) || 0)
      toast.ok('Terms saved'); setEdit(null); rel.reload()
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  const cols: Column<Profile>[] = [
    { key: 'org_name', header: 'Business', value: p => p.org_name || p.full_name, render: p => <><b>{p.org_name || p.full_name}</b><div className="muted small">{p.role} · {p.city}</div></> },
    { key: 'verified', header: 'Verified', value: p => (p.verified ? 'yes' : 'no'), render: p => (p.verified ? <Badge tone="good">verified</Badge> : <Badge tone="warn">unverified</Badge>) },
    { key: 'limit', header: 'Credit limit', align: 'right', value: p => relOf(p.id)?.credit_limit ?? -1, render: p => { const l = relOf(p.id)?.credit_limit; return l == null ? <span className="muted">No limit</span> : money(l) } },
    { key: 'owed', header: 'Outstanding', align: 'right', value: p => owed(p.id), render: p => (owed(p.id) ? money(owed(p.id)) : '—') },
    { key: 'discount', header: 'Discount', align: 'right', value: p => relOf(p.id)?.discount_pct ?? 0, render: p => `${relOf(p.id)?.discount_pct ?? 0}%` },
    { key: 'act', header: '', noSort: true, noCsv: true, align: 'right', render: p => (
      <button className="btn ghost sm" onClick={() => { const r = relOf(p.id); setF({ credit: r?.credit_limit != null ? String(r.credit_limit) : '', discount: String(r?.discount_pct ?? 0) }); setEdit(p) }}><Pencil size={14} /> Terms</button>) },
  ]

  return (
    <>
      <PageHeader title={role === 'manufacturer' ? 'Buyers & credit' : 'Retailers & credit'} subtitle="Set a credit limit and a standing discount for each buyer. Orders that would breach the limit are blocked." />
      {buyers.loading && !buyers.data && <Skeleton />}
      {buyers.error && <ErrorBox message={buyers.error} onRetry={buyers.reload} />}
      {buyers.data && <DataTable rows={buyers.data} columns={cols} rowKey={p => p.id} exportName="buyers" searchPlaceholder="Search buyers…" empty={{ title: 'No buyers yet', hint: 'Businesses that sign up appear here.' }} />}
      {edit && (
        <Modal title={`Terms for ${edit.org_name || edit.full_name}`} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <Field label="Credit limit (₹)" hint="Leave blank for no limit. Counts unpaid invoices + open orders."><input type="number" min="0" step="1" value={f.credit} onChange={e => setF({ ...f, credit: e.target.value })} /></Field>
            <Field label="Standing discount (%)" hint="Applied to your listing price for this buyer."><input type="number" min="0" max="90" step="0.5" value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })} /></Field>
            <div className="row gap end"><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy}>Save terms</button></div>
          </form>
        </Modal>
      )}
    </>
  )
}
