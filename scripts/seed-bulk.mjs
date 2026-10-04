// Bulk demo data: dozens of businesses, ~40 medicines, ~150 orders across every status,
// 60 days of backdated history, payments, returns, POS bills, reviews, favourites and a recall.
//   (load .env) node scripts/seed-bulk.mjs [--force]
// Needs: both migrations applied and scripts/seed.mjs already run (it reuses those 6 accounts).
// Service-role key is used only to create/confirm users and to backdate timestamps. Password for all: Demo@1234
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) { console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const PASSWORD = 'Demo@1234'
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ---------- deterministic randomness ----------
let seed = 20261005
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const chance = p => rnd() < p
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]] } return a }
const DAY = 86400000
const iso = ms => new Date(ms).toISOString()
const dateOnly = ms => iso(ms).slice(0, 10)
const monthsFromNow = m => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10) }
const log = (...a) => console.log(...a)
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } })); return out }

// ---------- guard ----------
{
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (data.users.some(u => u.email === 'factory2@medos.demo') && !process.argv.includes('--force')) {
    console.error('Bulk data already present (factory2@medos.demo exists). Re-run with --force to add another batch of orders.'); process.exit(1)
  }
}

// ---------- people ----------
const CITIES = [
  ['Pune', 18.5204, 73.8567], ['Mumbai', 19.076, 72.8777], ['Hyderabad', 17.385, 78.4867], ['Bengaluru', 12.9716, 77.5946],
  ['Delhi', 28.6139, 77.209], ['Chennai', 13.0827, 80.2707], ['Ahmedabad', 23.0225, 72.5714], ['Kolkata', 22.5726, 88.3639],
]
const jitter = (c, km = 6) => [c[1] + (rnd() - 0.5) * (km / 55), c[2] + (rnd() - 0.5) * (km / 55)]
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan', 'Ananya', 'Diya', 'Meera', 'Priya', 'Kavya', 'Isha', 'Neha', 'Pooja', 'Sneha', 'Riya', 'Karan', 'Nikhil', 'Suresh', 'Ramesh', 'Anil', 'Sunita', 'Lakshmi', 'Farhan', 'Zoya', 'Imran', 'Harpreet', 'Gurpreet', 'Joseph', 'Mary', 'Thomas', 'Deepak', 'Manish', 'Swati', 'Tanvi', 'Yash']
const LAST = ['Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Singh', 'Kumar', 'Gupta', 'Joshi', 'Mehta', 'Shah', 'Rao', 'Khan', 'Das', 'Bose', 'Chopra', 'Malhotra', 'Pillai', 'Kulkarni', 'Desai', 'Jain', 'Agarwal', 'Menon']
const person = () => `${pick(FIRST)} ${pick(LAST)}`

const MFR = ['Sunrise Pharma Ltd|exists', 'Zenith Lifesciences', 'Apex Remedies Pvt Ltd', 'Orion Formulations']
const DIST = ['Shah Medical Wholesalers|exists', 'Metro Pharma Distributors', 'Lifeline Medico Traders', 'Bharat Drug House', 'Care Chain Wholesale', 'Southern Meds Agency']
const RET = ['CityCare Pharmacy|exists', 'HealthPlus Chemist|exists', 'Apollo Wellness Pharmacy', 'MedPoint Chemist', 'Sanjeevani Medicals', 'Jan Aushadhi Kendra #214', 'Green Cross Pharmacy', 'LifeCare Drugstore',
  'Wellness Forever', 'Noble Medicals', 'Trust Pharmacy', 'Shree Sai Medicals', 'Krishna Chemists', 'New Age Pharmacy', 'Rainbow Medicos', 'Nova Care Pharmacy', 'Galaxy Chemist', 'Sunshine Drugs']
const MAX_CONSUMERS = 28

