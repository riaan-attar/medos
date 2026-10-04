import { useState } from 'react'
import { Printer } from 'lucide-react'
import { api } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { H1Entry } from '../lib/types'

export default function H1Register() {
  const { data, error, loading, reload } = useAsync(() => api.h1Register(), [])
  const [range, setRange] = useState<'30d' | '90d' | 'all'>('90d')
  const since = range === 'all' ? 0 : Date.now() - (range === '30d' ? 30 : 90) * 86400000
  const rows = (data ?? []).filter(r => new Date(r.sold_at).getTime() >= since)

  const cols: Column<H1Entry>[] = [
    { key: 'sold_at', header: 'Date & time', render: r => fmtDateTime(r.sold_at) },
    { key: 'bill', header: 'Bill', value: r => r.sale_bills?.bill_no },
    { key: 'med', header: 'Drug', value: r => `${r.medicines?.name} ${r.medicines?.strength}`, render: r => <><b>{r.medicines?.name}</b> <span className="muted">{r.medicines?.strength}</span></> },
    { key: 'batch', header: 'Batch', value: r => r.batches?.batch_no },
    { key: 'quantity', header: 'Qty', align: 'right' },
    { key: 'patient_name', header: 'Patient' },
    { key: 'doctor_name', header: 'Prescriber', value: r => `${r.doctor_name} ${r.doctor_reg_no}`.trim(), render: r => <>{r.doctor_name}{r.doctor_reg_no && <div className="muted small">Reg. {r.doctor_reg_no}</div>}</> },
    { key: 'rx_number', header: 'Rx no.' },
  ]
  return (
    <>
      <PageHeader title="Schedule H1 register" subtitle="Every H1 drug sold at the counter is logged here automatically, ready for inspection"
        actions={<button className="btn" onClick={() => window.print()}><Printer size={16} /> Print</button>} />
      <Alert tone="info">Keep this register for at least 3 years as required for Schedule H1 drugs. Entries are created by the point of sale and cannot be edited.</Alert>
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <div className="print-area"><DataTable rows={rows} columns={cols} rowKey={r => r.id} exportName="h1-register" pageSize={25} initialSort={{ key: 'sold_at', dir: 'desc' }}
          toolbar={<select value={range} onChange={e => setRange(e.target.value as typeof range)}><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="all">All time</option></select>}
          empty={{ title: 'No H1 sales recorded', hint: 'Sell a Schedule H1 drug from the point of sale to see it here.' }} /></div>
      )}
    </>
  )
}
