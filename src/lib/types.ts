export type Role = 'manufacturer' | 'distributor' | 'retailer' | 'consumer' | 'admin'
export type OrderStatus = 'pending' | 'accepted' | 'partially_shipped' | 'rejected' | 'shipped' | 'delivered' | 'cancelled'
export type MovementType =
  | 'production' | 'transfer_in' | 'transfer_out' | 'sale'
  | 'adjustment' | 'damage' | 'expired_writeoff' | 'recall_writeoff'
  | 'return_in' | 'return_out' | 'sale_return'

export interface Profile {
  id: string
  role: Role
  full_name: string
  org_name: string
  phone: string
  address: string
  city: string
  license_no: string
  verified: boolean
  lat: number | null
  lng: number | null
  about: string
  gstin: string
  status: 'active' | 'suspended'
  org_id: string | null
  state: string
  state_code: string
  accepted_terms_at: string | null
  delivery_enabled: boolean
  delivery_radius_km: number
  delivery_fee: number
  delivery_min_order: number
  delivery_free_above: number | null
  created_at: string
}

export interface Medicine {
  id: string
  manufacturer_id: string
  name: string
  generic_name: string
  category: string
  dosage_form: string
  strength: string
  pack_size: string
  mrp: number
  requires_rx: boolean
  gst_rate: number
  barcode: string
  hsn_code: string
  drug_schedule: 'OTC' | 'H' | 'H1' | 'X'
  composition: string
  active: boolean
}

export interface Batch {
  id: string
  medicine_id: string
  manufacturer_id: string
  batch_no: string
  mfg_date: string
  expiry_date: string
  quantity: number
  status: 'active' | 'recalled'
  recall_reason: string | null
  created_at: string
  medicines?: Medicine
}

export interface InventoryRow {
  id: string
  owner_id: string
  batch_id: string
  quantity: number
  reserved: number
  batches: Batch & { medicines: Medicine }
}

export interface Listing {
  id: string
  owner_id: string
  medicine_id: string
  unit_price: number
  reorder_level: number
  medicines: Medicine
}

export interface OrderItem {
  id: string
  medicine_id: string
  quantity: number
  shipped_qty: number
  gst_rate: number
  unit_price: number
  medicines: Medicine
}

export interface Allocation {
  id: string
  order_item_id: string
  batch_id: string
  quantity: number
  batches: Batch
}

export interface Order {
  id: string
  order_no: string
  buyer_id: string
  seller_id: string
  status: OrderStatus
  notes: string
  status_note: string
  total: number
  prescription_path: string | null
  fulfilment: 'pickup' | 'delivery'
  delivery_address: string
  delivery_lat: number | null
  delivery_lng: number | null
  delivery_phone: string
  delivery_fee: number
  created_at: string
  shipped_at: string | null
  delivered_at: string | null
  buyer: Party | null
  seller: Party | null
  order_items?: OrderItem[]
  order_allocations?: Allocation[]
}

export interface Movement {
  id: string
  batch_id: string
  movement_type: MovementType
  quantity: number
  note: string
  created_at: string
  order_id: string | null
  medicines: Pick<Medicine, 'name' | 'strength'>
  batches: Pick<Batch, 'batch_no'>
  counterparty: { org_name: string; full_name: string } | null
}

export interface AppNotification {
  id: string
  title: string
  body: string
  link: string | null
  category: string
  read: boolean
  created_at: string
}

export interface Supplier {
  id: string
  role: Role
  org_name: string
  full_name: string
  city: string
  address: string
  phone: string
  verified: boolean
  medicines_in_stock: number
  distance_km: number | null
  rating_avg: number | null
  rating_count: number
  is_favorite: boolean
  lat: number | null
  lng: number | null
  delivery_enabled: boolean
  delivery_fee: number
  delivery_min_order: number
  delivery_radius_km: number
  delivery_free_above: number | null
}

export interface CatalogItem {
  medicine_id: string
  name: string
  generic_name: string
  category: string
  dosage_form: string
  strength: string
  pack_size: string
  mrp: number
  requires_rx: boolean
  gst_rate: number
  unit_price: number
  available: number
  nearest_expiry: string
}

