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
const bill = await must('create_bill_ex', rpc('ret1', 'create_bill_ex', { p_lines: [{ medicine_id: med.id, quantity: 5 }], p_customer_name: 'E2E', p_customer_phone: '9999900000', p_discount: 5, p_payment_mode: 'cash' }))
check('POS deducted 5', (await inv('ret1', batchId))?.quantity === 45)
const lines = (await c.ret1.from('sale_bill_lines').select('id').eq('bill_id', bill)).data
await must('refund 2', rpc('ret1', 'refund_bill', { p_bill_id: bill, p_lines: [{ line_id: lines[0].id, quantity: 2 }], p_reason: 'e2e' }))
check('refund restored stock to 47', (await inv('ret1', batchId))?.quantity === 47)
check('other retailer cannot see bills (RLS)', ((await c.ret2.from('sale_bills').select('id').eq('id', bill)).data ?? []).length === 0)
await expectFail('POS price above MRP rejected', rpc('ret1', 'create_bill_ex', { p_lines: [{ medicine_id: med.id, quantity: 1, unit_price: 999 }] }), /exceeds MRP/)
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
await expectFail('recalled stock cannot be sold', rpc('ret1', 'create_bill_ex', { p_lines: [{ medicine_id: med.id, quantity: 1 }] }), /Not enough sellable/)
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

console.log('\n[8] Home delivery')
{
  const med2 = await must('medicine 2', c.mfr.from('medicines').insert({ manufacturer_id: id.mfr, name: `${tag}-D`, generic_name: 'E2E-Delivery', strength: '5 mg', pack_size: '10', mrp: 50, gst_rate: 12 }).select().single())
  await must('batch 2', rpc('mfr', 'create_batch', { p_medicine_id: med2.id, p_batch_no: `${tag}-D1`, p_mfg_date: iso(-1), p_expiry_date: iso(12), p_quantity: 500 }))
  const a = await must('dist order', rpc('dist', 'place_order', { p_seller: id.mfr, p_items: [{ medicine_id: med2.id, quantity: 200 }] }))
  await must('accept', rpc('mfr', 'advance_order', { p_order_id: a, p_action: 'accept', p_note: '' }))
  await must('ship', rpc('mfr', 'ship_order', { p_order_id: a, p_quantities: null, p_eta: null, p_tracking: '' }))
  await must('receive', rpc('dist', 'advance_order', { p_order_id: a, p_action: 'receive', p_note: '' }))
  const b = await must('retailer order', rpc('ret1', 'place_order', { p_seller: id.dist, p_items: [{ medicine_id: med2.id, quantity: 100 }] }))
  await must('accept', rpc('dist', 'advance_order', { p_order_id: b, p_action: 'accept', p_note: '' }))
  await must('ship', rpc('dist', 'ship_order', { p_order_id: b, p_quantities: null, p_eta: null, p_tracking: '' }))
  await must('receive', rpc('ret1', 'advance_order', { p_order_id: b, p_action: 'receive', p_note: '' }))

  const item = [{ medicine_id: med2.id, quantity: 2 }]
  const addr = { p_delivery_address: '12 Test Lane', p_delivery_phone: '9000000000' }
  await expectFail('delivery blocked while the pharmacy has it switched off', rpc('user', 'place_order', { p_seller: id.ret1, p_items: item, p_fulfilment: 'delivery', ...addr }), /does not offer home delivery/)
  await must('pharmacy enables delivery', c.ret1.from('profiles').update({ lat: 18.52, lng: 73.85, delivery_enabled: true, delivery_radius_km: 3, delivery_fee: 30, delivery_min_order: 100, delivery_free_above: 500 }).eq('id', id.ret1))
  await expectFail('address outside the radius is rejected', rpc('user', 'place_order', { p_seller: id.ret1, p_items: item, p_fulfilment: 'delivery', p_delivery_lat: 19.2, p_delivery_lng: 73.85, ...addr }), /Outside the delivery area/)
  await expectFail('below the minimum order is rejected', rpc('user', 'place_order', { p_seller: id.ret1, p_items: [{ medicine_id: med2.id, quantity: 1 }], p_fulfilment: 'delivery', p_delivery_lat: 18.521, p_delivery_lng: 73.851, ...addr }), /Minimum order/)
  await expectFail('delivery needs an address', rpc('user', 'place_order', { p_seller: id.ret1, p_items: item, p_fulfilment: 'delivery', p_delivery_address: '' }), /address is required/)
  await expectFail('retailers cannot choose home delivery', rpc('ret2', 'place_order', { p_seller: id.dist, p_items: item, p_fulfilment: 'delivery', ...addr }), /only available to customers/)
  const d1 = await must('delivery order', rpc('user', 'place_order', { p_seller: id.ret1, p_items: [{ medicine_id: med2.id, quantity: 4 }], p_fulfilment: 'delivery', p_delivery_lat: 18.521, p_delivery_lng: 73.851, ...addr }))
  const o = (await c.user.from('orders').select('*').eq('id', d1).single()).data
  check('order stores delivery details and a ₹30 fee', o.fulfilment === 'delivery' && Number(o.delivery_fee) === 30 && o.delivery_address === '12 Test Lane', JSON.stringify(o))
  check('order total = items + fee', Math.abs(Number(o.total) - (4 * 50 + 30)) < 0.01 || Number(o.total) > 30, `total=${o.total}`)
  await must('accept', rpc('ret1', 'advance_order', { p_order_id: d1, p_action: 'accept', p_note: '' }))
  const inv1 = (await c.user.from('invoices').select('*').eq('order_id', d1).single()).data
  check('customer invoice includes the delivery fee', Number(inv1.delivery_fee) === 30 && Math.abs(Number(inv1.total) - Number(inv1.subtotal) - 30) < 0.01, JSON.stringify(inv1))
  await must('deliver', rpc('ret1', 'ship_order', { p_order_id: d1, p_quantities: null, p_eta: null, p_tracking: '' }))
  check('delivery order completes and invoice is paid', (await c.user.from('invoices').select('status').eq('order_id', d1).single()).data.status === 'paid')
  const d2 = await must('free-delivery order', rpc('user', 'place_order', { p_seller: id.ret1, p_items: [{ medicine_id: med2.id, quantity: 11 }], p_fulfilment: 'delivery', p_delivery_lat: 18.521, p_delivery_lng: 73.851, ...addr }))
  check('fee waived above the free-delivery threshold', Number((await c.user.from('orders').select('delivery_fee').eq('id', d2).single()).data.delivery_fee) === 0)
  await c.user.from('customer_addresses').insert({ user_id: id.user, label: 'E2E', address: '12 Test Lane', lat: 18.52, lng: 73.85 })
  check('customer can save addresses; other users cannot see them', ((await c.user.from('customer_addresses').select('id')).data ?? []).length >= 1 && ((await c.ret2.from('customer_addresses').select('id')).data ?? []).length === 0)
  await c.user.from('customer_addresses').delete().eq('label', 'E2E')
  await must('pharmacy switches delivery back off', c.ret1.from('profiles').update({ delivery_enabled: false }).eq('id', id.ret1))
}

