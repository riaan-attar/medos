// End-to-end check of the whole supply chain against a live Supabase project.
// Prereqs: both migrations applied and `node scripts/seed.mjs` run (needs the demo accounts).
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/e2e.mjs
// It creates a uniquely-named medicine ("E2E-<timestamp>") so it never touches your seeded stock.
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY'); process.exit(1) }
const PASSWORD = 'Demo@1234'
const mk = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })

let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✓', name) } else { failed++; console.log('  ✗', name, extra) }
}
const expectFail = async (name, p, pattern) => {
  const { error } = await p
  check(name, !!error && (!pattern || pattern.test(error.message)), error ? `(got: ${error.message})` : '(expected an error, got success)')
}
const must = async (label, p) => {
  const r = await p
  if (r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.data
}

const who = { mfr: 'factory', dist: 'dealer', ret1: 'pharmacy1', ret2: 'pharmacy2', user: 'customer', admin: 'admin' }
const c = {}, id = {}
for (const [k, e] of Object.entries(who)) {
  c[k] = mk()
  const { data, error } = await c[k].auth.signInWithPassword({ email: `${e}@medos.demo`, password: PASSWORD })
  if (error) throw new Error(`Sign-in failed for ${e}@medos.demo — run scripts/seed.mjs first (${error.message})`)
  id[k] = data.user.id
}
const rpc = (k, fn, args) => c[k].rpc(fn, args)
const inv = async (k, batchId) => (await c[k].from('inventory').select('quantity, reserved').eq('owner_id', id[k]).eq('batch_id', batchId).maybeSingle()).data

const tag = `E2E-${Date.now()}`
const iso = m => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10) }

console.log('\n[1] Production')
const med = await must('medicine', c.mfr.from('medicines').insert({ manufacturer_id: id.mfr, name: tag, generic_name: 'E2E-Salt', strength: '10 mg', pack_size: '10', mrp: 100, gst_rate: 12 }).select().single())
const batchNo = `${tag}-A`
const batchId = await must('create_batch', rpc('mfr', 'create_batch', { p_medicine_id: med.id, p_batch_no: batchNo, p_mfg_date: iso(-1), p_expiry_date: iso(12), p_quantity: 1000 }))
check('manufacturer holds 1000 units', (await inv('mfr', batchId))?.quantity === 1000)
await expectFail('consumer cannot create batches', rpc('user', 'create_batch', { p_medicine_id: med.id, p_batch_no: 'X', p_mfg_date: iso(-1), p_expiry_date: iso(5), p_quantity: 1 }), /Only manufacturers/)
await expectFail('price above MRP is rejected', c.mfr.from('listings').update({ unit_price: 500 }).eq('owner_id', id.mfr).eq('medicine_id', med.id).select(), /exceeds MRP/)

console.log('\n[2] Order → accept (reservation + invoice)')
await expectFail('retailer→consumer purchase blocked by trade rules', rpc('ret1', 'place_order', { p_seller: id.user, p_items: [{ medicine_id: med.id, quantity: 1 }] }))
await expectFail('over-ordering is rejected', rpc('dist', 'place_order', { p_seller: id.mfr, p_items: [{ medicine_id: med.id, quantity: 5000 }] }), /Insufficient/)
const o1 = await must('place_order', rpc('dist', 'place_order', { p_seller: id.mfr, p_items: [{ medicine_id: med.id, quantity: 300 }], p_notes: 'e2e' }))
await expectFail('buyer cannot accept own order', rpc('dist', 'advance_order', { p_order_id: o1, p_action: 'accept', p_note: '' }))
await must('accept', rpc('mfr', 'advance_order', { p_order_id: o1, p_action: 'accept', p_note: '' }))
const afterAccept = await inv('mfr', batchId)
check('300 units reserved at accept', afterAccept?.reserved === 300 && afterAccept?.quantity === 1000, JSON.stringify(afterAccept))
const invoice = (await c.dist.from('invoices').select('*').eq('order_id', o1).single()).data
check('invoice created, unpaid', invoice?.status === 'unpaid')
check('invoice carries 12% GST', invoice && Math.abs(invoice.tax - invoice.subtotal * 0.12) < 0.02, JSON.stringify(invoice))
check('buyer cannot read seller inventory (RLS)', ((await c.dist.from('inventory').select('id').eq('owner_id', id.mfr)).data ?? []).length === 0)
check('other retailer cannot read the order (RLS)', ((await c.ret2.from('orders').select('id').eq('id', o1)).data ?? []).length === 0)

