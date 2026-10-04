import { fmtDateTime, money } from '../lib/format'
import type { Profile, SaleBill } from '../lib/types'

export default function ReceiptDoc({ bill, shop }: { bill: SaleBill; shop: Profile }) {
  const lines = bill.sale_bill_lines ?? []
  return (
    <div className="print-area receipt">
      <div className="center">
        <h3>{shop.org_name}</h3>
        {shop.address && <div className="small">{shop.address}</div>}
        <div className="small">{[shop.city, shop.phone].filter(Boolean).join(' · ')}</div>
        {shop.gstin && <div className="small">GSTIN: {shop.gstin}</div>}
      </div>
      <hr />
      <div className="row between small"><span>{bill.bill_no}</span><span>{fmtDateTime(bill.created_at)}</span></div>
      {(bill.customer_name || bill.customer_phone) && <div className="small">Customer: {bill.customer_name} {bill.customer_phone}</div>}
      <table className="doc-table">
        <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amt</th></tr></thead>
        <tbody>{lines.map(l => (
          <tr key={l.id}><td>{l.medicines?.name} <span className="muted small">{l.medicines?.strength}</span><div className="muted small">B: {l.batches?.batch_no}</div></td>
            <td className="r">{l.quantity}</td><td className="r">{money(l.unit_price)}</td><td className="r">{money(l.quantity * l.unit_price)}</td></tr>))}</tbody>
      </table>
      <div className="doc-totals">
        <div><span>Subtotal</span><span>{money(bill.subtotal)}</span></div>
        {bill.discount > 0 && <div><span>Discount</span><span>− {money(bill.discount)}</span></div>}
        <div className="grand"><span>Total</span><span>{money(bill.total)}</span></div>
        {bill.refunded_total > 0 && <div><span>Refunded</span><span>− {money(bill.refunded_total)}</span></div>}
        <div><span>Paid by</span><span>{bill.payment_mode.toUpperCase()}</span></div>
      </div>
      <p className="center small muted">MRP inclusive of all taxes. Thank you!</p>
    </div>
  )
}