export interface AvailabilityRow {
  seller_id: string
  org_name: string
  city: string
  address: string
  phone: string
  verified: boolean
  medicine_id: string
  medicine: string
  generic_name: string
  strength: string
  dosage_form: string
  requires_rx: boolean
  mrp: number
  unit_price: number
  available: number
  distance_km: number | null
  rating_avg: number | null
  rating_count: number
  lat: number | null
  lng: number | null
  delivery_enabled: boolean
  delivery_fee: number
  delivery_min_order: number
}

export interface DashboardStats {
  total_units: number
  distinct_medicines: number
  inventory_value: number
  expiring_30d: number
  expired: number
  recalled: number
  low_stock: number
  incoming_pending: number
  to_ship: number
  outgoing_open: number
  awaiting_receipt: number
  open_returns: number
  revenue_30d: number
  spend_30d: number
  produced_30d: number
  activity_14d: { day: string; in: number; out: number }[]
}

export interface AdminOverview {
  manufacturers: number
  distributors: number
  retailers: number
  consumers: number
  unverified: number
  orders: number
  open_orders: number
  batches: number
  recalled: number
  suspended: number
  units_in_system: number
  gmv_30d: number
  outstanding: number
  orders_14d: { day: string; orders: number; value: number }[]
}

export interface VerifyResult {
  batch_id: string
  batch_no: string
  medicine: string
  generic_name: string
  strength: string
  dosage_form: string
  mrp: number
  manufacturer: string
  manufacturer_verified: boolean
  mfg_date: string
  expiry_date: string
  expired: boolean
  status: 'active' | 'recalled'
  recall_reason: string | null
  custody: { from: string; to: string; at: string }[]
}