const accounts = [] // {key, email, role, ...}
const existing = { mfr: 'factory@medos.demo', dist: 'dealer@medos.demo', ret1: 'pharmacy1@medos.demo', ret2: 'pharmacy2@medos.demo', user: 'customer@medos.demo' }
MFR.forEach((n, i) => accounts.push({ key: `mfr${i + 1}`, role: 'manufacturer', email: i === 0 ? existing.mfr : `factory${i + 1}@medos.demo`, org: n.split('|')[0], isNew: i > 0, city: CITIES[i % 4] }))
DIST.forEach((n, i) => accounts.push({ key: `dist${i + 1}`, role: 'distributor', email: i === 0 ? existing.dist : `dealer${i + 1}@medos.demo`, org: n.split('|')[0], isNew: i > 0, city: CITIES[(i + 1) % CITIES.length] }))
RET.forEach((n, i) => accounts.push({ key: `ret${i + 1}`, role: 'retailer', email: i === 0 ? existing.ret1 : i === 1 ? existing.ret2 : `pharmacy${i + 1}@medos.demo`, org: n.split('|')[0], isNew: i > 1, city: i < 8 ? CITIES[0] : CITIES[(i * 3) % CITIES.length] }))
for (let i = 1; i <= MAX_CONSUMERS; i++) accounts.push({ key: `user${i}`, role: 'consumer', email: i === 1 ? existing.user : `customer${i}@medos.demo`, org: '', isNew: i > 1, city: i <= 18 ? CITIES[0] : CITIES[i % CITIES.length] })

const clients = {}, ids = {}, byKey = {}
log(`Creating/signing in ${accounts.length} accounts…`)
const existingUsers = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users
await pool(accounts, 6, async a => {
  byKey[a.key] = a
  const [lat, lng] = jitter(a.city)
  const name = person()
  if (a.isNew) {
    const { data, error } = await admin.auth.admin.createUser({
      email: a.email, password: PASSWORD, email_confirm: true,
      user_metadata: { role: a.role, full_name: name, org_name: a.org, city: a.city[0], phone: `98${int(10000000, 99999999)}`, address: a.role === 'consumer' ? '' : `${int(1, 250)} ${pick(['MG Road', 'Station Road', 'Main Bazaar', 'Market Yard', 'Ring Road', 'Temple Street', 'Nehru Nagar', 'Gandhi Chowk'])}`, license_no: a.role === 'consumer' ? '' : `${a.role.slice(0, 2).toUpperCase()}-${a.city[0].slice(0, 2).toUpperCase()}-${int(1000, 9999)}` },
    })
    if (error && !/already|registered/i.test(error.message)) throw error
    ids[a.key] = data?.user?.id ?? existingUsers.find(u => u.email === a.email)?.id
  } else ids[a.key] = existingUsers.find(u => u.email === a.email)?.id
  if (!ids[a.key]) throw new Error('missing user ' + a.email + ' — run scripts/seed.mjs first')
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: a.email, password: PASSWORD })
  if (error) throw new Error(`${a.email}: ${error.message}`)
  clients[a.key] = c
  if (a.isNew) {
    const patch = { lat, lng }
    if (a.role !== 'consumer') {
      patch.verified = chance(0.8)
      patch.gstin = `${int(10, 36)}ABCDE${int(1000, 9999)}F1Z${int(1, 9)}`
      patch.about = pick(['Serving the community for over 15 years.', 'Genuine medicines, fair prices, friendly advice.', 'Open late. Home delivery available.', 'Authorised stockist for leading brands.', 'Cold-chain capable. Pan-region supply.'])
    }
    await admin.from('profiles').update(patch).eq('id', ids[a.key])
  }
})
const keys = role => accounts.filter(a => a.role === role).map(a => a.key)
const MFRS = keys('manufacturer'), DISTS = keys('distributor'), RETS = keys('retailer'), USERS = keys('consumer')
const rpc = async (k, fn, args) => { const { data, error } = await clients[k].rpc(fn, args); if (error) throw new Error(`${fn}[${k}]: ${error.message}`); return data }

