import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackageSearch, ShoppingCart } from 'lucide-react'
import { api } from '../lib/api'
import { errMsg, money, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Badge, Empty, ErrorBox, PageHeader, ProgressBar, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import type { ReorderSuggestion } from '../lib/types'

export default function Reorder() {
  const nav = useNavigate()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.reorderSuggestions(), [])
  const [busy, setBusy] = useState<string | null>(null)

  const bySupplier = new Map<string, ReorderSuggestion[]>()
  const unsupplied: ReorderSuggestion[] = []
  for (const s of data ?? []) {
    if (!s.supplier_id) unsupplied.push(s)
    else bySupplier.set(s.supplier_id, [...(bySupplier.get(s.supplier_id) ?? []), s])
  }

  function review(sid: string, list: ReorderSuggestion[]) {
    const prefill = list.map(x => `${x.medicine_id}:${Math.min(x.suggested_qty, x.supplier_available ?? x.suggested_qty)}`).join(',')
    nav(`/marketplace?seller=${sid}&prefill=${prefill}`)
  }

  async function orderNow(sid: string, list: ReorderSuggestion[]) {
    setBusy(sid)
    try {
      const id = await api.placeOrder(sid, list.map(x => ({ medicine_id: x.medicine_id, quantity: Math.min(x.suggested_qty, x.supplier_available ?? x.suggested_qty) })), 'Auto-reorder from suggestions')
      toast.ok('Order placed'); nav(`/orders/${id}`)
    } catch (x) { toast.err(errMsg(x)); reload() } finally { setBusy(null) }
  }

  return (
    <>
      <PageHeader title="Reorder suggestions" subtitle="Medicines below your reorder level, matched to the cheapest supplier who has stock" />
      {loading && !data && <Skeleton />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty icon={<PackageSearch size={26} />} title="Everything is well stocked" hint="Suggestions appear when a medicine drops below its reorder level (set it in Inventory → Pricing)." />}
      {[...bySupplier.entries()].map(([sid, list]) => (
        <section key={sid} className="card">
          <div className="row between wrap">
            <h2>{list[0].supplier_name}</h2>
            <div className="row gap">
              <button className="btn" onClick={() => review(sid, list)}>Review in catalog</button>
              <button className="btn primary" disabled={busy === sid} onClick={() => orderNow(sid, list)}><ShoppingCart size={16} /> Order all ({list.length})</button>
            </div>
          </div>
          <div className="table-wrap flat"><table>
            <thead><tr><th>Medicine</th><th>Stock vs level</th><th className="r">Suggested</th><th className="r">Price</th><th className="r">Est. cost</th></tr></thead>
            <tbody>{list.map(x => {
              const qty = Math.min(x.suggested_qty, x.supplier_available ?? x.suggested_qty)
              return (
                <tr key={x.medicine_id}>
                  <td><b>{x.name}</b> <span className="muted">{x.strength} · {x.pack_size}</span></td>
                  <td style={{ minWidth: 150 }}>{num(x.available)} / {num(x.reorder_level)}<ProgressBar value={x.available} max={x.reorder_level} tone={x.available === 0 ? 'bad' : 'warn'} /></td>
                  <td className="r">{num(qty)}{qty < x.suggested_qty && <div className="muted small">supplier has {num(x.supplier_available ?? 0)}</div>}</td>
                  <td className="r">{money(x.unit_price)}</td><td className="r">{money((x.unit_price ?? 0) * qty)}</td>
                </tr>)
            })}</tbody>
          </table></div>
        </section>
      ))}
      {unsupplied.length > 0 && (
        <section className="card">
          <h2>No supplier has stock</h2>
          <ul className="plain">{unsupplied.map(x => <li key={x.medicine_id} className="row between"><span><b>{x.name}</b> <span className="muted">{x.strength}</span></span><Badge tone="bad">{num(x.available)} left</Badge></li>)}</ul>
        </section>
      )}
    </>
  )
}
