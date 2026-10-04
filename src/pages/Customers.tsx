import { useAsync } from '../lib/useAsync'
import { api } from '../lib/api'
import { fmtDate, money } from '../lib/format'
import { ErrorBox, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { RetailCustomer } from '../lib/types'

interface Row extends RetailCustomer { bills: number; spent: number; last: string | null }

export default function Customers() {
  const cust = useAsync(() => api.customers(), [])
  const bills = useAsync(() => api.bills(1000), [])
  const rows: Row[] = (cust.data ?? []).map(c => {
    const bs = (bills.data ?? []).filter(b => b.customer_phone === c.phone)
    return { ...c, bills: bs.length, spent: bs.reduce((s, b) => s + Number(b.total) - Number(b.refunded_total), 0), last: bs[0]?.created_at ?? null }
  })
  const cols: Column<Row>[] = [
    { key: 'name', header: 'Customer', render: r => <b>{r.name || 'Unnamed'}</b> },
    { key: 'phone', header: 'Phone' },
    { key: 'bills', header: 'Bills', align: 'right' },
    { key: 'spent', header: 'Total spent', align: 'right', render: r => money(r.spent) },
    { key: 'last', header: 'Last purchase', render: r => fmtDate(r.last) },
    { key: 'created_at', header: 'Since', render: r => fmtDate(r.created_at) },
  ]
  return (
    <>
      <PageHeader title="Customers" subtitle="Customers are added automatically when you enter a phone number at the counter" />
      {cust.loading && !cust.data && <Skeleton />}
      {cust.error && <ErrorBox message={cust.error} onRetry={cust.reload} />}
      {cust.data && <DataTable rows={rows} columns={cols} rowKey={r => r.id} exportName="customers" searchPlaceholder="Search name or phone…" initialSort={{ key: 'spent', dir: 'desc' }}
        empty={{ title: 'No customers yet', hint: 'Add a phone number on a bill to build your customer list.' }} />}
    </>
  )
}