// ---------- catalog ----------
// [name, generic, category, form, strength, pack, mrp, gst, rx]
const CATALOG = [
  ['Crocin 650', 'Paracetamol', 'Analgesic', 'Tablet', '650 mg', '15 tablets', 32, 12, false], ['Dolo 650', 'Paracetamol', 'Analgesic', 'Tablet', '650 mg', '15 tablets', 31, 12, false],
  ['Calpol 500', 'Paracetamol', 'Analgesic', 'Tablet', '500 mg', '15 tablets', 18, 12, false], ['Brufen 400', 'Ibuprofen', 'Analgesic', 'Tablet', '400 mg', '15 tablets', 24, 12, false],
  ['Combiflam', 'Ibuprofen + Paracetamol', 'Analgesic', 'Tablet', '400/325 mg', '20 tablets', 45, 12, false], ['Voveran SR', 'Diclofenac', 'Analgesic', 'Tablet', '100 mg', '10 tablets', 78, 12, true],
  ['Augmentin 625', 'Amoxicillin + Clavulanate', 'Antibiotic', 'Tablet', '625 mg', '10 tablets', 224, 12, true], ['Mox 500', 'Amoxicillin', 'Antibiotic', 'Capsule', '500 mg', '15 capsules', 96, 12, true],
  ['Azithral 500', 'Azithromycin', 'Antibiotic', 'Tablet', '500 mg', '5 tablets', 120, 12, true], ['Zithromax 250', 'Azithromycin', 'Antibiotic', 'Tablet', '250 mg', '6 tablets', 95, 12, true],
  ['Ciplox 500', 'Ciprofloxacin', 'Antibiotic', 'Tablet', '500 mg', '10 tablets', 58, 12, true], ['Taxim-O 200', 'Cefixime', 'Antibiotic', 'Tablet', '200 mg', '10 tablets', 138, 12, true],
  ['Pantocid DSR', 'Pantoprazole + Domperidone', 'Gastro', 'Capsule', '40/30 mg', '10 capsules', 185, 12, false], ['Pan 40', 'Pantoprazole', 'Gastro', 'Tablet', '40 mg', '15 tablets', 155, 12, false],
  ['Digene Gel', 'Antacid', 'Gastro', 'Syrup', '200 ml', '1 bottle', 125, 12, false], ['ORS Electral', 'Oral Rehydration Salts', 'Gastro', 'Powder', '21.8 g', '1 sachet', 22, 5, false],
  ['Cetzine 10', 'Cetirizine', 'Allergy', 'Tablet', '10 mg', '10 tablets', 42, 12, false], ['Allegra 120', 'Fexofenadine', 'Allergy', 'Tablet', '120 mg', '10 tablets', 195, 12, false],
  ['Benadryl Cough', 'Diphenhydramine', 'Cough & Cold', 'Syrup', '100 ml', '1 bottle', 110, 12, false], ['Ascoril LS', 'Levosalbutamol + Ambroxol', 'Cough & Cold', 'Syrup', '100 ml', '1 bottle', 118, 12, false],
  ['Sinarest', 'Paracetamol + Phenylephrine', 'Cough & Cold', 'Tablet', '500/10 mg', '10 tablets', 48, 12, false], ['Otrivin Nasal', 'Xylometazoline', 'Cough & Cold', 'Drops', '10 ml', '1 bottle', 82, 12, false],
  ['Glycomet 500', 'Metformin', 'Diabetes', 'Tablet', '500 mg', '20 tablets', 28, 5, true], ['Amaryl 2', 'Glimepiride', 'Diabetes', 'Tablet', '2 mg', '30 tablets', 245, 5, true],
  ['Januvia 100', 'Sitagliptin', 'Diabetes', 'Tablet', '100 mg', '7 tablets', 440, 5, true], ['Lantus Solostar', 'Insulin Glargine', 'Diabetes', 'Injection', '100 IU/ml', '3 ml pen', 780, 5, true],
  ['Telma 40', 'Telmisartan', 'Cardiac', 'Tablet', '40 mg', '30 tablets', 210, 5, true], ['Amlong 5', 'Amlodipine', 'Cardiac', 'Tablet', '5 mg', '15 tablets', 38, 5, true],
  ['Atorva 10', 'Atorvastatin', 'Cardiac', 'Tablet', '10 mg', '15 tablets', 105, 5, true], ['Ecosprin 75', 'Aspirin', 'Cardiac', 'Tablet', '75 mg', '14 tablets', 7, 5, false],
  ['Shelcal 500', 'Calcium + Vitamin D3', 'Vitamins', 'Tablet', '500 mg', '15 tablets', 118, 12, false], ['Becosules Z', 'Vitamin B-complex + Zinc', 'Vitamins', 'Capsule', 'Std', '20 capsules', 52, 12, false],
  ['Limcee 500', 'Vitamin C', 'Vitamins', 'Tablet', '500 mg', '15 tablets', 24, 12, false], ['Evion 400', 'Vitamin E', 'Vitamins', 'Capsule', '400 mg', '10 capsules', 36, 12, false],
  ['Volini Gel', 'Diclofenac', 'Pain relief', 'Ointment', '1%', '30 g', 95, 12, false], ['Betadine 5%', 'Povidone Iodine', 'First aid', 'Ointment', '5%', '20 g', 68, 12, false],
  ['Soframycin', 'Framycetin', 'First aid', 'Ointment', '1%', '20 g', 54, 12, false], ['Ventolin Inhaler', 'Salbutamol', 'Respiratory', 'Inhaler', '100 mcg', '200 doses', 168, 12, true],
]
const BARCODE = n => `890${String(n * 7919 + 1000003).padStart(10, '0')}`
// every manufacturer (except mfr1 which already has 5) produces a slice of the catalog; overlaps give "alternatives"
const mfrMeds = {}
const existingMeds = (await admin.from('medicines').select('*')).data
for (const m of MFRS) mfrMeds[m] = existingMeds.filter(x => x.manufacturer_id === ids[m])
log('Creating medicines…')
for (const [idx, row] of CATALOG.entries()) {
  const [name, generic, category, dosage_form, strength, pack_size, mrp, gst_rate, requires_rx] = row
  const owners = shuffle(MFRS).slice(0, chance(0.35) ? 2 : 1)
  for (const m of owners) {
    if (mfrMeds[m].some(x => x.name === name)) continue
    const { data, error } = await clients[m].from('medicines').insert({ manufacturer_id: ids[m], name, generic_name: generic, category, dosage_form, strength, pack_size, mrp: owners.length > 1 && m !== owners[0] ? Math.round(mrp * 0.92) : mrp, gst_rate, requires_rx, barcode: BARCODE(idx) }).select().single()
    if (error) { log('  medicine skipped', name, error.message); continue }
    mfrMeds[m].push(data)
  }
}
log('  medicines per manufacturer:', MFRS.map(m => mfrMeds[m].length).join(', '))

