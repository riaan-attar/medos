import { useState } from 'react'
import { Ban, BadgeCheck, CircleCheck } from 'lucide-react'
import { api } from '../lib/api'
import { errMsg, fmtDate, roleLabel } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import { useToast } from '../components/Toast'
import type { Profile } from '../lib/types'

export default function AdminUsers() {
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.allProfiles(), [])
  const [role, setRole] = useState('all')
  const [state, setState] = useState('all')
  const rows = (data ?? []).filter(p => !p.org_id && (role === 'all' || p.role === role) && (state === 'all' || (state === 'unverified' ? !p.verified && p.role !== 'consumer' && p.role !== 'admin' : state === 'suspended' ? p.status === 'suspended' : true)))

  async function act(fn: () => Promise<void>, ok: string) { try { await fn(); toast.ok(ok); reload() } catch (x) { toast.err(errMsg(x)) } }

  const cols: Column<Profile>[] = [
    { key: 'name', header: 'Name', value: p => p.org_name || p.full_name, render: p => <><b>{p.org_name || p.full_name}</b>{p.org_name && <div className="muted small">{p.full_name}</div>}</> },
    { key: 'role', header: 'Role', render: p => roleLabel[p.role] },
    { key: 'city', header: 'City' },
    { key: 'license_no', header: 'Licence' },
    { key: 'created_at', header: 'Joined', render: p => fmtDate(p.created_at) },
    { key: 'status', header: 'Status', value: p => (p.status === 'suspended' ? 'suspended' : p.verified ? 'verified' : 'unverified'),
      render: p => (p.status === 'suspended' ? <Badge tone="bad">suspended</Badge> : p.verified ? <Badge tone="good">verified</Badge> : p.role === 'consumer' || p.role === 'admin' ? <Badge>active</Badge> : <Badge tone="warn">unverified</Badge>) },
    { key: 'act', header: '', noSort: true, noCsv: true, align: 'right', render: p => p.role === 'admin' ? null : (
      <div className="row gap end">
        {p.role !== 'consumer' && <button className="btn ghost sm" onClick={() => act(() => api.setVerified(p.id, !p.verified), p.verified ? 'Verification removed' : 'Verified')}>{p.verified ? <CircleCheck size={14} /> : <BadgeCheck size={14} />} {p.verified ? 'Unverify' : 'Verify'}</button>}
        {p.status === 'suspended'
          ? <button className="btn sm" onClick={() => act(() => api.setStatus(p.id, 'active'), 'Account reactivated')}>Reactivate</button>
          : <button className="btn danger sm" onClick={() => confirm(`Suspend ${p.org_name || p.full_name}? They will be locked out immediately.`) && act(() => api.setStatus(p.id, 'suspended'), 'Account suspended')}><Ban size={14} /> Suspend</button>}
      </div>) },
  ]

  return (
    <>
      <PageHeader title="Accounts" subtitle="Verify business licences and manage access" />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={rows} columns={cols} rowKey={p => p.id} exportName="accounts" searchPlaceholder="Search accounts…" initialSort={{ key: 'created_at', dir: 'desc' }}
        toolbar={<>
          <select value={role} onChange={e => setRole(e.target.value)}><option value="all">All roles</option>{Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={state} onChange={e => setState(e.target.value)}><option value="all">Any status</option><option value="unverified">Unverified</option><option value="suspended">Suspended</option></select>
        </>} />}
    </>
  )
}
