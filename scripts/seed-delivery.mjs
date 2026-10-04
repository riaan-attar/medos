// Demo data for home delivery: enables delivery on most pharmacies, saves customer addresses and
// places delivery orders in every status.   (load .env) node scripts/seed-delivery.mjs
// Run after the v3_delivery migration and after seed-bulk.mjs.
import { createClient } from '@supabase/supabase-js'
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) { console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const PASSWORD = 'Demo@1234'
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let seed = 4242
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = a => a[Math.floor(rnd() * a.length)]
const DAY = 86400000

const { data: profiles } = await admin.from('profiles').select('id, role, org_name, full_name, lat, lng, city').is('org_id', null)
const { data: users } = (await admin.auth.admin.listUsers({ perPage: 1000 }))
const emailOf = id => users.users.find(u => u.id === id)?.email
const retailers = profiles.filter(p => p.role === 'retailer' && p.lat != null)
const consumers = profiles.filter(p => p.role === 'consumer' && p.lat != null)
if (!retailers.length || !consumers.length) { console.error('Run seed.mjs and seed-bulk.mjs first'); process.exit(1) }

// 70% of pharmacies deliver, with varied terms
let enabled = []
for (const r of retailers) {
  if (rnd() < 0.7) {
    const { error } = await admin.from('profiles').update({ delivery_enabled: true, delivery_radius_km: pick([2, 3, 5, 8]), delivery_fee: pick([0, 20, 30, 40, 50]), delivery_min_order: pick([0, 100, 150, 200]), delivery_free_above: pick([null, 400, 500, 800]) }).eq('id', r.id)
    if (error) { console.error('Delivery columns missing — apply 20261009000000_v3_delivery.sql first:', error.message); process.exit(1) }
    enabled.push(r)
  }
}
console.log(`${enabled.length}/${retailers.length} pharmacies now deliver`)

const STREETS = ['MG Road', 'Station Road', 'Park Street', 'Lake View Colony', 'Green Park', 'Sector 14', 'Rose Garden Lane', 'Temple Road', 'Hill View Society', 'Market Yard']
const clients = {}
async function client(p) {
  if (clients[p.id]) return clients[p.id]
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: emailOf(p.id), password: PASSWORD })
  if (error) throw new Error(`${emailOf(p.id)}: ${error.message}`)
  return (clients[p.id] = c)
}

// saved addresses (home near the customer, sometimes an office)
let addrs = 0
for (const u of consumers) {
  const c = await client(u)
  const { count } = await c.from('customer_addresses').select('*', { count: 'exact', head: true })
  if (count) continue
  const rows = [{ user_id: u.id, label: 'Home', address: `${int(1, 90)}, ${pick(STREETS)}, ${u.city}`, phone: `9${int(100000000, 999999999)}`, lat: u.lat, lng: u.lng, is_default: true }]
  if (rnd() < 0.4) rows.push({ user_id: u.id, label: 'Office', address: `${int(1, 40)}th Floor, Tech Park, ${u.city}`, phone: rows[0].phone, lat: u.lat + (rnd() - 0.5) * 0.03, lng: u.lng + (rnd() - 0.5) * 0.03, is_default: false })
  const { error } = await c.from('customer_addresses').insert(rows)
  if (!error) addrs += rows.length
}
console.log(`${addrs} addresses saved`)

// delivery orders
const STATES = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'pending', 'accepted', 'cancelled', 'rejected']
let placed = 0, skipped = {}
const skip = e => { const k = e.message.slice(0, 70); skipped[k] = (skipped[k] ?? 0) + 1 }
for (let i = 0; i < 40; i++) {
  const u = pick(consumers), r = pick(enabled), state = pick(STATES)
  try {
    const c = await client(u), rc = await client(r)
    const { data: addr } = await c.from('customer_addresses').select('*').eq('user_id', u.id).order('is_default', { ascending: false }).limit(1)
    const a = addr?.[0]; if (!a) continue
    const { data: cat } = await c.rpc('get_supplier_catalog', { p_seller: r.id })
    const items = (cat ?? []).filter(x => !x.requires_rx).sort(() => rnd() - 0.5).slice(0, int(1, 3)).map(x => ({ medicine_id: x.medicine_id, quantity: Math.min(x.available, int(1, 5)) }))
    if (!items.length) continue
    const { data: oid, error } = await c.rpc('place_order', { p_seller: r.id, p_items: items, p_notes: 'Please ring the bell', p_fulfilment: 'delivery', p_delivery_address: a.address, p_delivery_lat: a.lat, p_delivery_lng: a.lng, p_delivery_phone: a.phone })
    if (error) throw error
    placed++
    if (state === 'rejected') await rc.rpc('advance_order', { p_order_id: oid, p_action: 'reject', p_note: 'Rider unavailable' })
    else if (state === 'cancelled') await c.rpc('advance_order', { p_order_id: oid, p_action: 'cancel', p_note: 'Changed my mind' })
    else if (state !== 'pending') {
      await rc.rpc('advance_order', { p_order_id: oid, p_action: 'accept', p_note: '' })
      if (state === 'delivered') await rc.rpc('ship_order', { p_order_id: oid, p_quantities: null, p_eta: null, p_tracking: '' })
    }
    // backdate over the last 3 weeks
    const ts = Date.now() - int(0, 21) * DAY - int(0, 12) * 3600000
    const iso = x => new Date(Math.min(x, Date.now() - 60000)).toISOString()
    const { data: o } = await admin.from('orders').select('shipped_at, delivered_at').eq('id', oid).single()
    await admin.from('orders').update({ created_at: iso(ts), updated_at: iso(ts + 3600000), shipped_at: o.shipped_at ? iso(ts + 2 * 3600000) : null, delivered_at: o.delivered_at ? iso(ts + 3 * 3600000) : null }).eq('id', oid)
    await admin.from('invoices').update({ created_at: iso(ts + 600000) }).eq('order_id', oid)
    await admin.from('payments').update({ paid_at: iso(ts + 3 * 3600000) }).eq('order_id', oid)
    await admin.from('shipments').update({ shipped_at: iso(ts + 2 * 3600000), received_at: iso(ts + 3 * 3600000) }).eq('order_id', oid)
    await admin.from('order_events').update({ created_at: iso(ts + 600000) }).eq('order_id', oid)
    await admin.from('stock_movements').update({ created_at: iso(ts + 2 * 3600000) }).eq('order_id', oid)
    if (state === 'delivered' && rnd() < 0.6) await c.rpc('submit_review', { p_order_id: oid, p_rating: pick([5, 5, 4, 4, 3]), p_comment: pick(['Delivered within the hour!', 'Rider was polite and quick.', 'Good packaging.', 'A bit late but fine.']) })
  } catch (e) { skip(e) }
}
console.log(`${placed} delivery orders placed`)
const reasons = Object.entries(skipped); if (reasons.length) { console.log('Skipped (expected: radius / minimum / stock):'); for (const [k, v] of reasons) console.log(`  ${v}×  ${k}`) }
