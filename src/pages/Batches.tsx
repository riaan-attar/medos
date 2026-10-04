import { useRef, useState, type FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Eye, Plus, Printer, QrCode, ShieldAlert, Upload } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { parseCsv } from '../lib/csv'
import { errMsg, fmtDate, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, ErrorBox, Field, Modal, PageHeader, PromptModal, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import { useToast } from '../components/Toast'
import type { Batch, Medicine } from '../lib/types'

type B = Batch & { medicines: Medicine }
const today = () => new Date().toISOString().slice(0, 10)
const plusMonths = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10) }
const verifyUrl = (no: string) => `${window.location.origin}/check/${encodeURIComponent(no)}`

export default function Batches() {
  const { session } = useAuth()
  const uid = session!.user.id
  const toast = useToast()
  const batches = useAsync(() => api.myBatches(uid), [uid])
  const meds = useAsync(() => api.myMedicines(uid), [uid])
  const [creating, setCreating] = useState(false)
  const [recall, setRecall] = useState<B | null>(null)
  const [label, setLabel] = useState<B | null>(null)
  const [dist, setDist] = useState<B | null>(null)
  const [importing, setImporting] = useState(false)
  const [f, setF] = useState({ medicine_id: '', batch_no: '', mfg_date: today(), expiry_date: plusMonths(24), quantity: 1000 })
  const [busy, setBusy] = useState(false)

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await api.createBatch(f)
      toast.ok('Batch registered and added to your inventory'); setCreating(false)
      setF(p => ({ ...p, batch_no: '' })); batches.reload()
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }

  const noMeds = meds.data && meds.data.length === 0
  const cols: Column<B>[] = [
    { key: 'batch_no', header: 'Batch no.', render: b => <b>{b.batch_no}</b> },
    { key: 'med', header: 'Medicine', value: b => `${b.medicines.name} ${b.medicines.strength}`, render: b => <>{b.medicines.name} <span className="muted">{b.medicines.strength}</span></> },
    { key: 'mfg_date', header: 'Mfg', render: b => fmtDate(b.mfg_date) },
    { key: 'expiry_date', header: 'Expiry', render: b => fmtDate(b.expiry_date) },
    { key: 'quantity', header: 'Produced', align: 'right', render: b => num(b.quantity) },
    { key: 'status', header: 'Status', render: b => (b.status === 'recalled' ? <Badge tone="bad">recalled</Badge> : <Badge tone="good">active</Badge>) },
    { key: 'act', header: '', noSort: true, noCsv: true, align: 'right', render: b => (
      <div className="row gap end">
        <button className="btn ghost sm" title="Where is this batch now?" onClick={() => setDist(b)}><Eye size={14} /> Track</button>
        <button className="btn ghost sm" onClick={() => setLabel(b)}><QrCode size={14} /> Label</button>
        {b.status === 'active' && <button className="btn danger sm" onClick={() => setRecall(b)}><ShieldAlert size={14} /> Recall</button>}
      </div>) },
  ]

  return (
    <>
      <PageHeader title="Batches & recalls" subtitle="Register what comes off the line. Every unit is traceable from here."
        actions={<>
          <button className="btn" disabled={!!noMeds} onClick={() => setImporting(true)}><Upload size={16} /> Import CSV</button>
          <button className="btn primary" disabled={!!noMeds} onClick={() => { setF(p => ({ ...p, medicine_id: p.medicine_id || meds.data?.[0]?.id || '' })); setCreating(true) }}><Plus size={16} /> New batch</button>
        </>} />
      {noMeds && <Alert>Add a medicine to your catalog first.</Alert>}
      {batches.loading && !batches.data && <Skeleton />}
      {batches.error && <ErrorBox message={batches.error} onRetry={batches.reload} />}
      {batches.data && <DataTable rows={batches.data} columns={cols} rowKey={b => b.id} exportName="batches" searchPlaceholder="Search batches…" initialSort={{ key: 'expiry_date', dir: 'asc' }}
        empty={{ title: 'No batches yet', hint: 'Register your first production batch.' }} />}

      {creating && (
        <Modal title="Register batch" onClose={() => setCreating(false)}>
          <form onSubmit={create} className="stack">
            <Field label="Medicine">
              <select required value={f.medicine_id} onChange={e => setF({ ...f, medicine_id: e.target.value })}>
                {meds.data?.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name} {m.strength} ({m.pack_size})</option>)}
              </select>
            </Field>
            <div className="grid2">
              <Field label="Batch number"><input required value={f.batch_no} onChange={e => setF({ ...f, batch_no: e.target.value })} placeholder="e.g. PCM-2610-A" /></Field>
              <Field label="Quantity (packs)"><input type="number" min="1" required value={f.quantity} onChange={e => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
              <Field label="Manufacturing date"><input type="date" required value={f.mfg_date} onChange={e => setF({ ...f, mfg_date: e.target.value })} /></Field>
              <Field label="Expiry date"><input type="date" required value={f.expiry_date} onChange={e => setF({ ...f, expiry_date: e.target.value })} /></Field>
            </div>
            <div className="row gap end"><button type="button" className="btn ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={busy}>Register batch</button></div>
          </form>
        </Modal>
      )}

      {recall && (
        <PromptModal title={`Recall ${recall.batch_no}`} label={`This blocks all further sales and shipments of ${recall.medicines.name} batch ${recall.batch_no} and notifies every current holder. It cannot be undone. Reason:`}
          confirmLabel="Recall batch" tone="danger" required onClose={() => setRecall(null)}
          onSubmit={async reason => {
            try { const n = await api.recallBatch(recall.id, reason); toast.ok(`Batch recalled. ${n} holder(s) notified.`); setRecall(null); batches.reload() } catch (x) { toast.err(errMsg(x)) }
          }} />
      )}
      {label && <LabelModal b={label} onClose={() => setLabel(null)} />}
      {dist && <DistributionModal b={dist} onClose={() => setDist(null)} />}
      {importing && meds.data && <ImportModal meds={meds.data} onClose={() => setImporting(false)} onDone={() => { setImporting(false); batches.reload() }} />}
    </>
  )
}