console.log('\n[3] Partial shipment, receipt')
const items = (await c.mfr.from('order_items').select('id').eq('order_id', o1)).data
await must('ship 100', rpc('mfr', 'ship_order', { p_order_id: o1, p_quantities: { [items[0].id]: 100 }, p_eta: iso(0), p_tracking: 'e2e truck' }))
check('status partially_shipped', (await c.mfr.from('orders').select('status').eq('id', o1).single()).data.status === 'partially_shipped')
const s1 = (await c.dist.from('shipments').select('id').eq('order_id', o1)).data[0]
await must('receive shipment 1', rpc('dist', 'receive_shipment', { p_shipment_id: s1.id }))
check('distributor received 100', (await inv('dist', batchId))?.quantity === 100)
check('manufacturer reservation now 200', (await inv('mfr', batchId))?.reserved === 200)
await must('ship remaining', rpc('mfr', 'ship_order', { p_order_id: o1, p_quantities: null, p_eta: null, p_tracking: '' }))
await must('receive all', rpc('dist', 'advance_order', { p_order_id: o1, p_action: 'receive', p_note: '' }))
check('order delivered', (await c.mfr.from('orders').select('status').eq('id', o1).single()).data.status === 'delivered')
check('distributor holds 300', (await inv('dist', batchId))?.quantity === 300)
const mAfter = await inv('mfr', batchId)
check('manufacturer 700 on hand, 0 reserved', mAfter?.quantity === 700 && mAfter?.reserved === 0, JSON.stringify(mAfter))

console.log('\n[4] Payments & returns')
const due = invoice.total
await expectFail('overpayment rejected', rpc('mfr', 'record_payment', { p_invoice_id: invoice.id, p_amount: due + 100, p_method: 'bank', p_reference: '', p_note: '' }), /exceeds/)
await must('part payment', rpc('mfr', 'record_payment', { p_invoice_id: invoice.id, p_amount: 100, p_method: 'upi', p_reference: 'UTR1', p_note: '' }))
check('invoice partial', (await c.mfr.from('invoices').select('status').eq('id', invoice.id).single()).data.status === 'partial')
await expectFail('buyer cannot record payment', rpc('dist', 'record_payment', { p_invoice_id: invoice.id, p_amount: 1, p_method: 'cash', p_reference: '', p_note: '' }))
const ret = await must('request_return', rpc('dist', 'request_return', { p_order_id: o1, p_items: [{ batch_id: batchId, quantity: 10 }], p_reason: 'Damaged on arrival' }))
await expectFail('cannot return more than received', rpc('dist', 'request_return', { p_order_id: o1, p_items: [{ batch_id: batchId, quantity: 999 }], p_reason: '' }), /Invalid return/)
await must('approve return', rpc('mfr', 'respond_return', { p_return_id: ret, p_action: 'approve', p_note: '' }))
check('stock moved back (mfr 710, dist 290)', (await inv('mfr', batchId))?.quantity === 710 && (await inv('dist', batchId))?.quantity === 290)
const invAfter = (await c.mfr.from('invoices').select('*').eq('id', invoice.id).single()).data
check('credit note applied to invoice', invAfter.credit_total > 0, JSON.stringify(invAfter))
const rest = invAfter.total - invAfter.credit_total - invAfter.paid_total
await must('settle remainder', rpc('mfr', 'record_payment', { p_invoice_id: invoice.id, p_amount: Math.round(rest * 100) / 100, p_method: 'bank', p_reference: 'UTR2', p_note: '' }))
check('invoice paid', (await c.mfr.from('invoices').select('status').eq('id', invoice.id).single()).data.status === 'paid')

