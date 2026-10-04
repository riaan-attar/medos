// Demo data: creates one account per role and walks a full supply-chain flow through the real RPCs.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/seed.mjs
// The service-role key is ONLY used here to create/confirm users. Never put it in .env for the frontend.
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY'); process.exit(1)
}
const PASSWORD = 'Demo@1234'
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const USERS = [
  { key: 'admin', email: 'admin@medos.demo', role: 'consumer', full_name: 'Site Admin', org_name: '', city: 'Mumbai' },
  { key: 'mfr', email: 'factory@medos.demo', role: 'manufacturer', full_name: 'Anita Rao', org_name: 'Sunrise Pharma Ltd', city: 'Hyderabad', license_no: 'MFG-TS-1001' },
  { key: 'dist', email: 'dealer@medos.demo', role: 'distributor', full_name: 'Vikram Shah', org_name: 'Shah Medical Wholesalers', city: 'Pune', license_no: 'WS-MH-2210' },
  { key: 'ret1', email: 'pharmacy1@medos.demo', role: 'retailer', full_name: 'Meera Joshi', org_name: 'CityCare Pharmacy', city: 'Pune', address: '12 MG Road', license_no: 'RT-MH-3301' },
  { key: 'ret2', email: 'pharmacy2@medos.demo', role: 'retailer', full_name: 'Rahul Verma', org_name: 'HealthPlus Chemist', city: 'Pune', address: '4 FC Road', license_no: 'RT-MH-3302' },
  { key: 'user', email: 'customer@medos.demo', role: 'consumer', full_name: 'Priya Nair', city: 'Pune' },
]

const clients = {}
const ids = {}
for (const u of USERS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email, password: PASSWORD, email_confirm: true,
    user_metadata: { role: u.role, full_name: u.full_name, org_name: u.org_name ?? '', city: u.city ?? '', address: u.address ?? '', license_no: u.license_no ?? '' },
  })
  let id = data?.user?.id
  if (error) {
    if (!/already|registered/i.test(error.message)) throw error
    const list = await admin.auth.admin.listUsers({ perPage: 1000 })
    id = list.data.users.find(x => x.email === u.email).id
  }
  ids[u.key] = id
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: e2 } = await c.auth.signInWithPassword({ email: u.email, password: PASSWORD })
  if (e2) throw e2
  clients[u.key] = c
}
// admin role + verified flags need the service role (clients cannot change them)
await admin.from('profiles').update({ role: 'admin' }).eq('id', ids.admin)
await admin.from('profiles').update({ verified: true }).in('id', [ids.mfr, ids.dist, ids.ret1])

const rpc = async (who, fn, args) => {
  const { data, error } = await clients[who].rpc(fn, args)
  if (error) throw new Error(`${fn} as ${who}: ${error.message}`)
  return data
}

// Catalog
const meds = [
  { name: 'Crocin Advance', generic_name: 'Paracetamol', category: 'Analgesic', dosage_form: 'Tablet', strength: '500 mg', pack_size: '15 tablets', mrp: 30 },
  { name: 'Azithral 500', generic_name: 'Azithromycin', category: 'Antibiotic', dosage_form: 'Tablet', strength: '500 mg', pack_size: '5 tablets', mrp: 120, requires_rx: true },
  { name: 'Pantocid DSR', generic_name: 'Pantoprazole + Domperidone', category: 'Antacid', dosage_form: 'Capsule', strength: '40/30 mg', pack_size: '10 capsules', mrp: 185 },
  { name: 'Benadryl Cough', generic_name: 'Diphenhydramine', category: 'Cough & Cold', dosage_form: 'Syrup', strength: '100 ml', pack_size: '1 bottle', mrp: 110 },
  { name: 'Volini Gel', generic_name: 'Diclofenac', category: 'Pain relief', dosage_form: 'Ointment', strength: '1%', pack_size: '30 g', mrp: 95 },
]
const medIds = []
for (const m of meds) {
  const { data, error } = await clients.mfr.from('medicines').upsert({ ...m, manufacturer_id: ids.mfr }, { onConflict: 'manufacturer_id,name,strength,pack_size' }).select('id').single()
  if (error) throw error
  medIds.push(data.id)
}
const iso = (months) => { const d = new Date(); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10) }
const batch = async (i, no, qty, expMonths) => {
  try {
    await rpc('mfr', 'create_batch', { p_medicine_id: medIds[i], p_batch_no: no, p_mfg_date: iso(-2), p_expiry_date: iso(expMonths), p_quantity: qty })
  } catch (e) { if (!/duplicate|already/i.test(e.message)) throw e }
}
await batch(0, 'CRO-2610-A', 5000, 22); await batch(0, 'CRO-2610-B', 3000, 3)
await batch(1, 'AZI-2610-A', 1500, 20); await batch(2, 'PAN-2610-A', 2000, 18)
await batch(3, 'BEN-2610-A', 800, 14); await batch(4, 'VOL-2610-A', 600, 16)