// ---------- batches ----------
log('Registering batches…')
const batchesByMed = {}
const prodDay = () => Date.now() - int(70, 95) * DAY
for (const m of MFRS) {
  for (const med of mfrMeds[m]) {
    const n = int(2, 3)
    for (let b = 0; b < n; b++) {
      const qty = int(8, 40) * 1000
      // a few near-expiry and one already-expired batch to light up alerts
      const kind = rnd()
      const expMonths = kind < 0.06 ? -1 : kind < 0.2 ? int(1, 2) : int(8, 30)
      const mfgMonths = expMonths < 0 ? -26 : -int(1, 6)
      const batch_no = `${med.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${String(int(2500, 2610))}-${String.fromCharCode(65 + b)}${int(1, 9)}`
      try {
        const id = await rpc(m, 'create_batch', { p_medicine_id: med.id, p_batch_no: batch_no, p_mfg_date: monthsFromNow(mfgMonths), p_expiry_date: monthsFromNow(expMonths), p_quantity: qty })
        ;(batchesByMed[med.id] ??= []).push({ id, m, batch_no, medicine_id: med.id })
      } catch (e) { if (!/duplicate|unique/i.test(e.message)) log('  batch failed', e.message) }
    }
  }
}
const allBatchIds = Object.values(batchesByMed).flat().map(b => b.id)
// backdate production
await pool(allBatchIds, 8, async id => {
  const t = iso(prodDay())
  await admin.from('batches').update({ created_at: t }).eq('id', id)
  await admin.from('stock_movements').update({ created_at: t }).eq('batch_id', id).eq('movement_type', 'production')
})
log(`  ${allBatchIds.length} batches`)

// ---------- helpers for order flows ----------
let counters = { orders: 0, failed: 0 }
const failures = {}
const note = (k, e) => { counters.failed++; failures[e.message.slice(0, 90)] = (failures[e.message.slice(0, 90)] ?? 0) + 1 }