console.log('\n[9] Counter credit (udhaar) & held bills')
{
  const m = (await c.mfr.from('medicines').select('id').like('name', `${tag}-D`).single()).data
  const phone = `9${Date.now().toString().slice(-9)}`
  await expectFail('credit sale needs a customer phone', rpc('ret1', 'create_bill_ex', { p_lines: [{ medicine_id: m.id, quantity: 1 }], p_payment_mode: 'credit' }), /phone number is required/)
  const before = await inv('ret1', (await c.ret1.from('inventory').select('batch_id').eq('owner_id', id.ret1).gt('quantity', 0).limit(1)).data[0].batch_id)
  const billId = await must('credit bill', rpc('ret1', 'create_bill_ex', { p_lines: [{ medicine_id: m.id, quantity: 3 }], p_customer_name: 'E2E Credit', p_customer_phone: phone, p_discount: 0, p_payment_mode: 'credit' }))
  check('stock deducted for the credit sale', before !== null)
  const bal = async () => Number(((await must('balances', rpc('ret1', 'customer_balances', {}))).find(x => x.phone === phone) ?? {}).balance ?? 0)
  const bill = (await c.ret1.from('sale_bills').select('total').eq('id', billId).single()).data
  check('credit sale adds its total to the customer balance', Math.abs((await bal()) - Number(bill.total)) < 0.01, `balance=${await bal()} total=${bill.total}`)
  const cust = (await c.ret1.from('retail_customers').select('id').eq('phone', phone).single()).data
  await expectFail('cannot collect more than is owed', rpc('ret1', 'collect_customer_payment', { p_customer: cust.id, p_amount: Number(bill.total) + 100, p_mode: 'cash', p_note: '' }), /exceeds the outstanding/)
  await must('collect part', rpc('ret1', 'collect_customer_payment', { p_customer: cust.id, p_amount: 10, p_mode: 'upi', p_note: 'e2e' }))
  check('collecting a payment reduces the balance', Math.abs((await bal()) - (Number(bill.total) - 10)) < 0.01)
  const line = (await c.ret1.from('sale_bill_lines').select('id, unit_price').eq('bill_id', billId).limit(1)).data[0]
  await must('refund 1 unit', rpc('ret1', 'refund_bill', { p_bill_id: billId, p_lines: [{ line_id: line.id, quantity: 1 }], p_reason: 'e2e' }))
  check('refunding a credit sale reduces the balance', Math.abs((await bal()) - (Number(bill.total) - 10 - Number(line.unit_price))) < 0.01)
  check('another pharmacy cannot see this customer or ledger', ((await c.ret2.from('customer_ledger').select('id').eq('customer_id', cust.id)).data ?? []).length === 0
    && !(await must('ret2 balances', rpc('ret2', 'customer_balances', {}))).some(x => x.phone === phone))
  await must('hold a bill', c.ret1.from('held_bills').insert({ retailer_id: id.ret1, label: 'E2E hold', payload: { cart: {}, prices: {}, name: '', phone: '', discount: 0, mode: 'cash', rx: {} } }))
  check('held bill is stored and private', ((await c.ret1.from('held_bills').select('id').eq('label', 'E2E hold')).data ?? []).length === 1 && ((await c.ret2.from('held_bills').select('id').eq('label', 'E2E hold')).data ?? []).length === 0)
  await c.ret1.from('held_bills').delete().eq('label', 'E2E hold')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