// Distributor buys from factory -> factory accepts, ships -> distributor receives
const flow = async (buyer, seller, items, finish = true) => {
  const id = await rpc(buyer, 'place_order', { p_seller: ids[seller], p_items: items, p_notes: 'Seeded order' })
  await rpc(seller, 'advance_order', { p_order_id: id, p_action: 'accept', p_note: '' })
  await rpc(seller, 'advance_order', { p_order_id: id, p_action: 'ship', p_note: '' })
  if (finish) await rpc(buyer, 'advance_order', { p_order_id: id, p_action: 'receive', p_note: '' })
  return id
}
await flow('dist', 'mfr', [{ medicine_id: medIds[0], quantity: 2000 }, { medicine_id: medIds[1], quantity: 600 }, { medicine_id: medIds[2], quantity: 800 }, { medicine_id: medIds[3], quantity: 300 }])
await flow('ret1', 'dist', [{ medicine_id: medIds[0], quantity: 400 }, { medicine_id: medIds[1], quantity: 100 }, { medicine_id: medIds[2], quantity: 120 }, { medicine_id: medIds[3], quantity: 50 }])
await flow('ret2', 'dist', [{ medicine_id: medIds[0], quantity: 250 }, { medicine_id: medIds[3], quantity: 60 }], false) // left in transit
// open/pending orders to play with
await rpc('ret1', 'place_order', { p_seller: ids.mfr, p_items: [{ medicine_id: medIds[4], quantity: 100 }], p_notes: 'Direct from factory' })
await rpc('user', 'place_order', { p_seller: ids.ret1, p_items: [{ medicine_id: medIds[0], quantity: 2 }], p_notes: 'Pickup at 6pm' })

// ---- v2 extras: locations, credit terms, payments, a return, reviews, a fulfilled customer order
const coords = { mfr: [17.385, 78.4867], dist: [18.5204, 73.8567], ret1: [18.5204, 73.8467], ret2: [18.531, 73.8446], user: [18.5167, 73.8562] }
for (const [k, [lat, lng]] of Object.entries(coords)) await admin.from('profiles').update({ lat, lng }).eq('id', ids[k])
await admin.from('profiles').update({ about: 'Family-run pharmacy open 8am–11pm, free home delivery within 3 km.', gstin: '27ABCDE1234F1Z5' }).eq('id', ids.ret1)
await admin.from('profiles').update({ gstin: '36ABCDE9999F1Z1' }).eq('id', ids.mfr)
await clients.mfr.from('trade_relations').upsert({ seller_id: ids.mfr, buyer_id: ids.dist, credit_limit: 500000, discount_pct: 2 }, { onConflict: 'seller_id,buyer_id' })
await clients.dist.from('trade_relations').upsert({ seller_id: ids.dist, buyer_id: ids.ret1, credit_limit: 100000, discount_pct: 1 }, { onConflict: 'seller_id,buyer_id' })

const { data: invs } = await clients.mfr.from('invoices').select('id, total, status').eq('seller_id', ids.mfr).eq('status', 'unpaid').limit(1)
if (invs?.[0]) await rpc('mfr', 'record_payment', { p_invoice_id: invs[0].id, p_amount: Math.round(invs[0].total * 0.5), p_method: 'bank', p_reference: 'UTR-SEED-1', p_note: 'Advance' })

// a fulfilled customer order + review, plus a counter bill
const cid = await rpc('user', 'place_order', { p_seller: ids.ret1, p_items: [{ medicine_id: medIds[0], quantity: 3 }, { medicine_id: medIds[2], quantity: 1 }], p_notes: 'Seed order' })
await rpc('ret1', 'advance_order', { p_order_id: cid, p_action: 'accept', p_note: '' })
await rpc('ret1', 'ship_order', { p_order_id: cid, p_quantities: null, p_eta: null, p_tracking: '' })
await rpc('user', 'submit_review', { p_order_id: cid, p_rating: 5, p_comment: 'Fast and genuine medicines.' })
await rpc('ret1', 'create_bill', { p_lines: [{ medicine_id: medIds[0], quantity: 4 }, { medicine_id: medIds[3], quantity: 2 }], p_customer_name: 'Walk-in Ravi', p_customer_phone: '9876543210', p_discount: 5, p_payment_mode: 'upi' })

console.log('Seed complete. Log in with password', PASSWORD)
for (const u of USERS) console.log(' ', u.key.padEnd(5), u.email, u.key === 'admin' ? '(admin)' : `(${u.role})`)
