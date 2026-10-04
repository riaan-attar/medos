import { QRCodeSVG } from 'qrcode.react'
import { fmtDate, money, num, outstanding } from '../lib/format'
import { amountInWords } from '../lib/gst'
import type { OrderBundle, Party } from '../lib/types'

function PartyBlock({ title, p, state }: { title: string; p: Party | null; state?: string }) {
  return (
    <div>
      <div className="doc-label">{title}</div>
      <b>{p?.org_name || p?.full_name || '—'}</b>
      {p?.address && <div>{p.address}</div>}
      {p?.city && <div>{p.city}{state ? `, ${state}` : ''}</div>}
      {p?.phone && <div>Ph: {p.phone}</div>}
      {p?.gstin && <div>GSTIN: {p.gstin}</div>}
    </div>
  )
}

// Printable invoice / packing slip. Wrapped in .print-area so window.print() shows only this.
export default function InvoiceDoc({ bundle, mode }: { bundle: OrderBundle; mode: 'invoice' | 'packing' }) {
  const { order: o, invoice: inv, shipments } = bundle
  const lines = o.order_items ?? []
  const consumer = o.buyer?.role === 'consumer'
  const link = `${window.location.origin}/orders/${o.id}`
  // batch + expiry per order line, from what was actually shipped
  const batchOf = (itemId: string) => shipments.flatMap(s => s.shipment_lines).filter(l => l.order_item_id === itemId)
  const gst = inv && !consumer
  return (
    <div className="print-area doc">
      <div className="doc-head">
        <div>
          <h2>{mode === 'invoice' ? (consumer ? 'Receipt' : 'Tax Invoice') : 'Packing Slip'}</h2>
          <div className="muted">{mode === 'invoice' ? inv?.invoice_no ?? 'Pending' : o.order_no}</div>
          <div className="muted small">Order {o.order_no} · {fmtDate(o.created_at)}</div>
          {inv && mode === 'invoice' && <div className="muted small">Due {fmtDate(inv.due_date)}{inv.place_of_supply && ` · Place of supply: ${inv.place_of_supply}`}</div>}
        </div>
        <QRCodeSVG value={link} size={72} />
      </div>
      <div className="doc-parties">
        <PartyBlock title="From" p={o.seller} />
        <PartyBlock title="Bill to" p={o.buyer} state={gst ? inv?.place_of_supply : undefined} />
      </div>

      {mode === 'invoice' ? (
        <>
          <table className="doc-table">
            <thead><tr><th>Item</th>{gst && <th>HSN</th>}<th>Batch / Exp</th><th className="r">Qty</th><th className="r">Rate</th>{gst && <th className="r">GST</th>}<th className="r">Amount</th></tr></thead>
            <tbody>{lines.map(i => (
              <tr key={i.id}>
                <td>{i.medicines.name} <span className="muted">{i.medicines.strength} · {i.medicines.pack_size}</span></td>
                {gst && <td>{i.medicines.hsn_code}</td>}
                <td className="small">{batchOf(i.id).length ? batchOf(i.id).map(l => `${l.batches?.batch_no} (${fmtDate(l.batches?.expiry_date)})`).join(', ') : '—'}</td>
                <td className="r">{num(i.quantity)}</td><td className="r">{money(i.unit_price)}</td>
                {gst && <td className="r">{i.gst_rate}%</td>}
                <td className="r">{money(i.quantity * i.unit_price)}</td>
              </tr>))}</tbody>
          </table>
          {inv && (
            <div className="doc-totals">
              <div><span>Taxable value</span><span>{money(inv.subtotal)}</span></div>
              {gst && inv.tax_breakup?.map(b => <div key={b.rate} className="muted small"><span>GST @ {b.rate}% on {money(b.taxable)}</span><span>{money(b.tax)}</span></div>)}
              {gst && Number(inv.cgst) > 0 && <><div><span>CGST</span><span>{money(inv.cgst)}</span></div><div><span>SGST</span><span>{money(inv.sgst)}</span></div></>}
              {gst && Number(inv.igst) > 0 && <div><span>IGST</span><span>{money(inv.igst)}</span></div>}
              <div className="grand"><span>Total</span><span>{money(inv.total)}</span></div>
              {inv.credit_total > 0 && <div><span>Credit notes</span><span>− {money(inv.credit_total)}</span></div>}
              {inv.paid_total > 0 && <div><span>Paid</span><span>− {money(inv.paid_total)}</span></div>}
              <div className="grand"><span>Balance due</span><span>{money(outstanding(inv))}</span></div>
            </div>
          )}
          {inv && <p className="small doc-words"><b>Amount in words:</b> {amountInWords(Number(inv.total))}</p>}
          {consumer && <p className="muted small">Prices are inclusive of applicable taxes.</p>}
        </>
      ) : (
        <>
          <table className="doc-table">
            <thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th className="r">Qty</th></tr></thead>
            <tbody>
              {shipments.flatMap(s => s.shipment_lines).map(l => (
                <tr key={l.id}><td>{l.order_items?.medicines.name} <span className="muted">{l.order_items?.medicines.strength}</span></td>
                  <td>{l.batches?.batch_no}</td><td>{fmtDate(l.batches?.expiry_date)}</td><td className="r">{num(l.quantity)}</td></tr>
              ))}
              {shipments.length === 0 && <tr><td colSpan={4} className="muted">Nothing shipped yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small doc-foot">{mode === 'invoice' && !consumer ? 'Subject to the jurisdiction of the seller’s city. ' : ''}Generated by MedOS · Scan the QR to open this order online.</p>
    </div>
  )
}