console.log('\n[5] Retailer, POS, customer')
const o2 = await must('retailer order', rpc('ret1', 'place_order', { p_seller: id.dist, p_items: [{ medicine_id: med.id, quantity: 50 }] }))
await must('accept', rpc('dist', 'advance_order', { p_order_id: o2, p_action: 'accept', p_note: '' }))
await must('ship', rpc('dist', 'ship_order', { p_order_id: o2, p_quantities: null, p_eta: null, p_tracking: '' }))
await must('receive', rpc('ret1', 'advance_order', { p_order_id: o2, p_action: 'receive', p_note: '' }))
check('retailer holds 50', (await inv('ret1', batchId))?.quantity === 50)
const bill = await must('create_bill', rpc('ret1', 'create_bill', { p_lines: [{ medicine_id: med.id, quantity: 5 }], p_customer_name: 'E2E', p_customer_phone: '9999900000', p_discount: 5, p_payment_mode: 'cash' }))
check('POS deducted 5', (await inv('ret1', batchId))?.quantity === 45)
const lines = (await c.ret1.from('sale_bill_lines').select('id').eq('bill_id', bill)).data
await must('refund 2', rpc('ret1', 'refund_bill', { p_bill_id: bill, p_lines: [{ line_id: lines[0].id, quantity: 2 }], p_reason: 'e2e' }))
check('refund restored stock to 47', (await inv('ret1', batchId))?.quantity === 47)
check('other retailer cannot see bills (RLS)', ((await c.ret2.from('sale_bills').select('id').eq('id', bill)).data ?? []).length === 0)
await expectFail('POS price above MRP rejected', rpc('ret1', 'create_bill', { p_lines: [{ medicine_id: med.id, quantity: 1, unit_price: 999 }] }), /exceeds MRP/)
const o3 = await must('customer reservation', rpc('user', 'place_order', { p_seller: id.ret1, p_items: [{ medicine_id: med.id, quantity: 3 }] }))
await must('accept', rpc('ret1', 'advance_order', { p_order_id: o3, p_action: 'accept', p_note: '' }))
await must('hand over', rpc('ret1', 'ship_order', { p_order_id: o3, p_quantities: null, p_eta: null, p_tracking: '' }))
check('customer order fulfilled', (await c.user.from('orders').select('status').eq('id', o3).single()).data.status === 'delivered')
check('customer invoice auto-paid', (await c.user.from('invoices').select('status').eq('order_id', o3).single()).data.status === 'paid')
await must('review', rpc('user', 'submit_review', { p_order_id: o3, p_rating: 5, p_comment: 'Quick!' }))
const search = await must('search_availability', rpc('user', 'search_availability', { p_query: tag, p_lat: 18.52, p_lng: 73.85 }))
check('customer finds the pharmacy with rating', search.length >= 1 && Number(search[0].rating_avg) === 5)

console.log('\n[6] Traceability, credit limit, recall')
const trace = await must('verify_batch (anon)', mk().rpc('verify_batch', { p_batch_no: batchNo }))
check('public verify returns custody chain of 2 hops', trace.length === 1 && trace[0].custody.length === 2, JSON.stringify(trace[0]?.custody))
await must('set credit limit 1', c.mfr.from('trade_relations').upsert({ seller_id: id.mfr, buyer_id: id.dist, credit_limit: 1, discount_pct: 0 }, { onConflict: 'seller_id,buyer_id' }))
await expectFail('order blocked by credit limit', rpc('dist', 'place_order', { p_seller: id.mfr, p_items: [{ medicine_id: med.id, quantity: 10 }] }), /Credit limit/)
await must('restore seeded terms', c.mfr.from('trade_relations').upsert({ seller_id: id.mfr, buyer_id: id.dist, credit_limit: 500000, discount_pct: 2 }, { onConflict: 'seller_id,buyer_id' }))
const notified = await must('recall', rpc('mfr', 'recall_batch', { p_batch_id: batchId, p_reason: 'e2e recall' }))
check('recall notified downstream holders', notified >= 2, `notified=${notified}`)
await must('ack', rpc('ret1', 'ack_recall', { p_batch_id: batchId, p_status: 'quarantined', p_note: '' }))
await expectFail('recalled stock cannot be sold', rpc('ret1', 'create_bill', { p_lines: [{ medicine_id: med.id, quantity: 1 }] }), /Not enough sellable/)
check('public verify now shows recalled', (await mk().rpc('verify_batch', { p_batch_no: batchNo })).data[0].status === 'recalled')
const dist = await must('distribution', rpc('mfr', 'batch_distribution', { p_batch_id: batchId }))
check('recall distribution lists holders with acks', dist.some(d => d.ack_status === 'quarantined'))

console.log('\n[7] Analytics & admin')
const an = await must('analytics', rpc('dist', 'dashboard_analytics', {}))
check('analytics returns expiry buckets & receivable keys', an.expiry_buckets && 'receivable' in an)
const stats = await must('dashboard_stats', rpc('mfr', 'dashboard_stats', {}))
check('dashboard stats ok', typeof stats.total_units === 'number')
await expectFail('non-admin cannot read admin overview', rpc('ret1', 'admin_overview', {}), /Admins only/)
const ov = await must('admin overview', rpc('admin', 'admin_overview', {}))
check('admin overview ok', ov.orders >= 3)
check('admin audit log has entries', ((await c.admin.from('audit_log').select('id').limit(1)).data ?? []).length === 1)
check('non-admin cannot read audit log', ((await c.ret1.from('audit_log').select('id').limit(1)).data ?? []).length === 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
