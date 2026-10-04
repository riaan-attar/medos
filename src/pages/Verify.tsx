import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, QrCode, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { api } from '../lib/api'
import { fmtDate, fmtDateTime, money } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, Badge, Empty, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import type { VerifyResult } from '../lib/types'

// Authenticity check + chain of custody. `standalone` = public page (no login, no sidebar).
export default function Verify({ standalone }: { standalone?: boolean }) {
  const { batchNo } = useParams()
  const nav = useNavigate()
  const [q, setQ] = useState(batchNo ?? '')
  const { data, error, loading } = useAsync(
    () => (batchNo ? api.verifyBatch(batchNo) : Promise.resolve<VerifyResult[] | null>(null)) as Promise<VerifyResult[] | null>,
    [batchNo],
  )

  function submit(e: FormEvent) {
    e.preventDefault()
    if (q.trim()) nav(`${standalone ? '/check' : '/verify'}/${encodeURIComponent(q.trim())}`)
  }

  const body = (
    <>
      <form className="row gap" onSubmit={submit}>
        <div className="search-box wide grow"><QrCode size={16} /><input placeholder="Enter the batch number printed on the pack" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
        <button className="btn primary">Verify</button>
      </form>
      {loading && <Skeleton rows={3} />}
      {error && <ErrorBox message={error} />}
      {data && data.length === 0 && (
        <Alert tone="err"><b>No record found.</b> This batch number is not registered by any manufacturer on MedOS. Treat the product with caution and report it to the seller.</Alert>
      )}
      {data?.map(r => <Result key={r.batch_id} r={r} />)}
      {!batchNo && <Empty icon={<ShieldCheck size={26} />} title="Check a batch" hint="Find the batch number (usually “Batch No.” or “B.No.”) on the strip or box, or scan the QR label." />}
    </>
  )

  if (standalone) {
    return <div className="center-screen top"><div className="card wide-card stack">
      <Link to="/" className="brand"><span className="logo">✚</span> MedOS · Verify medicine</Link>
      {body}
      <p className="center"><Link to="/login">Sign in</Link> · <Link to="/signup">Create account</Link></p>
    </div></div>
  }
  return <><PageHeader title="Verify batch" subtitle="Authenticity, expiry, recall status and chain of custody" />{body}</>
}

function Result({ r }: { r: VerifyResult }) {
  const recalled = r.status === 'recalled'
  const bad = recalled || r.expired
  const Icon = recalled ? ShieldX : r.expired ? ShieldAlert : ShieldCheck
  return (
    <section className={`card verify ${bad ? 'bad' : 'good'}`}>
      <div className="verdict">
        <Icon size={34} />
        <div>
          <h2>{recalled ? 'Recalled — do not use' : r.expired ? 'Expired — do not use' : 'Genuine · registered & valid'}</h2>
          <div className="muted">{r.medicine} {r.strength} · {r.dosage_form}</div>
        </div>
      </div>
      {recalled && <Alert tone="err">Recall reason: {r.recall_reason || 'not specified'}. Return the pack to your pharmacy.</Alert>}
      <dl className="kv">
        <dt>Batch</dt><dd>{r.batch_no}</dd>
        <dt>Manufacturer</dt><dd>{r.manufacturer} {r.manufacturer_verified && <Badge tone="good">verified</Badge>}</dd>
        <dt>Manufactured</dt><dd>{fmtDate(r.mfg_date)}</dd>
        <dt>Expires</dt><dd>{fmtDate(r.expiry_date)}</dd>
        <dt>MRP</dt><dd>{money(r.mrp)} per pack</dd>
      </dl>
      <h3>Chain of custody</h3>
      <ol className="chain">
        <li><CheckCircle2 size={14} /> <b>{r.manufacturer}</b> <span className="muted">manufactured</span></li>
        {r.custody.map((c, i) => <li key={i}><CheckCircle2 size={14} /> <b>{c.to}</b> <span className="muted">received from {c.from} · {fmtDateTime(c.at)}</span></li>)}
      </ol>
      {r.custody.length === 0 && <p className="muted small">No trade transfers recorded yet — still with the manufacturer.</p>}
    </section>
  )
}
