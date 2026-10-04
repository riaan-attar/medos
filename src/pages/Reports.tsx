import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { fmtDate, money, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, PageHeader, Skeleton, Stat, Tabs } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import type { ReportRow, Role } from '../lib/types'

type Row = ReportRow
const n = (r: Row, k: string) => Number(r[k] ?? 0)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const today = () => iso(new Date())
const daysAgo = (d: number) => iso(new Date(Date.now() - d * 86400000))
const monthStart = () => { const d = new Date(); d.setDate(1); return iso(d) }
const fyStart = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01` }

const m = (key: string, header: string, extra: Partial<Column<Row>> = {}): Column<Row> => ({ key, header, align: 'right', render: r => (r[key] == null ? '—' : money(r[key] as number)), value: r => Number(r[key] ?? 0), ...extra })
const t = (key: string, header: string, extra: Partial<Column<Row>> = {}): Column<Row> => ({ key, header, ...extra })
const d = (key: string, header: string): Column<Row> => ({ key, header, render: r => fmtDate(r[key] as string) })
const q = (key: string, header: string): Column<Row> => ({ key, header, align: 'right', render: r => num(r[key] as number), value: r => Number(r[key] ?? 0) })
const badge = (key: string, header: string): Column<Row> => ({ key, header, render: r => <Badge tone={r[key] === 'paid' ? 'good' : r[key] === 'unpaid' || r[key] === 'credit' ? 'warn' : r[key] === 'partial' ? 'info' : 'neutral'}>{String(r[key])}</Badge> })

interface Def {
  id: string; label: string; roles: Role[]; dated: boolean; rpc: string
  columns: Column<Row>[]; summary?: (rows: Row[]) => { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }[]; note?: string
  rowKey: (r: Row, i: number) => string
}

const KIND: Record<string, string> = { expired_writeoff: 'Expired write-off', damage: 'Damaged / lost', recall_writeoff: 'Recall write-off', expired_on_hand: 'Expired, still on shelf' }

const REPORTS: Def[] = [
  { id: 'sales', label: 'Sales', roles: ['manufacturer', 'distributor', 'retailer'], dated: true, rpc: 'report_sales', rowKey: (r, i) => `${r.ref_no}-${i}`,
    columns: [d('doc_date', 'Date'), t('ref_no', 'Document'), t('kind', 'Type'), t('party', 'Customer'), m('taxable', 'Taxable'), m('tax', 'Tax'), m('total', 'Total'), m('paid', 'Paid'), badge('status', 'Status')],
    summary: rows => [{ label: 'Documents', value: String(rows.length) }, { label: 'Taxable value', value: money(rows.reduce((s, r) => s + n(r, 'taxable'), 0)) }, { label: 'Tax', value: money(rows.reduce((s, r) => s + n(r, 'tax'), 0)) }, { label: 'Total sales', value: money(rows.reduce((s, r) => s + n(r, 'total'), 0)), tone: 'good' }],
    note: 'Invoices are shown net of credit notes. Counter bills are tax-inclusive and net of refunds.' },
  { id: 'purchases', label: 'Purchases', roles: ['distributor', 'retailer'], dated: true, rpc: 'report_purchases', rowKey: (r, i) => `${r.ref_no}-${i}`,
    columns: [d('doc_date', 'Date'), t('ref_no', 'Invoice'), t('party', 'Supplier'), m('taxable', 'Taxable'), m('tax', 'Tax'), m('total', 'Total'), m('paid', 'Paid'), badge('status', 'Status')],
    summary: rows => [{ label: 'Invoices', value: String(rows.length) }, { label: 'Total purchases', value: money(rows.reduce((s, r) => s + n(r, 'total'), 0)) }, { label: 'Paid', value: money(rows.reduce((s, r) => s + n(r, 'paid'), 0)), tone: 'good' }, { label: 'Unpaid', value: money(rows.reduce((s, r) => s + n(r, 'total') - n(r, 'paid'), 0)), tone: 'warn' }] },
  { id: 'gst', label: 'GST summary', roles: ['manufacturer', 'distributor', 'retailer'], dated: true, rpc: 'report_gst_summary', rowKey: (r, i) => `${r.direction}-${r.rate}-${i}`,
    columns: [t('direction', 'Type', { render: r => <Badge tone={r.direction === 'output' ? 'info' : 'good'}>{r.direction === 'output' ? 'Output (sales)' : 'Input (purchases)'}</Badge> }), t('rate', 'GST rate', { render: r => `${r.rate}%`, align: 'right' }), m('taxable', 'Taxable value'), m('cgst', 'CGST'), m('sgst', 'SGST'), m('igst', 'IGST'), m('tax', 'Total tax')],
    summary: rows => { const out = rows.filter(r => r.direction === 'output').reduce((s, r) => s + n(r, 'tax'), 0); const inp = rows.filter(r => r.direction === 'input').reduce((s, r) => s + n(r, 'tax'), 0); return [{ label: 'Output tax', value: money(out) }, { label: 'Input tax credit', value: money(inp) }, { label: out >= inp ? 'Net GST payable' : 'Net credit carried', value: money(Math.abs(out - inp)), tone: out >= inp ? 'warn' : 'good' }] },
    note: 'Indicative summary to help with GSTR-1 / GSTR-3B preparation. Before credit notes — confirm with your accountant.' },
  { id: 'valuation', label: 'Stock valuation', roles: ['manufacturer', 'distributor', 'retailer'], dated: false, rpc: 'report_stock_valuation', rowKey: r => String(r.medicine_id),
    columns: [t('name', 'Medicine', { render: r => <><b>{r.name}</b> <span className="muted">{r.strength} · {r.pack_size}</span></> }), q('units', 'Units'), m('unit_price', 'Your price'), m('value', 'Value'), m('mrp', 'MRP'), m('value_at_mrp', 'Value at MRP'), q('near_expiry_units', '≤90d to expiry'), q('expired_units', 'Expired')],
    summary: rows => [{ label: 'Units', value: num(rows.reduce((s, r) => s + n(r, 'units'), 0)) }, { label: 'Stock value (your price)', value: money(rows.reduce((s, r) => s + n(r, 'value'), 0)), tone: 'good' }, { label: 'Value at MRP', value: money(rows.reduce((s, r) => s + n(r, 'value_at_mrp'), 0)) }, { label: 'Expired units', value: num(rows.reduce((s, r) => s + n(r, 'expired_units'), 0)), tone: 'bad' }] },
  { id: 'losses', label: 'Expiry & losses', roles: ['manufacturer', 'distributor', 'retailer'], dated: true, rpc: 'report_expiry_loss', rowKey: (r, i) => `${r.batch_no}-${r.kind}-${i}`,
    columns: [d('doc_date', 'Date'), t('kind', 'Type', { render: r => <Badge tone={r.kind === 'expired_on_hand' ? 'bad' : 'warn'}>{KIND[String(r.kind)] ?? String(r.kind)}</Badge> }), t('medicine', 'Medicine'), t('batch_no', 'Batch'), q('units', 'Units'), m('value', 'Value')],
    summary: rows => [{ label: 'Written off in period', value: money(rows.filter(r => r.kind !== 'expired_on_hand').reduce((s, r) => s + n(r, 'value'), 0)), tone: 'warn' }, { label: 'Expired, still on shelf', value: money(rows.filter(r => r.kind === 'expired_on_hand').reduce((s, r) => s + n(r, 'value'), 0)), tone: 'bad' }] },
  { id: 'margin', label: 'Margin', roles: ['distributor', 'retailer'], dated: true, rpc: 'report_margin', rowKey: r => String(r.medicine_id),
    columns: [t('name', 'Medicine', { render: r => <><b>{r.name}</b> <span className="muted">{r.strength}</span></> }), q('units', 'Units sold'), m('revenue', 'Revenue (ex-GST)'), m('avg_cost', 'Avg cost'), m('cogs', 'Cost of goods'), m('margin', 'Margin'), t('margin_pct', 'Margin %', { align: 'right', render: r => (r.margin_pct == null ? '—' : `${r.margin_pct}%`), value: r => Number(r.margin_pct ?? 0) })],
    summary: rows => { const rev = rows.reduce((s, r) => s + n(r, 'revenue'), 0); const mar = rows.reduce((s, r) => s + n(r, 'margin'), 0); return [{ label: 'Revenue (ex-GST)', value: money(rev) }, { label: 'Gross margin', value: money(mar), tone: 'good' }, { label: 'Margin %', value: rev ? `${((mar / rev) * 100).toFixed(1)}%` : '—' }] },
    note: 'Cost is the weighted-average price you paid suppliers for that medicine. Items without purchase history show no margin.' },
  { id: 'ageing', label: 'Ageing', roles: ['manufacturer', 'distributor', 'retailer'], dated: false, rpc: 'report_ageing', rowKey: (r, i) => `${r.side}-${r.party}-${i}`,
    columns: [t('side', 'Side', { render: r => <Badge tone={r.side === 'receivable' ? 'good' : 'info'}>{r.side === 'receivable' ? 'They owe you' : 'You owe'}</Badge> }), t('party', 'Party'), m('not_due', 'Not due'), m('d1_30', '1–30 days'), m('d31_60', '31–60'), m('d61_90', '61–90'), m('d90_plus', '90+'), m('total', 'Total')],
    summary: rows => { const r = rows.filter(x => x.side === 'receivable'); const p = rows.filter(x => x.side === 'payable'); return [{ label: 'Receivable', value: money(r.reduce((s, x) => s + n(x, 'total'), 0)), tone: 'good' }, { label: 'Overdue receivable', value: money(r.reduce((s, x) => s + n(x, 'total') - n(x, 'not_due'), 0)), tone: 'bad' }, { label: 'Payable', value: money(p.reduce((s, x) => s + n(x, 'total'), 0)) }, { label: 'Overdue payable', value: money(p.reduce((s, x) => s + n(x, 'total') - n(x, 'not_due'), 0)), tone: 'warn' }] } },
  { id: 'close', label: 'Daily close', roles: ['retailer'], dated: false, rpc: 'report_daily_close', rowKey: r => String(r.mode),
    columns: [t('mode', 'Payment mode', { render: r => <b style={{ textTransform: 'capitalize' }}>{String(r.mode)}</b> }), q('bills', 'Bills'), m('gross', 'Gross'), m('refunds', 'Refunds'), m('net', 'Net')],
    summary: rows => [{ label: 'Bills', value: String(rows.reduce((s, r) => s + n(r, 'bills'), 0)) }, { label: 'Net takings', value: money(rows.reduce((s, r) => s + n(r, 'net'), 0)), tone: 'good' }, { label: 'Cash to bank', value: money(rows.filter(r => r.mode === 'cash').reduce((s, r) => s + n(r, 'net'), 0)) }] },
]

export default function Reports() {
  const { profile } = useAuth()
  const defs = REPORTS.filter(r => r.roles.includes(profile!.role))
  const [tab, setTab] = useState(defs[0].id)
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(today())
  const [day, setDay] = useState(today())
  const def = defs.find(x => x.id === tab) ?? defs[0]

  const { data, error, loading, reload } = useAsync(
    () => api.report(def.rpc, def.id === 'close' ? { p_date: day } : def.dated ? { p_from: from, p_to: to } : {}),
    [def.id, from, to, day],
  )
  const rows = data ?? []
  const summary = useMemo(() => (data && def.summary ? def.summary(data) : []), [data, def])
  const presets: [string, () => void][] = [['Today', () => { setFrom(today()); setTo(today()) }], ['7 days', () => { setFrom(daysAgo(6)); setTo(today()) }], ['30 days', () => { setFrom(daysAgo(29)); setTo(today()) }], ['This month', () => { setFrom(monthStart()); setTo(today()) }], ['This FY', () => { setFrom(fyStart()); setTo(today()) }]]

  return (
    <>
      <PageHeader title="Reports" subtitle="Sales, purchases, GST, stock and receivables — export to CSV or print"
        actions={<button className="btn" onClick={() => window.print()}><Printer size={16} /> Print</button>} />
      <Tabs value={def.id} onChange={setTab} tabs={defs.map(x => ({ id: x.id, label: x.label }))} />
      {def.dated && (
        <div className="row gap wrap filters">
          <label className="row gap small">From <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row gap small">To <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
          {presets.map(([l, fn]) => <button key={l} className="btn ghost sm" onClick={fn}>{l}</button>)}
        </div>
      )}
      {def.id === 'close' && <label className="row gap small">Day <input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)} style={{ width: 'auto' }} /></label>}
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <div className="print-area stack">
          {summary.length > 0 && <div className="stats">{summary.map(s => <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} />)}</div>}
          <DataTable rows={rows} columns={def.columns} rowKey={def.rowKey} exportName={`${def.id}-report`} pageSize={20} empty={{ title: 'No data for this selection' }} />
          {def.note && <p className="muted small">{def.note}</p>}
        </div>
      )}
    </>
  )
}