export interface DashboardAnalytics {
  stock_by_category: { category: string; units: number }[]
  top_medicines: { name: string; units: number }[]
  sales_30d: { day: string; revenue: number }[]
  expiry_buckets: { expired: number; d30: number; d90: number; d180: number; later: number }
  orders_in: Record<string, number>
  orders_out: Record<string, number>
  receivable: number
  payable: number
  overdue_receivable: number
  overdue_payable: number
  shipped_30d: number
  top_buyers: { name: string; total: number }[]
  top_suppliers: { name: string; total: number }[]
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'
export interface Invoice {
  id: string
  invoice_no: string
  order_id: string
  seller_id: string
  buyer_id: string
  subtotal: number
  tax: number
  total: number
  credit_total: number
  paid_total: number
  cgst: number
  sgst: number
  igst: number
  delivery_fee: number
  place_of_supply: string
  tax_breakup: { rate: number; taxable: number; tax: number }[]
  due_date: string
  status: InvoiceStatus
  created_at: string
  orders?: { order_no: string }
  buyer?: Party | null
  seller?: Party | null
}

export interface Payment {
  id: string
  invoice_id: string
  amount: number
  method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque'
  reference: string
  note: string
  paid_at: string
}

export interface Party { id: string; org_name: string; full_name: string; role: Role; city: string; address?: string; phone?: string; gstin?: string }

export interface ShipmentLine {
  id: string
  quantity: number
  order_item_id: string
  batch_id: string
  batches: { batch_no: string; expiry_date: string } | null
  order_items: { medicines: { name: string; strength: string } } | null
}
export interface Shipment {
  id: string
  order_id: string
  shipped_at: string
  eta: string | null
  tracking_note: string
  received_at: string | null
  shipment_lines: ShipmentLine[]
}

export interface ReturnRow {
  id: string
  return_no: string
  order_id: string
  buyer_id: string
  seller_id: string
  status: 'requested' | 'completed' | 'rejected'
  reason: string
  response_note: string
  credit_amount: number
  created_at: string
  orders?: { order_no: string }
  buyer?: Party | null
  seller?: Party | null
  return_items: { id: string; quantity: number; unit_price: number; batches: { batch_no: string } | null; order_items: { medicines: { name: string } } | null }[]
}

export interface OrderEvent { id: string; event: string; note: string; created_at: string; actor_id: string | null }
export interface OrderMessage { id: string; sender_id: string; body: string; created_at: string }
export interface Review { id: string; rating: number; comment: string; created_at: string }

export interface OrderBundle {
  order: Order
  invoice: Invoice | null
  payments: Payment[]
  shipments: Shipment[]
  returns: ReturnRow[]
  events: OrderEvent[]
  messages: OrderMessage[]
  review: Review | null
}

export interface ReorderSuggestion {
  medicine_id: string
  name: string
  strength: string
  pack_size: string
  available: number
  reorder_level: number
  suggested_qty: number
  supplier_id: string | null
  supplier_name: string | null
  unit_price: number | null
  supplier_available: number | null
}

export interface AccountBalance {
  counterparty_id: string
  org_name: string
  role: Role
  receivable: number
  payable: number
  overdue: number
}

export interface TradeRelation { seller_id: string; buyer_id: string; credit_limit: number | null; discount_pct: number }

export interface SaleBillLine {
  id: string
  quantity: number
  returned_qty: number
  unit_price: number
  gst_rate: number
  batch_id: string
  batches: { batch_no: string } | null
  medicines: { name: string; strength: string } | null
}
export interface SaleBill {
  id: string
  bill_no: string
  customer_name: string
  customer_phone: string
  subtotal: number
  discount: number
  total: number
  refunded_total: number
  payment_mode: 'cash' | 'upi' | 'card' | 'credit'
  patient_name: string
  doctor_name: string
  doctor_reg_no: string
  rx_number: string
  created_at: string
  sale_bill_lines?: SaleBillLine[]
}
export interface RetailCustomer { id: string; name: string; phone: string; created_at: string }

export interface Alternative { medicine_id: string; name: string; strength: string; dosage_form: string; pack_size: string; mrp: number; sellers: number }

export interface PharmacyProfile {
  id: string
  role: Role
  org_name: string
  city: string
  address: string
  phone: string
  verified: boolean
  about: string
  lat: number | null
  lng: number | null
  rating_avg: number | null
  rating_count: number
  medicines_in_stock: number
  is_favorite: boolean
  delivery_enabled: boolean
  delivery_fee: number
  delivery_min_order: number
  delivery_radius_km: number
  delivery_free_above: number | null
  reviews: { rating: number; comment: string; who: string; at: string }[]
}

export interface Distribution { owner_id: string; org_name: string; role: Role; quantity: number; ack_status: string | null; ack_note: string | null }

export interface AuditRow { id: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; created_at: string }

export type MemberRole = 'owner' | 'manager' | 'pharmacist' | 'cashier' | 'warehouse' | 'accountant'
export type Permission =
  | 'catalog' | 'batches' | 'recall' | 'stock_adjust' | 'receive' | 'ship' | 'orders_manage' | 'sell' | 'refund'
  | 'payments' | 'partners' | 'pricing' | 'returns' | 'reports' | 'customers' | 'settings' | 'team'

export interface MyContext { org_id: string; member_role: MemberRole; is_staff: boolean; permissions: Permission[] }
export interface TeamMember { user_id: string; full_name: string; email: string | null; member_role: Exclude<MemberRole, 'owner'>; active: boolean; created_at: string }
export interface OrgInvite { code: string; member_role: Exclude<MemberRole, 'owner'>; email: string; expires_at: string; used_by: string | null; created_at: string }
export interface InviteInfo { org_name: string; role: Role; member_role: Exclude<MemberRole, 'owner'> }

export interface H1Entry {
  id: string
  quantity: number
  patient_name: string
  doctor_name: string
  doctor_reg_no: string
  rx_number: string
  sold_at: string
  medicines: { name: string; strength: string } | null
  batches: { batch_no: string } | null
  sale_bills: { bill_no: string } | null
}

export type ReportRow = Record<string, string | number | null>

export interface CustomerAddress { id: string; label: string; address: string; phone: string; lat: number | null; lng: number | null; is_default: boolean }

export interface HeldBill {
  id: string
  label: string
  created_at: string
  payload: { cart: Record<string, number>; prices: Record<string, number>; name: string; phone: string; discount: number; mode: 'cash' | 'upi' | 'card' | 'credit'; rx: { patient: string; doctor: string; doctorReg: string; rxNo: string } }
}
export interface CustomerBalance { customer_id: string; name: string; phone: string; balance: number; last_activity: string | null; bills: number; spent: number }
export interface LedgerEntry { id: string; kind: 'charge' | 'payment' | 'refund'; amount: number; mode: string; note: string; created_at: string; sale_bills: { bill_no: string } | null }