function LabelModal({ b, onClose }: { b: B; onClose: () => void }) {
  const toast = useToast()
  const url = verifyUrl(b.batch_no)
  return (
    <Modal title="Batch label" onClose={onClose}>
      <div className="print-area label-sheet">
        <div className="label-card">
          <QRCodeSVG value={url} size={150} level="M" />
          <div>
            <b>{b.medicines.name}</b> <span>{b.medicines.strength}</span>
            <div>Batch: <b>{b.batch_no}</b></div>
            <div>Mfg: {fmtDate(b.mfg_date)} · Exp: {fmtDate(b.expiry_date)}</div>
            <div>MRP: ₹{b.medicines.mrp} ({b.medicines.pack_size})</div>
            <small>Scan to verify authenticity</small>
          </div>
        </div>
      </div>
      <p className="muted small">Link: {url}</p>
      <div className="row gap end no-print">
        <button className="btn" onClick={() => { void navigator.clipboard.writeText(url); toast.ok('Link copied') }}><Copy size={16} /> Copy link</button>
        <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> Print label</button>
      </div>
    </Modal>
  )
}

function DistributionModal({ b, onClose }: { b: B; onClose: () => void }) {
  const { data, error, loading } = useAsync(() => api.distribution(b.id), [b.id])
  const total = (data ?? []).reduce((s, d) => s + d.quantity, 0)
  return (
    <Modal title={`Where is ${b.batch_no}?`} onClose={onClose} wide>
      {loading && <Skeleton rows={3} />}
      {error && <ErrorBox message={error} />}
      {data && data.length === 0 && <p className="muted">No units currently held by anyone.</p>}
      {data && data.length > 0 && (
        <>
          <p className="muted">{num(total)} units across {data.length} holder(s).</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Holder</th><th>Type</th><th className="r">Units</th>{b.status === 'recalled' && <th>Recall response</th>}</tr></thead>
            <tbody>{data.map(d => (
              <tr key={d.owner_id}><td><b>{d.org_name}</b></td><td className="muted">{d.role}</td><td className="r">{num(d.quantity)}</td>
                {b.status === 'recalled' && <td>{d.ack_status ? <Badge tone="good">{d.ack_status}</Badge> : <Badge tone="warn">no response</Badge>}{d.ack_note && <div className="muted small">{d.ack_note}</div>}</td>}</tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </Modal>
  )
}

const HEAD = ['medicine', 'batch_no', 'quantity', 'mfg_date', 'expiry_date']
function ImportModal({ meds, onClose, onDone }: { meds: Medicine[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<{ line: number; med?: Medicine; batch_no: string; quantity: number; mfg: string; exp: string; err?: string }[]>([])
  const [busy, setBusy] = useState(false)

  async function pick(f: File) {
    const parsed = parseCsv(await f.text())
    const header = parsed[0]?.map(h => h.trim().toLowerCase()) ?? []
    const idx = (k: string) => header.indexOf(k)
    if (HEAD.some(h => idx(h) < 0)) { toast.err(`CSV needs columns: ${HEAD.join(', ')}`); return }
    setRows(parsed.slice(1).map((r, i) => {
      const name = r[idx('medicine')]?.trim().toLowerCase()
      const med = meds.find(m => `${m.name} ${m.strength}`.trim().toLowerCase() === name || m.name.toLowerCase() === name)
      const q = Number(r[idx('quantity')])
      const x = { line: i + 2, med, batch_no: r[idx('batch_no')]?.trim() ?? '', quantity: q, mfg: r[idx('mfg_date')]?.trim() ?? '', exp: r[idx('expiry_date')]?.trim() ?? '' }
      const err = !med ? 'Unknown medicine' : !x.batch_no ? 'Missing batch no.' : !(q > 0) ? 'Bad quantity' : !x.mfg || !x.exp ? 'Missing date' : undefined
      return { ...x, err }
    }))
  }

  async function run() {
    setBusy(true); let ok = 0; const fails: string[] = []
    for (const r of rows.filter(x => !x.err)) {
      try { await api.createBatch({ medicine_id: r.med!.id, batch_no: r.batch_no, mfg_date: r.mfg, expiry_date: r.exp, quantity: r.quantity }); ok++ }
      catch (x) { fails.push(`Line ${r.line}: ${errMsg(x)}`) }
    }
    setBusy(false)
    if (fails.length) toast.err(`${ok} imported, ${fails.length} failed — ${fails[0]}`); else toast.ok(`${ok} batches imported`)
    onDone()
  }
  const valid = rows.filter(r => !r.err).length

  return (
    <Modal title="Import batches from CSV" onClose={onClose} wide>
      <p className="muted">Columns: <code>{HEAD.join(', ')}</code>. Medicine must match a name in your catalog. Dates as YYYY-MM-DD.</p>
      <input ref={file} type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && pick(e.target.files[0])} />
      {rows.length > 0 && (
        <>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}><table>
            <thead><tr><th>Line</th><th>Medicine</th><th>Batch</th><th className="r">Qty</th><th>Mfg</th><th>Expiry</th><th>Check</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.line}><td>{r.line}</td><td>{r.med?.name ?? '—'}</td><td>{r.batch_no}</td><td className="r">{r.quantity}</td><td>{r.mfg}</td><td>{r.exp}</td>
                <td>{r.err ? <Badge tone="bad">{r.err}</Badge> : <Badge tone="good">ok</Badge>}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="row gap end"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || valid === 0} onClick={run}>{busy ? 'Importing…' : `Import ${valid} batch(es)`}</button></div>
        </>
      )}
    </Modal>
  )
}