async function backdate(orderId, ts) {
  const cap = x => Math.min(x, Date.now() - 60000)
  const { data: o } = await admin.from('orders').select('*').eq('id', orderId).single()
  const created = iso(ts)
  const ship = iso(cap(ts + int(8, 30) * 3600000))
  const recv = iso(cap(ts + int(2, 5) * DAY))
  await admin.from('orders').update({ created_at: created, updated_at: iso(cap(ts + DAY)), shipped_at: o.shipped_at ? ship : null, delivered_at: o.delivered_at ? recv : null }).eq('id', orderId)
  await admin.from('shipments').update({ shipped_at: ship }).eq('order_id', orderId)
  await admin.from('shipments').update({ received_at: recv }).eq('order_id', orderId).not('received_at', 'is', null)
  const consumer = (await admin.from('profiles').select('role').eq('id', o.buyer_id).single()).data.role === 'consumer'
  await admin.from('invoices').update({ created_at: iso(cap(ts + 3600000)), due_date: dateOnly(ts + (consumer ? 0 : 15) * DAY) }).eq('order_id', orderId)
  const pays = (await admin.from('payments').select('id').eq('order_id', orderId).order('paid_at')).data ?? []
  await Promise.all(pays.map((p, i) => admin.from('payments').update({ paid_at: iso(cap(ts + (consumer ? 1 : 5 + i * 9) * DAY)) }).eq('id', p.id)))
  const ev = (await admin.from('order_events').select('id').eq('order_id', orderId).order('created_at')).data ?? []
  await Promise.all(ev.map((e, i) => admin.from('order_events').update({ created_at: iso(cap(ts + i * 5 * 3600000)) }).eq('id', e.id)))
  await admin.from('stock_movements').update({ created_at: ship }).eq('order_id', orderId).in('movement_type', ['transfer_out'])
  await admin.from('stock_movements').update({ created_at: recv }).eq('order_id', orderId).in('movement_type', ['transfer_in', 'return_in', 'return_out'])
  await admin.from('returns').update({ created_at: iso(cap(ts + 6 * DAY)), resolved_at: iso(cap(ts + 7 * DAY)) }).eq('order_id', orderId)
  await admin.from('reviews').update({ created_at: iso(cap(ts + 6 * DAY)) }).eq('order_id', orderId)
  await admin.from('notifications').update({ created_at: created }).like('link', `%${orderId}%`)
}

