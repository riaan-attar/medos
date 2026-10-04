import { supabase } from './supabase'
import type {
  AccountBalance, AdminOverview, Alternative, AppNotification, AuditRow, AvailabilityRow, Batch, CatalogItem,
  DashboardAnalytics, DashboardStats, Distribution, InventoryRow, Invoice, Listing, Medicine, Movement, Order,
  MyContext, OrderBundle, OrderEvent, OrderMessage, OrgInvite, Payment, PharmacyProfile, Profile, ReorderSuggestion, RetailCustomer,
  H1Entry, ReportRow, ReturnRow, Review, SaleBill, Shipment, Supplier, TeamMember, TradeRelation, VerifyResult, InviteInfo,
} from './types'

// Unwraps { data, error } and throws so callers can use try/catch
function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

const PARTY = 'id, org_name, full_name, role, city, address, phone, gstin'

export const api = {
  // ---- profile
  async profile(id: string) {
    return ok(await supabase.from('profiles').select('*').eq('id', id).single()) as Profile
  },
  async updateProfile(id: string, patch: Partial<Pick<Profile, 'full_name' | 'org_name' | 'phone' | 'address' | 'city' | 'license_no' | 'lat' | 'lng' | 'about' | 'gstin' | 'state' | 'state_code' | 'accepted_terms_at'>>) {
    ok(await supabase.from('profiles').update(patch).eq('id', id))
  },

  async context() {
    return ok(await supabase.rpc('my_context')) as MyContext
  },

  // ---- team
  async team() {
    return ok(await supabase.rpc('list_team')) as TeamMember[]
  },
  async invites() {
    return ok(await supabase.from('org_invites').select('*').is('used_by', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })) as OrgInvite[]
  },
  async createInvite(role: string, email: string) {
    return ok(await supabase.rpc('create_invite', { p_role: role, p_email: email })) as string
  },
  async revokeInvite(code: string) {
    ok(await supabase.rpc('revoke_invite', { p_code: code }))
  },
  async setMember(userId: string, role: string, active: boolean) {
    ok(await supabase.rpc('set_member', { p_user: userId, p_role: role, p_active: active }))
  },
  async checkInvite(code: string) {
    return ok(await supabase.rpc('check_invite', { p_code: code })) as InviteInfo | null
  },

  // ---- medicines & batches (manufacturer)
  async myMedicines(uid: string) {
    return ok(await supabase.from('medicines').select('*').eq('manufacturer_id', uid).order('name')) as Medicine[]
  },
  async saveMedicine(m: Partial<Medicine> & { manufacturer_id: string }) {
    const { id, ...rest } = m
    if (id) ok(await supabase.from('medicines').update(rest).eq('id', id))
    else ok(await supabase.from('medicines').insert(rest))
  },
  async myBatches(uid: string) {
    return ok(
      await supabase.from('batches').select('*, medicines(*)').eq('manufacturer_id', uid).order('created_at', { ascending: false }),
    ) as (Batch & { medicines: Medicine })[]
  },
  async createBatch(a: { medicine_id: string; batch_no: string; mfg_date: string; expiry_date: string; quantity: number }) {
    return ok(await supabase.rpc('create_batch', {
      p_medicine_id: a.medicine_id, p_batch_no: a.batch_no, p_mfg_date: a.mfg_date,
      p_expiry_date: a.expiry_date, p_quantity: a.quantity,
    })) as string
  },
  async recallBatch(batchId: string, reason: string) {
    return ok(await supabase.rpc('recall_batch', { p_batch_id: batchId, p_reason: reason })) as number
  },

  // ---- inventory
  async inventory(uid: string) {
    return ok(
      await supabase.from('inventory').select('*, batches(*, medicines(*))').eq('owner_id', uid).gt('quantity', 0).order('updated_at', { ascending: false }),
    ) as InventoryRow[]
  },
  async listings(uid: string) {
    return ok(await supabase.from('listings').select('*, medicines(*)').eq('owner_id', uid)) as Listing[]
  },
  async updateListing(id: string, patch: { unit_price?: number; reorder_level?: number }) {
    ok(await supabase.from('listings').update(patch).eq('id', id))
  },
  async adjustStock(batchId: string, delta: number, type: string, note: string) {
    ok(await supabase.rpc('adjust_stock', { p_batch_id: batchId, p_delta: delta, p_type: type, p_note: note }))
  },
  async recordSale(batchId: string, qty: number, price: number, customer: string) {
    ok(await supabase.rpc('record_sale', { p_batch_id: batchId, p_quantity: qty, p_unit_price: price, p_customer: customer }))
  },
  async movements(uid: string, limit = 200) {
    return ok(
      await supabase
        .from('stock_movements')
        .select('*, medicines(name, strength), batches(batch_no), counterparty:profiles!stock_movements_counterparty_id_fkey(org_name, full_name)')
        .eq('owner_id', uid).order('created_at', { ascending: false }).limit(limit),
    ) as unknown as Movement[]
  },

  // ---- marketplace / orders
  async suppliers(lat?: number | null, lng?: number | null) {
    return ok(await supabase.rpc('list_suppliers', { p_lat: lat ?? null, p_lng: lng ?? null })) as Supplier[]
  },
  async catalog(sellerId: string) {
    return ok(await supabase.rpc('get_supplier_catalog', { p_seller: sellerId })) as CatalogItem[]
  },
  async searchAvailability(q: string, lat?: number | null, lng?: number | null) {
    return ok(await supabase.rpc('search_availability', { p_query: q, p_lat: lat ?? null, p_lng: lng ?? null })) as AvailabilityRow[]
  },
  async placeOrder(sellerId: string, items: { medicine_id: string; quantity: number }[], notes: string, prescriptionPath?: string | null) {
    return ok(await supabase.rpc('place_order', {
      p_seller: sellerId, p_items: items, p_notes: notes, p_prescription_path: prescriptionPath ?? null,
    })) as string
  },
  async orders(uid: string) {
    return ok(
      await supabase
        .from('orders')
        .select(`*, buyer:profiles!orders_buyer_id_fkey(${PARTY}), seller:profiles!orders_seller_id_fkey(${PARTY})`)
        .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)
        .order('created_at', { ascending: false }),
    ) as unknown as Order[]
  },
  async order(id: string) {
    return ok(
      await supabase
        .from('orders')
        .select(`*, buyer:profiles!orders_buyer_id_fkey(${PARTY}), seller:profiles!orders_seller_id_fkey(${PARTY}),
                 order_items(*, medicines(*)), order_allocations(*, batches(*))`)
        .eq('id', id).single(),
    ) as unknown as Order
  },
  async advanceOrder(id: string, action: 'accept' | 'reject' | 'cancel' | 'close' | 'receive', note = '') {
    ok(await supabase.rpc('advance_order', { p_order_id: id, p_action: action, p_note: note }))
  },
  async shipOrder(id: string, quantities: Record<string, number> | null, eta: string | null, tracking: string) {
    return ok(await supabase.rpc('ship_order', { p_order_id: id, p_quantities: quantities, p_eta: eta || null, p_tracking: tracking })) as string
  },
  async receiveShipment(id: string) {
    ok(await supabase.rpc('receive_shipment', { p_shipment_id: id }))
  },
  async orderBundle(id: string): Promise<OrderBundle> {
    const [order, invoice, payments, shipments, returns, events, messages, review] = await Promise.all([
      api.order(id),
      supabase.from('invoices').select('*').eq('order_id', id).maybeSingle(),
      supabase.from('payments').select('*').eq('order_id', id).order('paid_at'),
      supabase.from('shipments')
        .select('*, shipment_lines(*, batches(batch_no, expiry_date), order_items(medicines(name, strength)))')
        .eq('order_id', id).order('shipped_at'),
      supabase.from('returns')
        .select('*, return_items(*, batches(batch_no), order_items(medicines(name)))').eq('order_id', id).order('created_at'),
      supabase.from('order_events').select('*').eq('order_id', id).order('created_at'),
      supabase.from('order_messages').select('*').eq('order_id', id).order('created_at'),
      supabase.from('reviews').select('*').eq('order_id', id).maybeSingle(),
    ])
    return {
      order,
      invoice: ok(invoice) as Invoice | null,
      payments: (ok(payments) ?? []) as Payment[],
      shipments: (ok(shipments) ?? []) as unknown as Shipment[],
      returns: (ok(returns) ?? []) as unknown as ReturnRow[],
      events: (ok(events) ?? []) as OrderEvent[],
      messages: (ok(messages) ?? []) as OrderMessage[],
      review: ok(review) as Review | null,
    }
  },
  async sendMessage(orderId: string, senderId: string, body: string) {
    ok(await supabase.from('order_messages').insert({ order_id: orderId, sender_id: senderId, body }))
  },
  async recordPayment(invoiceId: string, amount: number, method: string, reference: string, note: string) {
    ok(await supabase.rpc('record_payment', { p_invoice_id: invoiceId, p_amount: amount, p_method: method, p_reference: reference, p_note: note }))
  },
  async requestReturn(orderId: string, items: { batch_id: string; quantity: number }[], reason: string) {
    return ok(await supabase.rpc('request_return', { p_order_id: orderId, p_items: items, p_reason: reason })) as string
  },
  async respondReturn(id: string, action: 'approve' | 'reject', note = '') {
    ok(await supabase.rpc('respond_return', { p_return_id: id, p_action: action, p_note: note }))
  },
  async returns() {
    return ok(await supabase.from('returns')
      .select(`*, orders(order_no), buyer:profiles!returns_buyer_id_fkey(${PARTY}), seller:profiles!returns_seller_id_fkey(${PARTY}),
               return_items(*, batches(batch_no), order_items(medicines(name)))`)
      .order('created_at', { ascending: false })) as unknown as ReturnRow[]
  },
  async submitReview(orderId: string, rating: number, comment: string) {
    ok(await supabase.rpc('submit_review', { p_order_id: orderId, p_rating: rating, p_comment: comment }))
  },

  // ---- invoices / accounts
  async invoices() {
    return ok(await supabase.from('invoices')
      .select(`*, orders(order_no), buyer:profiles!invoices_buyer_id_fkey(${PARTY}), seller:profiles!invoices_seller_id_fkey(${PARTY})`)
      .order('created_at', { ascending: false })) as unknown as Invoice[]
  },
  async balances() {
    return ok(await supabase.rpc('account_balances')) as AccountBalance[]
  },
  async relations(sellerId: string) {
    return ok(await supabase.from('trade_relations').select('*').eq('seller_id', sellerId)) as TradeRelation[]
  },
  async saveRelation(sellerId: string, buyerId: string, credit: number | null, discount: number) {
    ok(await supabase.from('trade_relations').upsert(
      { seller_id: sellerId, buyer_id: buyerId, credit_limit: credit, discount_pct: discount }, { onConflict: 'seller_id,buyer_id' }))
  },
  async buyerDirectory(sellerRole: 'manufacturer' | 'distributor') {
    const roles = sellerRole === 'manufacturer' ? ['distributor', 'retailer'] : ['retailer']
    return ok(await supabase.from('profiles').select('*').in('role', roles).eq('status', 'active').is('org_id', null).order('org_name')) as Profile[]
  },

  // ---- POS
  async createBill(
    lines: { medicine_id: string; quantity: number; unit_price?: number }[], name: string, phone: string, discount: number, mode: string,
    rx: { patient?: string; doctor?: string; doctorReg?: string; rxNo?: string } = {},
  ) {
    return ok(await supabase.rpc('create_bill_ex', {
      p_lines: lines, p_customer_name: name, p_customer_phone: phone, p_discount: discount, p_payment_mode: mode,
      p_patient: rx.patient ?? '', p_doctor: rx.doctor ?? '', p_doctor_reg: rx.doctorReg ?? '', p_rx_no: rx.rxNo ?? '',
    })) as string
  },
  async h1Register() {
    return ok(await supabase.from('h1_register')
      .select('*, medicines(name, strength), batches(batch_no), sale_bills(bill_no)').order('sold_at', { ascending: false }).limit(1000)) as unknown as H1Entry[]
  },
  async bills(limit = 300) {
    return ok(await supabase.from('sale_bills')
      .select('*, sale_bill_lines(*, batches(batch_no), medicines(name, strength))')
      .order('created_at', { ascending: false }).limit(limit)) as unknown as SaleBill[]
  },
  async bill(id: string) {
    return ok(await supabase.from('sale_bills')
      .select('*, sale_bill_lines(*, batches(batch_no), medicines(name, strength))').eq('id', id).single()) as unknown as SaleBill
  },
  async refundBill(id: string, lines: { line_id: string; quantity: number }[], reason: string) {
    return ok(await supabase.rpc('refund_bill', { p_bill_id: id, p_lines: lines, p_reason: reason })) as number
  },
  async customers() {
    return ok(await supabase.from('retail_customers').select('*').order('created_at', { ascending: false })) as RetailCustomer[]
  },

  // ---- discovery
  async alternatives(medicineId: string) {
    return ok(await supabase.rpc('alternatives', { p_medicine_id: medicineId })) as Alternative[]
  },
  async pharmacy(id: string) {
    return ok(await supabase.rpc('pharmacy_profile', { p_id: id })) as PharmacyProfile | null
  },
  async setFavorite(userId: string, sellerId: string, on: boolean) {
    if (on) ok(await supabase.from('favorites').upsert({ user_id: userId, seller_id: sellerId }, { onConflict: 'user_id,seller_id' }))
    else ok(await supabase.from('favorites').delete().eq('user_id', userId).eq('seller_id', sellerId))
  },
  async reorderSuggestions() {
    return ok(await supabase.rpc('reorder_suggestions')) as ReorderSuggestion[]
  },
  async uploadPrescription(uid: string, file: File) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${uid}/${Date.now()}-${safe}`
    const { error } = await supabase.storage.from('prescriptions').upload(path, file, { contentType: file.type })
    if (error) throw new Error(error.message)
    return path
  },
  async prescriptionUrl(path: string) {
    const { data, error } = await supabase.storage.from('prescriptions').createSignedUrl(path, 300)
    if (error) throw new Error(error.message)
    return data.signedUrl
  },

  // ---- recalls
  async ackRecall(batchId: string, status: string, note: string) {
    ok(await supabase.rpc('ack_recall', { p_batch_id: batchId, p_status: status, p_note: note }))
  },
  async distribution(batchId: string) {
    return ok(await supabase.rpc('batch_distribution', { p_batch_id: batchId })) as Distribution[]
  },
  async myAcks() {
    return ok(await supabase.from('recall_acks').select('batch_id, status, note')) as { batch_id: string; status: string; note: string }[]
  },
  async analytics() {
    return ok(await supabase.rpc('dashboard_analytics')) as DashboardAnalytics
  },

  // ---- misc
  async dashboard() {
    return ok(await supabase.rpc('dashboard_stats')) as DashboardStats
  },
  async verifyBatch(batchNo: string) {
    return ok(await supabase.rpc('verify_batch', { p_batch_no: batchNo })) as VerifyResult[]
  },
  async notifications() {
    return ok(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) as AppNotification[]
  },
  async markRead(ids: string[]) {
    ok(await supabase.from('notifications').update({ read: true }).in('id', ids))
  },
  async deleteNotification(id: string) {
    ok(await supabase.from('notifications').delete().eq('id', id))
  },

  // ---- reports
  async report(name: string, args: Record<string, string | undefined> = {}) {
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
    return ok(await supabase.rpc(name, clean)) as ReportRow[]
  },

  // ---- admin
  async adminOverview() {
    return ok(await supabase.rpc('admin_overview')) as AdminOverview
  },
  async allProfiles() {
    return ok(await supabase.from('profiles').select('*').order('created_at', { ascending: false })) as Profile[]
  },
  async setVerified(id: string, value: boolean) {
    ok(await supabase.rpc('set_verified', { p_user: id, p_value: value }))
  },
  async setStatus(id: string, status: 'active' | 'suspended') {
    ok(await supabase.rpc('set_status', { p_user: id, p_status: status }))
  },
  async allOrders(limit = 200) {
    return ok(await supabase.from('orders')
      .select(`*, buyer:profiles!orders_buyer_id_fkey(${PARTY}), seller:profiles!orders_seller_id_fkey(${PARTY})`)
      .order('created_at', { ascending: false }).limit(limit)) as unknown as Order[]
  },
  async recalledBatches() {
    return ok(await supabase.from('batches').select('*, medicines(*)').eq('status', 'recalled').order('created_at', { ascending: false })) as unknown as (Batch & { medicines: Medicine })[]
  },
  async audit(limit = 200) {
    return ok(await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit)) as AuditRow[]
  },
}
