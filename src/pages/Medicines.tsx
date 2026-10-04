import { useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { errMsg, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, ErrorBox, Field, Modal, PageHeader, Skeleton } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import { useToast } from '../components/Toast'
import type { Medicine } from '../lib/types'

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler', 'Powder', 'Other']
const GST = [0, 5, 12, 18, 28]

export default function Medicines() {
  const { session } = useAuth()
  const uid = session!.user.id
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.myMedicines(uid), [uid])
  const [editing, setEditing] = useState<Partial<Medicine> | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    try {
      await api.saveMedicine({ ...editing, manufacturer_id: uid })
      toast.ok('Medicine saved'); setEditing(null); reload()
    } catch (x) { toast.err(errMsg(x)) } finally { setBusy(false) }
  }
  const set = <K extends keyof Medicine>(k: K, v: Medicine[K]) => setEditing(p => ({ ...p, [k]: v }))

  const cols: Column<Medicine>[] = [
    { key: 'name', header: 'Medicine', render: m => <><b>{m.name}</b><div className="muted small">{m.category}</div></>, value: m => `${m.name} ${m.category}` },
    { key: 'generic_name', header: 'Generic' },
    { key: 'dosage_form', header: 'Form' },
    { key: 'strength', header: 'Strength' },
    { key: 'pack_size', header: 'Pack' },
    { key: 'mrp', header: 'MRP', align: 'right', render: m => money(m.mrp) },
    { key: 'gst_rate', header: 'GST', align: 'right', render: m => `${m.gst_rate}%` },
    { key: 'requires_rx', header: 'Rx', value: m => (m.requires_rx ? 'Rx' : ''), render: m => (m.requires_rx ? <Badge tone="info">Rx</Badge> : '—') },
    { key: 'active', header: 'Status', value: m => (m.active ? 'active' : 'inactive'), render: m => (m.active ? <Badge tone="good">active</Badge> : <Badge>inactive</Badge>) },
    { key: 'act', header: '', noSort: true, noCsv: true, align: 'right', render: m => <button className="btn ghost sm" onClick={() => setEditing(m)}><Pencil size={14} /> Edit</button> },
  ]

  return (
    <>
      <PageHeader title="Medicine catalog" subtitle="Products you manufacture. Add one before producing a batch."
        actions={<button className="btn primary" onClick={() => setEditing({ dosage_form: 'Tablet', category: 'General', requires_rx: false, gst_rate: 12 })}><Plus size={16} /> New medicine</button>} />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DataTable rows={data} columns={cols} rowKey={m => m.id} exportName="medicines" searchPlaceholder="Search medicines…"
        empty={{ title: 'No medicines yet', hint: 'Create your first product to start producing batches.' }} />}

      {editing && (
        <Modal title={editing.id ? 'Edit medicine' : 'New medicine'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="stack">
            <div className="grid2">
              <Field label="Brand name"><input required value={editing.name ?? ''} onChange={e => set('name', e.target.value)} /></Field>
              <Field label="Generic / salt"><input value={editing.generic_name ?? ''} onChange={e => set('generic_name', e.target.value)} /></Field>
              <Field label="Category"><input value={editing.category ?? ''} onChange={e => set('category', e.target.value)} placeholder="Antibiotic, Analgesic…" /></Field>
              <Field label="Dosage form">
                <select value={editing.dosage_form ?? 'Tablet'} onChange={e => set('dosage_form', e.target.value)}>{FORMS.map(f => <option key={f}>{f}</option>)}</select>
              </Field>
              <Field label="Strength"><input value={editing.strength ?? ''} onChange={e => set('strength', e.target.value)} placeholder="500 mg" /></Field>
              <Field label="Pack size"><input value={editing.pack_size ?? ''} onChange={e => set('pack_size', e.target.value)} placeholder="10 tablets" /></Field>
              <Field label="MRP (₹ per pack)" hint="No seller can list above this"><input type="number" step="0.01" min="0" required value={editing.mrp ?? ''} onChange={e => set('mrp', Number(e.target.value))} /></Field>
              <Field label="GST rate">
                <select value={editing.gst_rate ?? 12} onChange={e => set('gst_rate', Number(e.target.value))}>{GST.map(g => <option key={g} value={g}>{g}%</option>)}</select>
              </Field>
              <Field label="Barcode (optional)" hint="Used for quick lookup at the counter"><input value={editing.barcode ?? ''} onChange={e => set('barcode', e.target.value)} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={!!editing.requires_rx} onChange={e => set('requires_rx', e.target.checked)} /> Prescription required</label>
            {editing.id && <label className="check"><input type="checkbox" checked={editing.active ?? true} onChange={e => set('active', e.target.checked)} /> Active</label>}
            <div className="row gap end"><button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
    </>
  )
}