async function flow({ buyer, seller, state, daysAgo, consumer = false }) {
  try {
    const cat = await rpc(buyer, 'get_supplier_catalog', { p_seller: ids[seller] })
    if (!cat?.length) return null
    const lines = shuffle(cat).slice(0, consumer ? int(1, 3) : int(3, 8)).map(c => ({
      medicine_id: c.medicine_id, rx: c.requires_rx,
      quantity: Math.max(1, Math.min(c.available, consumer ? int(1, 4) : buyer.startsWith('dist') ? int(300, 2500) : int(20, 220))),
    }))
    let rx = null
    if (consumer && lines.some(l => l.rx)) {
      rx = `${ids[buyer]}/seed-prescription.png`
      await admin.storage.from('prescriptions').upload(rx, PNG, { contentType: 'image/png', upsert: true }).catch(() => {})
    }
    const orderId = await rpc(buyer, 'place_order', { p_seller: ids[seller], p_items: lines.map(({ medicine_id, quantity }) => ({ medicine_id, quantity })), p_notes: pick(['', '', 'Please dispatch ASAP', 'Urgent — stock running low', 'Weekly restock', 'Festival season demand', 'Cold chain not required']), p_prescription_path: rx })
    counters.orders++
    const ts = Date.now() - daysAgo * DAY - int(0, 20) * 3600000
    if (state === 'pending') { await backdate(orderId, ts); return orderId }
    if (state === 'rejected') { await rpc(seller, 'advance_order', { p_order_id: orderId, p_action: 'reject', p_note: pick(['Out of allocation this week', 'Credit review pending', 'Product discontinued']) }); await backdate(orderId, ts); return orderId }
    if (state === 'cancelled') { await rpc(buyer, 'advance_order', { p_order_id: orderId, p_action: 'cancel', p_note: pick(['Ordered by mistake', 'Found a better price', 'No longer needed']) }); await backdate(orderId, ts); return orderId }
    await rpc(seller, 'advance_order', { p_order_id: orderId, p_action: 'accept', p_note: '' })
    if (state === 'accepted') { await backdate(orderId, ts); return orderId }
    if (state === 'partial' && !consumer) {
      const items = (await admin.from('order_items').select('id, quantity').eq('order_id', orderId)).data
      const q = Object.fromEntries(items.map(i => [i.id, Math.max(1, Math.floor(i.quantity * (0.3 + rnd() * 0.4)))]))
      await rpc(seller, 'ship_order', { p_order_id: orderId, p_quantities: q, p_eta: dateOnly(Date.now() + int(1, 4) * DAY), p_tracking: pick(['Blue Dart AWB ', 'DTDC ', 'VRL Logistics LR ', 'Own vehicle MH12-']) + int(100000, 999999) })
      if (chance(0.5)) { const sh = (await admin.from('shipments').select('id').eq('order_id', orderId)).data[0]; await rpc(buyer, 'receive_shipment', { p_shipment_id: sh.id }) }
      await backdate(orderId, ts); return orderId
    }
    await rpc(seller, 'ship_order', { p_order_id: orderId, p_quantities: null, p_eta: consumer ? null : dateOnly(Date.now() + int(0, 3) * DAY), p_tracking: consumer ? '' : pick(['Blue Dart AWB ', 'DTDC ', 'Delhivery ', 'Own vehicle KA05-']) + int(100000, 999999) })
    if (state === 'shipped') { await backdate(orderId, ts); return orderId }
    if (!consumer) await rpc(buyer, 'advance_order', { p_order_id: orderId, p_action: 'receive', p_note: '' })
    // payments (B2B): paid / partial / unpaid
    if (!consumer) {
      const inv = (await admin.from('invoices').select('*').eq('order_id', orderId).single()).data
      const r = rnd(), out = Number(inv.total)
      const pay = amt => rpc(seller, 'record_payment', { p_invoice_id: inv.id, p_amount: Math.round(amt * 100) / 100, p_method: pick(['bank', 'upi', 'cheque', 'bank']), p_reference: `UTR${int(10000000, 99999999)}`, p_note: '' })
      if (r < 0.5) await pay(out); else if (r < 0.75) { await pay(out * (0.3 + rnd() * 0.4)); if (chance(0.3)) { const i2 = (await admin.from('invoices').select('*').eq('id', inv.id).single()).data; await pay((i2.total - i2.paid_total) * 0.5) } }
      // returns on ~12% of delivered B2B orders
      if (chance(0.12)) {
        const b = (await admin.from('shipment_lines').select('batch_id, quantity, shipments!inner(order_id)').eq('shipments.order_id', orderId).limit(1)).data?.[0]
        if (b) {
          const retId = await rpc(buyer, 'request_return', { p_order_id: orderId, p_items: [{ batch_id: b.batch_id, quantity: Math.max(1, Math.floor(b.quantity * 0.05)) }], p_reason: pick(['Damaged on arrival', 'Near expiry', 'Wrong item delivered', 'Quality complaint']) })
          const d = rnd()
          if (d < 0.65) await rpc(seller, 'respond_return', { p_return_id: retId, p_action: 'approve', p_note: 'Approved — credit note issued' })
          else if (d < 0.85) await rpc(seller, 'respond_return', { p_return_id: retId, p_action: 'reject', p_note: 'Outside return window' })
        }
      }
    } else if (chance(0.72)) {
      const rating = pick([5, 5, 5, 4, 4, 4, 3, 5, 2, 4])
      await rpc(buyer, 'submit_review', { p_order_id: orderId, p_rating: rating, p_comment: pick(REVIEWS[rating]) })
    }
    await backdate(orderId, ts)
    return orderId
  } catch (e) { note(`${buyer}->${seller}`, e); return null }
}

const REVIEWS = {
  5: ['Very quick service and genuine medicines.', 'Always have everything in stock. Highly recommend!', 'Friendly pharmacist, fair prices.', 'Smooth reservation and pickup.', 'Excellent — will order again.'],
  4: ['Good service, slightly long wait at pickup.', 'Reasonable prices, helpful staff.', 'Medicines were fresh with long expiry.'],
  3: ['Okay experience. Had to wait about 20 minutes.', 'Average. Some items were not available.'],
  2: ['Order was ready late and nobody informed me.'],
}
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

// ---------- B2B waves ----------
const STATE_MIX = [['delivered', 0.62], ['shipped', 0.07], ['partial', 0.07], ['accepted', 0.07], ['pending', 0.09], ['rejected', 0.04], ['cancelled', 0.04]]
const pickState = () => { let r = rnd(), s = 0; for (const [k, p] of STATE_MIX) { s += p; if (r < s) return k } return 'delivered' }

log('Wave 1: dealers buy from factories…')
const w1 = []
for (const d of DISTS) for (let i = 0; i < int(4, 6); i++) w1.push({ buyer: d, seller: pick(MFRS), state: i < 2 ? 'delivered' : pickState(), daysAgo: int(30, 62) - i * 3 })
for (const j of w1) await flow(j)
log(`  ${counters.orders} orders so far`)

log('Wave 2: pharmacies buy from dealers / factories…')
const w2 = []
for (const r of RETS) for (let i = 0; i < int(4, 7); i++) w2.push({ buyer: r, seller: chance(0.85) ? pick(DISTS) : pick(MFRS), state: i < 2 ? 'delivered' : pickState(), daysAgo: int(2, 42) })
for (const j of shuffle(w2)) await flow(j)
log(`  ${counters.orders} orders so far`)

// pharmacies tune reorder levels so low-stock / reorder suggestions have content
log('Setting reorder levels & trade terms…')
const lists = (await admin.from('listings').select('id, owner_id')).data
const retIds = new Set(RETS.map(r => ids[r]))
await pool(lists.filter(l => retIds.has(l.owner_id) && chance(0.35)), 8, l => admin.from('listings').update({ reorder_level: int(120, 500) }).eq('id', l.id))
for (const m of MFRS) for (const d of DISTS) if (chance(0.7)) await clients[m].from('trade_relations').upsert({ seller_id: ids[m], buyer_id: ids[d], credit_limit: pick([250000, 500000, 1000000, null]), discount_pct: pick([0, 1, 2, 3, 5]) }, { onConflict: 'seller_id,buyer_id' })
for (const d of DISTS) for (const r of RETS) if (chance(0.4)) await clients[d].from('trade_relations').upsert({ seller_id: ids[d], buyer_id: ids[r], credit_limit: pick([50000, 100000, 200000, null]), discount_pct: pick([0, 0, 1, 2]) }, { onConflict: 'seller_id,buyer_id' })

// ---------- consumer orders ----------
log('Wave 3: customers reserve from pharmacies…')
const w3 = []
for (const u of USERS) for (let i = 0; i < int(2, 6); i++) w3.push({ buyer: u, seller: chance(0.6) ? pick(RETS.slice(0, 8)) : pick(RETS), consumer: true, state: i === 0 ? 'delivered' : pick(['delivered', 'delivered', 'delivered', 'delivered', 'pending', 'accepted', 'cancelled', 'rejected']), daysAgo: int(0, 40) })
for (const j of shuffle(w3)) await flow(j)
log(`  ${counters.orders} orders so far`)

// ---------- POS bills ----------
log('Counter sales (POS)…')
const CUST = Array.from({ length: 45 }, () => ({ name: person(), phone: `9${int(100000000, 999999999)}` }))
let bills = 0
for (const r of RETS) {
  const inv = (await clients[r].from('inventory').select('quantity, reserved, batches(status, expiry_date, medicine_id)')).data ?? []
  const meds = [...new Set(inv.filter(i => i.quantity - i.reserved > 20 && i.batches.status === 'active' && i.batches.expiry_date >= dateOnly(Date.now())).map(i => i.batches.medicine_id))]
  if (meds.length < 2) continue
  const n = int(10, 30)
  for (let i = 0; i < n; i++) {
    try {
      const cust = chance(0.7) ? pick(CUST) : { name: '', phone: '' }
      const lines = shuffle(meds).slice(0, int(1, 4)).map(medicine_id => ({ medicine_id, quantity: int(1, 5) }))
      const billId = await rpc(r, 'create_bill_ex', { p_lines: lines, p_customer_name: cust.name, p_customer_phone: cust.phone, p_discount: chance(0.2) ? int(2, 20) : 0, p_payment_mode: pick(['cash', 'cash', 'upi', 'upi', 'card', 'credit']) })
      bills++
      const when = Date.now() - int(0, 44) * DAY - int(0, 600) * 60000 + 9 * 3600000
      const t = iso(Math.min(when, Date.now() - 30000))
      const { data: bill } = await admin.from('sale_bills').update({ created_at: t }).eq('id', billId).select('bill_no').single()
      await admin.from('stock_movements').update({ created_at: t }).eq('owner_id', ids[r]).eq('note', bill.bill_no).eq('movement_type', 'sale')
      if (chance(0.06)) {
        const l = (await admin.from('sale_bill_lines').select('id').eq('bill_id', billId).limit(1)).data[0]
        await rpc(r, 'refund_bill', { p_bill_id: billId, p_lines: [{ line_id: l.id, quantity: 1 }], p_reason: 'Customer return' })
      }
    } catch (e) { note('pos', e) }
  }
}
log(`  ${bills} bills`)

// ---------- favourites & misc ----------
for (const u of USERS) for (const r of shuffle(RETS.slice(0, 10)).slice(0, int(0, 3))) await clients[u].from('favorites').upsert({ user_id: ids[u], seller_id: ids[r] }, { onConflict: 'user_id,seller_id' })

// ---------- recall (late, so downstream holders exist) ----------
log('Recall scenario…')
try {
  const held = (await admin.from('inventory').select('batch_id, owner_id, quantity, batches!inner(status, manufacturer_id, expiry_date, batch_no)').gt('quantity', 0).eq('batches.status', 'active').gte('batches.expiry_date', dateOnly(Date.now()))).data
  const counts = {}
  for (const h of held) if (h.owner_id !== h.batches.manufacturer_id) counts[h.batch_id] = (counts[h.batch_id] ?? 0) + 1
  const target = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  if (target) {
    const mfrId = held.find(h => h.batch_id === target[0]).batches.manufacturer_id
    const mk = MFRS.find(m => ids[m] === mfrId)
    const n = await rpc(mk, 'recall_batch', { p_batch_id: target[0], p_reason: 'Failed dissolution test in retained sample — quarantine and return to supplier.' })
    const holders = held.filter(h => h.batch_id === target[0] && h.owner_id !== mfrId)
    for (const h of holders.slice(0, Math.ceil(holders.length / 2))) {
      const k = accounts.find(a => ids[a.key] === h.owner_id)?.key
      if (k) await rpc(k, 'ack_recall', { p_batch_id: target[0], p_status: pick(['quarantined', 'returned', 'disposed']), p_note: 'Done' }).catch(() => {})
    }
    log(`  recalled batch ${held.find(h => h.batch_id === target[0]).batches.batch_no}, ${n} holders notified`)
  }
} catch (e) { note('recall', e) }

// ---------- a few unread notifications look fresh ----------
await admin.from('notifications').update({ read: true }).lt('created_at', iso(Date.now() - 7 * DAY))

// ---------- summary ----------
const tables = ['profiles', 'medicines', 'batches', 'inventory', 'orders', 'order_items', 'shipments', 'invoices', 'payments', 'returns', 'sale_bills', 'sale_bill_lines', 'reviews', 'stock_movements', 'notifications']
log('\nRow counts:')
for (const t of tables) { const { count } = await admin.from(t).select('*', { count: 'exact', head: true }); log(' ', t.padEnd(16), count) }
log(`\nOrders created this run: ${counters.orders}, skipped/failed steps: ${counters.failed}`)
if (counters.failed) { log('Failure reasons (usually just stock shortages):'); for (const [k, v] of Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 8)) log(`  ${v}×  ${k}`) }
log('\nLogins (password Demo@1234): factory2..4@, dealer2..6@, pharmacy3..20@, customer2..28@ + medos.demo')
