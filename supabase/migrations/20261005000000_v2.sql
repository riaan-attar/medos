-- =====================================================================
-- MedOS v2 — additive migration (run AFTER 20261004000000_init.sql)
--   * invoices + payments + GST, credit limits & buyer discounts
--   * stock reservation, partial shipments, returns / credit notes
--   * order timeline + messages, prescriptions (Storage), reviews
--   * retail POS bills, customers, refunds
--   * pharmacy locator (distance), favorites, generic alternatives
--   * recall acknowledgements, audit log, account suspension
--   * analytics + reorder-suggestion RPCs
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ALTER EXISTING TABLES
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists about text not null default '',
  add column if not exists gstin text not null default '',
  add column if not exists status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active','suspended'));

alter table public.medicines
  add column if not exists gst_rate numeric(5,2) not null default 12,
  add column if not exists barcode text not null default '';
alter table public.medicines drop constraint if exists medicines_gst_rate_check;
alter table public.medicines add constraint medicines_gst_rate_check check (gst_rate between 0 and 40);

alter table public.inventory add column if not exists reserved integer not null default 0;
alter table public.inventory drop constraint if exists inventory_reserved_check;
alter table public.inventory add constraint inventory_reserved_check check (reserved >= 0 and reserved <= quantity);

alter table public.orders
  add column if not exists prescription_path text;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','accepted','partially_shipped','shipped','delivered','rejected','cancelled'));

alter table public.order_items
  add column if not exists gst_rate numeric(5,2) not null default 0,
  add column if not exists shipped_qty integer not null default 0;

alter table public.order_allocations add column if not exists shipped_qty integer not null default 0;

alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type in
  ('production','transfer_in','transfer_out','sale','adjustment','damage','expired_writeoff',
   'recall_writeoff','return_in','return_out','sale_return'));

alter table public.notifications add column if not exists category text not null default 'general';

-- ---------------------------------------------------------------------
-- 2. NEW TABLES
-- ---------------------------------------------------------------------
create sequence if not exists public.invoice_seq start 5000;
create sequence if not exists public.bill_seq start 1;
create sequence if not exists public.return_seq start 100;

create table if not exists public.shipments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  shipped_at  timestamptz not null default now(),
  eta         date,
  tracking_note text not null default '',
  received_at timestamptz
);
create index if not exists shipments_order_idx on public.shipments (order_id);

create table if not exists public.shipment_lines (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.shipments(id) on delete cascade,
  allocation_id uuid references public.order_allocations(id) on delete set null,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  batch_id      uuid not null references public.batches(id),
  quantity      integer not null check (quantity > 0)
);
create index if not exists shipment_lines_ship_idx on public.shipment_lines (shipment_id);
create index if not exists shipment_lines_batch_idx on public.shipment_lines (batch_id);

create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  invoice_no   text not null unique default ('INV-' || nextval('public.invoice_seq')),
  order_id     uuid not null unique references public.orders(id) on delete cascade,
  seller_id    uuid not null references public.profiles(id),
  buyer_id     uuid not null references public.profiles(id),
  subtotal     numeric(14,2) not null default 0,
  tax          numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  credit_total numeric(14,2) not null default 0,
  paid_total   numeric(14,2) not null default 0,
  due_date     date not null default current_date + 15,
  status       text not null default 'unpaid' check (status in ('unpaid','partial','paid','void')),
  created_at   timestamptz not null default now()
);
create index if not exists invoices_seller_idx on public.invoices (seller_id, status);
create index if not exists invoices_buyer_idx on public.invoices (buyer_id, status);

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  order_id    uuid not null references public.orders(id) on delete cascade,
  seller_id   uuid not null references public.profiles(id),
  buyer_id    uuid not null references public.profiles(id),
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null default 'bank' check (method in ('cash','upi','card','bank','cheque')),
  reference   text not null default '',
  note        text not null default '',
  paid_at     timestamptz not null default now(),
  recorded_by uuid references public.profiles(id)
);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

create table if not exists public.returns (
  id            uuid primary key default gen_random_uuid(),
  return_no     text not null unique default ('RET-' || nextval('public.return_seq')),
  order_id      uuid not null references public.orders(id) on delete cascade,
  buyer_id      uuid not null references public.profiles(id),
  seller_id     uuid not null references public.profiles(id),
  status        text not null default 'requested' check (status in ('requested','completed','rejected')),
  reason        text not null default '',
  response_note text not null default '',
  credit_amount numeric(14,2) not null default 0,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists returns_seller_idx on public.returns (seller_id);
create index if not exists returns_buyer_idx on public.returns (buyer_id);

create table if not exists public.return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.returns(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  batch_id      uuid not null references public.batches(id),
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null,
  gst_rate      numeric(5,2) not null default 0
);

create table if not exists public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  actor_id   uuid references public.profiles(id),
  event      text not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_idx on public.order_events (order_id, created_at);

create table if not exists public.order_messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists order_messages_idx on public.order_messages (order_id, created_at);

create table if not exists public.retail_customers (
  id          uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.profiles(id),
  name        text not null default '',
  phone       text not null,
  created_at  timestamptz not null default now(),
  unique (retailer_id, phone)
);

create table if not exists public.sale_bills (
  id             uuid primary key default gen_random_uuid(),
  bill_no        text not null unique default ('BILL-' || lpad(nextval('public.bill_seq')::text, 6, '0')),
  retailer_id    uuid not null references public.profiles(id),
  customer_id    uuid references public.retail_customers(id),
  customer_name  text not null default '',
  customer_phone text not null default '',
  subtotal       numeric(14,2) not null default 0,
  discount       numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  refunded_total numeric(14,2) not null default 0,
  payment_mode   text not null default 'cash' check (payment_mode in ('cash','upi','card','credit')),
  created_at     timestamptz not null default now()
);
create index if not exists sale_bills_idx on public.sale_bills (retailer_id, created_at desc);

create table if not exists public.sale_bill_lines (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references public.sale_bills(id) on delete cascade,
  batch_id     uuid not null references public.batches(id),
  medicine_id  uuid not null references public.medicines(id),
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(12,2) not null,
  gst_rate     numeric(5,2) not null default 0,
  returned_qty integer not null default 0 check (returned_qty >= 0)
);
create index if not exists sale_bill_lines_idx on public.sale_bill_lines (bill_id);

create table if not exists public.bill_refunds (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references public.sale_bills(id) on delete cascade,
  line_id    uuid not null references public.sale_bill_lines(id) on delete cascade,
  quantity   integer not null check (quantity > 0),
  amount     numeric(14,2) not null,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.trade_relations (
  seller_id    uuid not null references public.profiles(id) on delete cascade,
  buyer_id     uuid not null references public.profiles(id) on delete cascade,
  credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 90),
  primary key (seller_id, buyer_id)
);

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  seller_id   uuid not null references public.profiles(id),
  rating      integer not null check (rating between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists reviews_seller_idx on public.reviews (seller_id);

create table if not exists public.favorites (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  primary key (user_id, seller_id)
);

create table if not exists public.recall_acks (
  batch_id   uuid not null references public.batches(id) on delete cascade,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  status     text not null check (status in ('quarantined','returned','disposed')),
  note       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (batch_id, owner_id)
);

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text not null default '',
  entity_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------
-- 3. HELPERS
-- ---------------------------------------------------------------------

-- suspended accounts lose their role everywhere (RPCs + RLS)
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

-- _notify gains a category (drop the 4-arg form to avoid overload ambiguity)
drop function if exists public._notify(uuid, text, text, text);
create or replace function public._notify(p_user uuid, p_title text, p_body text, p_link text default null, p_category text default 'general')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, link, category) values (p_user, p_title, p_body, p_link, p_category)
$$;

create or replace function public._audit(p_action text, p_entity text, p_entity_id uuid, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, detail) values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail,'{}'::jsonb))
$$;

create or replace function public._event(p_order uuid, p_event text, p_note text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.order_events (order_id, actor_id, event, note) values (p_order, auth.uid(), p_event, coalesce(p_note,''))
$$;

create or replace function public._distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371 * 2 * asin(sqrt(least(1, power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))) end
$$;

-- sellable units = on hand minus reserved, non-expired, non-recalled
create or replace function public._available(p_owner uuid, p_medicine uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.quantity - i.reserved), 0)::int
  from public.inventory i join public.batches b on b.id = i.batch_id
  where i.owner_id = p_owner and b.medicine_id = p_medicine
    and b.status = 'active' and b.expiry_date >= current_date
$$;

create or replace function public._refresh_invoice_status(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_out numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found or i.status = 'void' then return; end if;
  v_out := i.total - i.credit_total - i.paid_total;
  update public.invoices set status = case
      when v_out <= 0.005 then 'paid'
      when i.paid_total > 0 or i.credit_total > 0 then 'partial'
      else 'unpaid' end
  where id = p_invoice;
end $$;

create or replace function public._recalc_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sub numeric; v_tax numeric;
begin
  select id into v_id from public.invoices where order_id = p_order and status <> 'void';
  if v_id is null then return; end if;
  select coalesce(round(sum(quantity * unit_price), 2), 0),
         coalesce(round(sum(quantity * unit_price * gst_rate / 100), 2), 0)
    into v_sub, v_tax from public.order_items where order_id = p_order;
  update public.invoices set subtotal = v_sub, tax = v_tax, total = v_sub + v_tax where id = v_id;
  perform public._refresh_invoice_status(v_id);
end $$;

create or replace function public._create_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; v_role text;
begin
  select * into o from public.orders where id = p_order;
  select role into v_role from public.profiles where id = o.buyer_id;
  insert into public.invoices (order_id, seller_id, buyer_id, due_date)
  values (o.id, o.seller_id, o.buyer_id, current_date + case when v_role = 'consumer' then 0 else 15 end)
  on conflict (order_id) do update set status = case when public.invoices.status = 'void' then 'unpaid' else public.invoices.status end;
  perform public._recalc_invoice(p_order);
end $$;

-- reserve FEFO stock for the still-unreserved remainder of one order line
create or replace function public._reserve_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  it public.order_items; o public.orders; v_have integer; v_need integer; v_take integer; b record;
begin
  select * into it from public.order_items where id = p_item;
  select * into o from public.orders where id = it.order_id;
  select coalesce(sum(quantity - shipped_qty), 0) into v_have from public.order_allocations where order_item_id = it.id;
  v_need := it.quantity - it.shipped_qty - v_have;
  if v_need <= 0 then return; end if;
  for b in
    select i.id as inv_id, i.batch_id, (i.quantity - i.reserved) as free
    from public.inventory i join public.batches bt on bt.id = i.batch_id
    where i.owner_id = o.seller_id and bt.medicine_id = it.medicine_id
      and bt.status = 'active' and bt.expiry_date >= current_date and i.quantity - i.reserved > 0
    order by bt.expiry_date asc, bt.created_at asc
    for update of i
  loop
    exit when v_need <= 0;
    v_take := least(b.free, v_need);
    update public.inventory set reserved = reserved + v_take where id = b.inv_id;
    insert into public.order_allocations (order_item_id, order_id, batch_id, quantity, shipped_qty)
    values (it.id, o.id, b.batch_id, v_take, 0);
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then
    raise exception 'Insufficient sellable stock to reserve for this order (short by %)', v_need;
  end if;
end $$;

create or replace function public._release_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a record; v_seller uuid;
begin
  select o.seller_id into v_seller from public.order_items oi join public.orders o on o.id = oi.order_id where oi.id = p_item;
  for a in select * from public.order_allocations where order_item_id = p_item and quantity > shipped_qty loop
    update public.inventory set reserved = reserved - (a.quantity - a.shipped_qty)
      where owner_id = v_seller and batch_id = a.batch_id;
    if a.shipped_qty = 0 then
      delete from public.order_allocations where id = a.id;
    else
      update public.order_allocations set quantity = shipped_qty where id = a.id;
    end if;
  end loop;
end $$;

create or replace function public._recompute_status(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_all_shipped boolean; v_any boolean; v_unrec boolean; v_new text;
begin
  select * into o from public.orders where id = p_order;
  v_all_shipped := not exists (select 1 from public.order_items where order_id = p_order and shipped_qty < quantity);
  v_any := exists (select 1 from public.shipments where order_id = p_order);
  v_unrec := exists (select 1 from public.shipments where order_id = p_order and received_at is null);
  if not v_any then return; end if;
  v_new := case when v_all_shipped and not v_unrec then 'delivered'
                when v_all_shipped then 'shipped'
                else 'partially_shipped' end;
  update public.orders set status = v_new, updated_at = now(),
    shipped_at = coalesce(shipped_at, now()),
    delivered_at = case when v_new = 'delivered' then coalesce(delivered_at, now()) else null end
  where id = p_order;
end $$;

create or replace function public._receive_shipment(p_shipment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare sh public.shipments; o public.orders; v_role text; l record;
begin
  select * into sh from public.shipments where id = p_shipment;
  if sh.received_at is not null then return; end if;
  select * into o from public.orders where id = sh.order_id;
  select role into v_role from public.profiles where id = o.buyer_id;
  for l in
    select sl.batch_id, sl.quantity, oi.medicine_id, oi.unit_price
    from public.shipment_lines sl join public.order_items oi on oi.id = sl.order_item_id
    where sl.shipment_id = sh.id
  loop
    if v_role <> 'consumer' then
      perform public._move_stock(o.buyer_id, l.batch_id, l.quantity, 'transfer_in', o.id, o.seller_id, o.order_no);
      perform public._ensure_listing(o.buyer_id, l.medicine_id,
        case when v_role = 'retailer' then (select mrp from public.medicines where id = l.medicine_id)
             else l.unit_price * 1.10 end);
    end if;
  end loop;
  update public.shipments set received_at = now() where id = sh.id;
end $$;

-- _move_stock (unchanged; reserved <= quantity is enforced by the inventory check constraint)
create or replace function public._move_stock(
  p_owner uuid, p_batch uuid, p_delta integer, p_type text,
  p_order uuid default null, p_counterparty uuid default null, p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare v_med uuid;
begin
  select medicine_id into v_med from public.batches where id = p_batch;
  insert into public.inventory (owner_id, batch_id, quantity)
  values (p_owner, p_batch, greatest(p_delta, 0))
  on conflict (owner_id, batch_id)
  do update set quantity = public.inventory.quantity + p_delta, updated_at = now();
  insert into public.stock_movements
    (owner_id, batch_id, medicine_id, movement_type, quantity, order_id, counterparty_id, note)
  values (p_owner, p_batch, v_med, p_type, p_delta, p_order, p_counterparty, p_note);
end $$;

-- ---------------------------------------------------------------------
-- 4. REWRITTEN CORE RPCs
-- ---------------------------------------------------------------------

create or replace function public.create_batch(
  p_medicine_id uuid, p_batch_no text, p_mfg_date date, p_expiry_date date, p_quantity integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_med public.medicines;
  v_batch uuid;
begin
  if public.current_role_name() <> 'manufacturer' then raise exception 'Only manufacturers can create batches'; end if;
  select * into v_med from public.medicines where id = p_medicine_id and manufacturer_id = v_uid;
  if not found then raise exception 'Medicine not found in your catalog'; end if;
  if coalesce(trim(p_batch_no),'') = '' then raise exception 'Batch number required'; end if;
  insert into public.batches (medicine_id, manufacturer_id, batch_no, mfg_date, expiry_date, quantity)
  values (p_medicine_id, v_uid, trim(p_batch_no), p_mfg_date, p_expiry_date, p_quantity)
  returning id into v_batch;
  perform public._ensure_listing(v_uid, p_medicine_id, v_med.mrp * 0.60);
  perform public._move_stock(v_uid, v_batch, p_quantity, 'production', null, null, 'Batch ' || trim(p_batch_no) || ' produced');
  perform public._audit('batch.create', 'batch', v_batch, jsonb_build_object('batch_no', p_batch_no, 'qty', p_quantity));
  return v_batch;
end $$;

create or replace function public.adjust_stock(
  p_batch_id uuid, p_delta integer, p_type text, p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare v_delta integer; v_inv public.inventory;
begin
  if auth.uid() is null or public.current_role_name() not in ('manufacturer','distributor','retailer') then
    raise exception 'Not allowed';
  end if;
  if p_type not in ('adjustment','damage','expired_writeoff','recall_writeoff') then
    raise exception 'Invalid adjustment type';
  end if;
  v_delta := case when p_type = 'adjustment' then p_delta else -abs(p_delta) end;
  if v_delta = 0 then raise exception 'Quantity must be non-zero'; end if;
  select * into v_inv from public.inventory where owner_id = auth.uid() and batch_id = p_batch_id;
  if not found then raise exception 'You do not hold this batch'; end if;
  if v_inv.quantity + v_delta < v_inv.reserved then
    raise exception 'Cannot reduce below % units reserved for open orders', v_inv.reserved;
  end if;
  perform public._move_stock(auth.uid(), p_batch_id, v_delta, p_type, null, null, p_note);
  perform public._audit('stock.' || p_type, 'batch', p_batch_id, jsonb_build_object('delta', v_delta));
end $$;

drop function if exists public.place_order(uuid, jsonb, text);
create or replace function public.place_order(
  p_seller uuid, p_items jsonb, p_notes text default '', p_prescription_path text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_buyer_role text := public.current_role_name();
  v_seller_role text;
  v_order uuid;
  v_item jsonb;
  v_med public.medicines;
  v_qty integer;
  v_price numeric;
  v_list numeric;
  v_total numeric := 0;
  v_limit numeric;
  v_disc numeric := 0;
  v_out numeric;
begin
  select role into v_seller_role from public.profiles where id = p_seller and status = 'active';
  if v_seller_role is null or not public._can_buy(v_buyer_role, v_seller_role) then
    raise exception 'A % cannot buy from a %', coalesce(v_buyer_role,'?'), coalesce(v_seller_role,'?');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Order has no items'; end if;
  select credit_limit, discount_pct into v_limit, v_disc from public.trade_relations where seller_id = p_seller and buyer_id = v_uid;
  v_disc := coalesce(v_disc, 0);

  insert into public.orders (buyer_id, seller_id, notes, prescription_path)
  values (v_uid, p_seller, coalesce(p_notes,''), p_prescription_path) returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from public.medicines where id = (v_item->>'medicine_id')::uuid;
    if not found then raise exception 'Unknown medicine'; end if;
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select unit_price into v_list from public.listings where owner_id = p_seller and medicine_id = v_med.id;
    if v_list is null then raise exception 'Seller does not list %', v_med.name; end if;
    if public._available(p_seller, v_med.id) < v_qty then
      raise exception 'Insufficient stock with seller for %', v_med.name;
    end if;
    if v_buyer_role = 'consumer' and v_med.requires_rx and coalesce(p_prescription_path,'') = '' then
      raise exception 'A prescription is required for %', v_med.name;
    end if;
    v_price := round(v_list * (1 - v_disc / 100), 2);
    insert into public.order_items (order_id, medicine_id, quantity, unit_price, gst_rate)
    values (v_order, v_med.id, v_qty, v_price, case when v_buyer_role = 'consumer' then 0 else v_med.gst_rate end);
    v_total := v_total + v_price * v_qty;
  end loop;

  if v_limit is not null then
    select coalesce(sum(greatest(total - credit_total - paid_total, 0)), 0) into v_out
      from public.invoices where seller_id = p_seller and buyer_id = v_uid and status in ('unpaid','partial');
    v_out := v_out + coalesce((select sum(total) from public.orders
                               where seller_id = p_seller and buyer_id = v_uid and status = 'pending' and id <> v_order), 0);
    if v_out + v_total > v_limit then
      raise exception 'Credit limit exceeded (limit %, exposure %)', v_limit, v_out + v_total;
    end if;
  end if;

  update public.orders set total = round(v_total, 2) where id = v_order;
  perform public._event(v_order, 'placed', coalesce(p_notes,''));
  perform public._notify(p_seller, 'New order received', public._display_name(v_uid) || ' placed an order', '/orders/' || v_order, 'order');
  return v_order;
end $$;

create or replace function public.ship_order(
  p_order_id uuid, p_quantities jsonb default null, p_eta date default null, p_tracking text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_role text; it record; a record; v_ship uuid; v_qty integer; v_take integer;
  v_total integer := 0; v_bt record; v_pay numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.seller_id <> auth.uid() then raise exception 'Only the seller can ship'; end if;
  if o.status not in ('accepted','partially_shipped') then raise exception 'Order is not ready to ship'; end if;
  select role into v_role from public.profiles where id = o.buyer_id;

  insert into public.shipments (order_id, eta, tracking_note) values (o.id, p_eta, coalesce(p_tracking,''))
  returning id into v_ship;

  for it in select * from public.order_items where order_id = o.id order by id loop
    v_qty := it.quantity - it.shipped_qty;
    if p_quantities is not null and v_role <> 'consumer' then
      v_qty := least(v_qty, greatest(coalesce((p_quantities ->> (it.id::text))::int, 0), 0));
    end if;
    continue when v_qty <= 0;
    perform public._reserve_item(it.id);   -- tops up legacy / expired reservations
    for a in
      select oa.* from public.order_allocations oa join public.batches bt on bt.id = oa.batch_id
      where oa.order_item_id = it.id and oa.quantity > oa.shipped_qty
      order by bt.expiry_date asc, oa.id for update of oa
    loop
      exit when v_qty <= 0;
      select status, expiry_date, batch_no into v_bt from public.batches where id = a.batch_id;
      if v_bt.status = 'recalled' or v_bt.expiry_date < current_date then
        raise exception 'Reserved batch % is recalled or expired — cancel the order or close it short', v_bt.batch_no;
      end if;
      v_take := least(a.quantity - a.shipped_qty, v_qty);
      update public.inventory set reserved = reserved - v_take where owner_id = o.seller_id and batch_id = a.batch_id;
      perform public._move_stock(o.seller_id, a.batch_id, -v_take, 'transfer_out', o.id, o.buyer_id, o.order_no);
      update public.order_allocations set shipped_qty = shipped_qty + v_take where id = a.id;
      insert into public.shipment_lines (shipment_id, allocation_id, order_item_id, batch_id, quantity)
      values (v_ship, a.id, it.id, a.batch_id, v_take);
      update public.order_items set shipped_qty = shipped_qty + v_take where id = it.id;
      v_qty := v_qty - v_take; v_total := v_total + v_take;
    end loop;
    if v_qty > 0 then raise exception 'Reservation mismatch for an order line'; end if;
  end loop;
  if v_total = 0 then raise exception 'Nothing to ship — enter at least one quantity'; end if;

  if v_role = 'consumer' then
    perform public._receive_shipment(v_ship);
    select greatest(total - credit_total - paid_total, 0) into v_pay from public.invoices where order_id = o.id and status <> 'void';
    if coalesce(v_pay, 0) > 0 then
      insert into public.payments (invoice_id, order_id, seller_id, buyer_id, amount, method, note, recorded_by)
      select id, order_id, seller_id, buyer_id, v_pay, 'cash', 'Paid at handover', auth.uid()
      from public.invoices where order_id = o.id and status <> 'void';
      update public.invoices set paid_total = paid_total + v_pay where order_id = o.id and status <> 'void';
      perform public._refresh_invoice_status((select id from public.invoices where order_id = o.id));
    end if;
  end if;
  perform public._recompute_status(o.id);
  perform public._event(o.id, case when v_role = 'consumer' then 'handed_over' else 'shipped' end,
    coalesce(p_tracking,'') || case when p_eta is not null then ' · ETA ' || p_eta else '' end);
  perform public._notify(o.buyer_id,
    case when v_role = 'consumer' then 'Order ready' else 'Order shipped' end,
    o.order_no || (case when v_role = 'consumer' then ' has been fulfilled' else ' has a new shipment' end),
    '/orders/' || o.id, 'order');
  perform public._audit('order.ship', 'order', o.id, '{}'::jsonb);
  return v_ship;
end $$;

create or replace function public.receive_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare sh public.shipments; o public.orders;
begin
  select * into sh from public.shipments where id = p_shipment_id;
  if not found then raise exception 'Shipment not found'; end if;
  select * into o from public.orders where id = sh.order_id for update;
  if o.buyer_id <> auth.uid() then raise exception 'Only the buyer can receive'; end if;
  if sh.received_at is not null then raise exception 'Shipment already received'; end if;
  perform public._receive_shipment(sh.id);
  perform public._recompute_status(o.id);
  perform public._event(o.id, 'received', 'Shipment received');
  perform public._notify(o.seller_id, 'Shipment received', o.order_no || ' was received', '/orders/' || o.id, 'order');
end $$;

-- accept | reject | cancel | close (short-close remaining) | receive (all pending shipments) | ship (all)
create or replace function public.advance_order(p_order_id uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o public.orders; it record; sh record; v_n integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_uid not in (o.buyer_id, o.seller_id) then raise exception 'Not your order'; end if;

  if p_action = 'accept' then
    if v_uid <> o.seller_id or o.status <> 'pending' then raise exception 'Cannot accept this order'; end if;
    for it in select id from public.order_items where order_id = o.id loop perform public._reserve_item(it.id); end loop;
    update public.orders set status = 'accepted', updated_at = now() where id = o.id;
    perform public._create_invoice(o.id);
    perform public._event(o.id, 'accepted', coalesce(p_note,''));
    perform public._notify(o.buyer_id, 'Order accepted', o.order_no || ' was accepted — stock reserved', '/orders/' || o.id, 'order');

  elsif p_action = 'reject' then
    if v_uid <> o.seller_id or o.status <> 'pending' then raise exception 'Cannot reject this order'; end if;
    update public.orders set status = 'rejected', status_note = coalesce(p_note,''), updated_at = now() where id = o.id;
    perform public._event(o.id, 'rejected', coalesce(p_note,''));
    perform public._notify(o.buyer_id, 'Order rejected', o.order_no || ' was rejected', '/orders/' || o.id, 'order');

  elsif p_action = 'cancel' then
    if o.status not in ('pending','accepted') then raise exception 'Order can no longer be cancelled'; end if;
    for it in select id from public.order_items where order_id = o.id loop perform public._release_item(it.id); end loop;
    update public.invoices set status = 'void' where order_id = o.id;
    update public.orders set status = 'cancelled', status_note = coalesce(p_note,''), updated_at = now() where id = o.id;
    perform public._event(o.id, 'cancelled', coalesce(p_note,''));
    perform public._notify(case when v_uid = o.buyer_id then o.seller_id else o.buyer_id end,
      'Order cancelled', o.order_no || ' was cancelled', '/orders/' || o.id, 'order');

  elsif p_action = 'close' then
    if v_uid <> o.seller_id or o.status <> 'partially_shipped' then raise exception 'Only a partially shipped order can be closed short'; end if;
    for it in select id from public.order_items where order_id = o.id loop perform public._release_item(it.id); end loop;
    delete from public.order_items where order_id = o.id and shipped_qty = 0;
    update public.order_items set quantity = shipped_qty where order_id = o.id and quantity > shipped_qty;
    update public.orders set total = (select coalesce(round(sum(quantity * unit_price), 2), 0) from public.order_items where order_id = o.id),
      status_note = coalesce(p_note,'') where id = o.id;
    perform public._recalc_invoice(o.id);
    perform public._recompute_status(o.id);
    perform public._event(o.id, 'closed_short', coalesce(p_note,'Remaining quantity cancelled'));
    perform public._notify(o.buyer_id, 'Order closed short', o.order_no || ': remaining quantity was cancelled', '/orders/' || o.id, 'order');

  elsif p_action = 'ship' then
    perform public.ship_order(p_order_id);

  elsif p_action = 'receive' then
    if v_uid <> o.buyer_id then raise exception 'Only the buyer can receive'; end if;
    v_n := 0;
    for sh in select id from public.shipments where order_id = o.id and received_at is null loop
      perform public._receive_shipment(sh.id); v_n := v_n + 1;
    end loop;
    if v_n = 0 then raise exception 'Nothing to receive'; end if;
    perform public._recompute_status(o.id);
    perform public._event(o.id, 'received', v_n || ' shipment(s) received');
    perform public._notify(o.seller_id, 'Order received', o.order_no || ' was received', '/orders/' || o.id, 'order');
  else
    raise exception 'Unknown action %', p_action;
  end if;
  perform public._audit('order.' || p_action, 'order', o.id, '{}'::jsonb);
end $$;

create or replace function public.record_payment(
  p_invoice_id uuid, p_amount numeric, p_method text default 'bank', p_reference text default '', p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_out numeric;
begin
  select * into i from public.invoices where id = p_invoice_id for update;
  if not found or i.seller_id <> auth.uid() then raise exception 'Invoice not found'; end if;
  if i.status = 'void' then raise exception 'Invoice is void'; end if;
  v_out := i.total - i.credit_total - i.paid_total;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_amount > v_out + 0.005 then raise exception 'Amount exceeds outstanding balance (%)', v_out; end if;
  insert into public.payments (invoice_id, order_id, seller_id, buyer_id, amount, method, reference, note, recorded_by)
  values (i.id, i.order_id, i.seller_id, i.buyer_id, round(p_amount, 2), p_method, coalesce(p_reference,''), coalesce(p_note,''), auth.uid());
  update public.invoices set paid_total = paid_total + round(p_amount, 2) where id = i.id;
  perform public._refresh_invoice_status(i.id);
  perform public._event(i.order_id, 'payment', 'Payment of ' || round(p_amount, 2) || ' via ' || p_method);
  perform public._notify(i.buyer_id, 'Payment recorded', i.invoice_no || ': ' || round(p_amount, 2) || ' received', '/orders/' || i.order_id, 'payment');
  perform public._audit('payment.record', 'invoice', i.id, jsonb_build_object('amount', p_amount));
end $$;

create or replace function public.request_return(p_order_id uuid, p_items jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_role text; v_id uuid; v_item jsonb; v_batch uuid; v_qty integer;
  v_recv integer; v_ret integer; it public.order_items;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or o.buyer_id <> auth.uid() then raise exception 'Not your order'; end if;
  select role into v_role from public.profiles where id = o.buyer_id;
  if v_role = 'consumer' then raise exception 'Customers should contact the pharmacy directly'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Select items to return'; end if;
  insert into public.returns (order_id, buyer_id, seller_id, reason)
  values (o.id, o.buyer_id, o.seller_id, coalesce(p_reason,'')) returning id into v_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_batch := (v_item->>'batch_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    select coalesce(sum(sl.quantity), 0) into v_recv from public.shipment_lines sl
      join public.shipments sh on sh.id = sl.shipment_id
      where sh.order_id = o.id and sl.batch_id = v_batch and sh.received_at is not null;
    select coalesce(sum(ri.quantity), 0) into v_ret from public.return_items ri
      join public.returns r on r.id = ri.return_id
      where r.order_id = o.id and ri.batch_id = v_batch and r.status <> 'rejected';
    if v_qty is null or v_qty <= 0 or v_qty > v_recv - v_ret then raise exception 'Invalid return quantity for a batch'; end if;
    select oi.* into it from public.order_items oi join public.batches b on b.medicine_id = oi.medicine_id
      where oi.order_id = o.id and b.id = v_batch limit 1;
    insert into public.return_items (return_id, order_item_id, batch_id, quantity, unit_price, gst_rate)
    values (v_id, it.id, v_batch, v_qty, it.unit_price, it.gst_rate);
  end loop;
  perform public._event(o.id, 'return_requested', coalesce(p_reason,''));
  perform public._notify(o.seller_id, 'Return requested', o.order_no || ': ' || coalesce(p_reason,''), '/orders/' || o.id, 'return');
  perform public._audit('return.request', 'return', v_id, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.respond_return(p_return_id uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.returns; l record; v_credit numeric := 0; v_inv uuid; o public.orders; v_free integer;
begin
  select * into r from public.returns where id = p_return_id for update;
  if not found or r.seller_id <> auth.uid() then raise exception 'Return not found'; end if;
  if r.status <> 'requested' then raise exception 'Return already resolved'; end if;
  select * into o from public.orders where id = r.order_id;
  if p_action = 'reject' then
    update public.returns set status = 'rejected', response_note = coalesce(p_note,''), resolved_at = now() where id = r.id;
    perform public._event(r.order_id, 'return_rejected', coalesce(p_note,''));
    perform public._notify(r.buyer_id, 'Return rejected', r.return_no || ' was rejected', '/orders/' || r.order_id, 'return');
  elsif p_action = 'approve' then
    for l in select * from public.return_items where return_id = r.id loop
      select quantity - reserved into v_free from public.inventory where owner_id = r.buyer_id and batch_id = l.batch_id;
      if coalesce(v_free, 0) < l.quantity then
        raise exception 'Buyer no longer holds enough free stock of a returned batch';
      end if;
      perform public._move_stock(r.buyer_id, l.batch_id, -l.quantity, 'return_out', r.order_id, r.seller_id, r.return_no);
      perform public._move_stock(r.seller_id, l.batch_id, l.quantity, 'return_in', r.order_id, r.buyer_id, r.return_no);
      v_credit := v_credit + l.quantity * l.unit_price * (1 + l.gst_rate / 100);
    end loop;
    v_credit := round(v_credit, 2);
    update public.returns set status = 'completed', credit_amount = v_credit, response_note = coalesce(p_note,''), resolved_at = now() where id = r.id;
    select id into v_inv from public.invoices where order_id = r.order_id and status <> 'void';
    if v_inv is not null then
      update public.invoices set credit_total = credit_total + v_credit where id = v_inv;
      perform public._refresh_invoice_status(v_inv);
    end if;
    perform public._event(r.order_id, 'return_approved', 'Credit note ' || v_credit);
    perform public._notify(r.buyer_id, 'Return approved', r.return_no || ': credit of ' || v_credit || ' issued', '/orders/' || r.order_id, 'return');
  else
    raise exception 'Unknown action';
  end if;
  perform public._audit('return.' || p_action, 'return', r.id, '{}'::jsonb);
end $$;

create or replace function public.recall_batch(p_batch_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_b public.batches; h record; v_n integer := 0; v_name text;
begin
  select * into v_b from public.batches where id = p_batch_id and manufacturer_id = auth.uid();
  if not found then raise exception 'Batch not found or not yours'; end if;
  if v_b.status = 'recalled' then raise exception 'Batch already recalled'; end if;
  update public.batches set status = 'recalled', recall_reason = coalesce(p_reason,'') where id = p_batch_id;
  select m.name into v_name from public.medicines m where m.id = v_b.medicine_id;
  for h in select distinct owner_id from public.inventory where batch_id = p_batch_id and quantity > 0 and owner_id <> auth.uid() loop
    perform public._notify(h.owner_id, 'BATCH RECALL: ' || v_name || ' ' || v_b.batch_no,
      coalesce(p_reason,'Stop selling and quarantine this batch.'), '/inventory', 'recall');
    v_n := v_n + 1;
  end loop;
  perform public._audit('batch.recall', 'batch', p_batch_id, jsonb_build_object('reason', p_reason, 'holders', v_n));
  return v_n;
end $$;

create or replace function public.ack_recall(p_batch_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_mfr uuid; v_name text;
begin
  if not exists (select 1 from public.inventory where owner_id = auth.uid() and batch_id = p_batch_id) then
    raise exception 'You do not hold this batch';
  end if;
  insert into public.recall_acks (batch_id, owner_id, status, note) values (p_batch_id, auth.uid(), p_status, coalesce(p_note,''))
  on conflict (batch_id, owner_id) do update set status = excluded.status, note = excluded.note, updated_at = now();
  select manufacturer_id into v_mfr from public.batches where id = p_batch_id;
  v_name := public._display_name(auth.uid());
  perform public._notify(v_mfr, 'Recall update', v_name || ' marked the batch ' || p_status, '/batches', 'recall');
end $$;

create or replace function public.batch_distribution(p_batch_id uuid)
returns table (owner_id uuid, org_name text, role text, quantity integer, ack_status text, ack_note text)
language sql stable security definer set search_path = public as $$
  select i.owner_id, public._display_name(i.owner_id), p.role, i.quantity, a.status, a.note
  from public.inventory i
  join public.batches b on b.id = i.batch_id and b.manufacturer_id = auth.uid()
  join public.profiles p on p.id = i.owner_id
  left join public.recall_acks a on a.batch_id = i.batch_id and a.owner_id = i.owner_id
  where i.batch_id = p_batch_id and i.quantity > 0
  order by i.quantity desc
$$;

-- walk-in bill with several lines; FEFO batch pick per line
create or replace function public.create_bill(
  p_lines jsonb, p_customer_name text default '', p_customer_phone text default '',
  p_discount numeric default 0, p_payment_mode text default 'cash'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_bill uuid; v_no text; v_line jsonb; v_med public.medicines;
  v_qty integer; v_need integer; v_take integer; v_price numeric; v_sub numeric := 0; b record; v_cust uuid;
begin
  if public.current_role_name() <> 'retailer' then raise exception 'Only retailers can create bills'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;
  if p_payment_mode not in ('cash','upi','card','credit') then raise exception 'Invalid payment mode'; end if;
  if coalesce(trim(p_customer_phone),'') <> '' then
    insert into public.retail_customers (retailer_id, name, phone)
    values (v_uid, coalesce(trim(p_customer_name),''), trim(p_customer_phone))
    on conflict (retailer_id, phone) do update set name = case when excluded.name <> '' then excluded.name else public.retail_customers.name end
    returning id into v_cust;
  end if;
  insert into public.sale_bills (retailer_id, customer_id, customer_name, customer_phone, payment_mode)
  values (v_uid, v_cust, coalesce(trim(p_customer_name),''), coalesce(trim(p_customer_phone),''), p_payment_mode)
  returning id, bill_no into v_bill, v_no;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_med from public.medicines where id = (v_line->>'medicine_id')::uuid;
    if not found then raise exception 'Unknown medicine'; end if;
    v_qty := (v_line->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity for %', v_med.name; end if;
    v_price := coalesce(nullif(v_line->>'unit_price','')::numeric,
                        (select unit_price from public.listings where owner_id = v_uid and medicine_id = v_med.id), v_med.mrp);
    if v_price > v_med.mrp then raise exception '% price exceeds MRP (%)', v_med.name, v_med.mrp; end if;
    v_need := v_qty;
    for b in
      select i.batch_id, (i.quantity - i.reserved) as free
      from public.inventory i join public.batches bt on bt.id = i.batch_id
      where i.owner_id = v_uid and bt.medicine_id = v_med.id and bt.status = 'active'
        and bt.expiry_date >= current_date and i.quantity - i.reserved > 0
      order by bt.expiry_date asc, bt.created_at asc
      for update of i
    loop
      exit when v_need <= 0;
      v_take := least(b.free, v_need);
      perform public._move_stock(v_uid, b.batch_id, -v_take, 'sale', null, null, v_no);
      insert into public.sale_bill_lines (bill_id, batch_id, medicine_id, quantity, unit_price, gst_rate)
      values (v_bill, b.batch_id, v_med.id, v_take, v_price, v_med.gst_rate);
      v_sub := v_sub + v_take * v_price;
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then raise exception 'Not enough sellable stock of % (short by %)', v_med.name, v_need; end if;
  end loop;

  if p_discount < 0 or p_discount > v_sub then raise exception 'Invalid discount'; end if;
  update public.sale_bills set subtotal = round(v_sub, 2), discount = round(p_discount, 2), total = round(v_sub - p_discount, 2) where id = v_bill;
  return v_bill;
end $$;

create or replace function public.refund_bill(p_bill_id uuid, p_lines jsonb, p_reason text default '')
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_bill public.sale_bills; v_item jsonb; l public.sale_bill_lines; v_qty integer; v_total numeric := 0; v_amt numeric;
begin
  select * into v_bill from public.sale_bills where id = p_bill_id and retailer_id = auth.uid() for update;
  if not found then raise exception 'Bill not found'; end if;
  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_item->>'quantity')::int;
    select * into l from public.sale_bill_lines where id = (v_item->>'line_id')::uuid and bill_id = v_bill.id for update;
    if not found or v_qty is null or v_qty <= 0 or v_qty > l.quantity - l.returned_qty then raise exception 'Invalid refund quantity'; end if;
    perform public._move_stock(auth.uid(), l.batch_id, v_qty, 'sale_return', null, null, v_bill.bill_no);
    update public.sale_bill_lines set returned_qty = returned_qty + v_qty where id = l.id;
    v_amt := round(v_qty * l.unit_price, 2);
    insert into public.bill_refunds (bill_id, line_id, quantity, amount, reason) values (v_bill.id, l.id, v_qty, v_amt, coalesce(p_reason,''));
    v_total := v_total + v_amt;
  end loop;
  update public.sale_bills set refunded_total = refunded_total + v_total where id = v_bill.id;
  return v_total;
end $$;

create or replace function public.submit_review(p_order_id uuid, p_rating integer, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or o.buyer_id <> auth.uid() then raise exception 'Not your order'; end if;
  if o.status <> 'delivered' then raise exception 'You can review after delivery'; end if;
  insert into public.reviews (order_id, reviewer_id, seller_id, rating, comment)
  values (o.id, o.buyer_id, o.seller_id, p_rating, coalesce(left(p_comment, 500), ''))
  on conflict (order_id) do update set rating = excluded.rating, comment = excluded.comment;
  perform public._notify(o.seller_id, 'New review', o.order_no || ' was rated ' || p_rating || '/5', '/orders/' || o.id, 'general');
end $$;

create or replace function public.verify_batch(p_batch_no text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(rec.j), '[]'::jsonb) from (
    select jsonb_build_object(
      'batch_id', b.id, 'batch_no', b.batch_no, 'medicine', m.name, 'generic_name', m.generic_name,
      'strength', m.strength, 'dosage_form', m.dosage_form, 'mrp', m.mrp,
      'manufacturer', public._display_name(b.manufacturer_id),
      'manufacturer_verified', (select verified from public.profiles where id = b.manufacturer_id),
      'mfg_date', b.mfg_date, 'expiry_date', b.expiry_date, 'expired', b.expiry_date < current_date,
      'status', b.status, 'recall_reason', b.recall_reason,
      'custody', coalesce((
        select jsonb_agg(jsonb_build_object('from', public._display_name(o.seller_id),
                                            'to', public._display_name(o.buyer_id), 'at', s.received_at) order by s.received_at)
        from (select sh.order_id, max(sh.received_at) as received_at
              from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
              where sl.batch_id = b.id and sh.received_at is not null
              group by sh.order_id) s
        join public.orders o on o.id = s.order_id
        where (select role from public.profiles where id = o.buyer_id) <> 'consumer'
      ), '[]'::jsonb)
    ) as j
    from public.batches b join public.medicines m on m.id = b.medicine_id
    where lower(b.batch_no) = lower(trim(p_batch_no))
    limit 20
  ) rec
$$;

-- ---------------------------------------------------------------------
-- 5. DISCOVERY RPCs (locator, catalogs, alternatives, reorder)
-- ---------------------------------------------------------------------
drop function if exists public.list_suppliers();
create or replace function public.list_suppliers(p_lat double precision default null, p_lng double precision default null)
returns table (id uuid, role text, org_name text, full_name text, city text, address text, phone text,
               verified boolean, medicines_in_stock integer, distance_km double precision,
               rating_avg numeric, rating_count integer, is_favorite boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, p.org_name, p.full_name, p.city, p.address, p.phone, p.verified,
    (select count(distinct b.medicine_id)::int from public.inventory i join public.batches b on b.id = i.batch_id
      where i.owner_id = p.id and i.quantity - i.reserved > 0 and b.status = 'active' and b.expiry_date >= current_date),
    public._distance_km(p_lat, p_lng, p.lat, p.lng),
    (select round(avg(r.rating), 1) from public.reviews r where r.seller_id = p.id),
    (select count(*)::int from public.reviews r where r.seller_id = p.id),
    exists (select 1 from public.favorites f where f.user_id = auth.uid() and f.seller_id = p.id)
  from public.profiles p
  where public._can_buy(public.current_role_name(), p.role) and p.id <> auth.uid() and p.status = 'active'
  order by 10 asc nulls last, 11 desc nulls last, p.org_name
$$;

drop function if exists public.get_supplier_catalog(uuid);
create or replace function public.get_supplier_catalog(p_seller uuid)
returns table (medicine_id uuid, name text, generic_name text, category text, dosage_form text,
               strength text, pack_size text, mrp numeric, requires_rx boolean, gst_rate numeric,
               unit_price numeric, available integer, nearest_expiry date)
language sql stable security definer set search_path = public as $$
  select m.id, m.name, m.generic_name, m.category, m.dosage_form, m.strength, m.pack_size, m.mrp,
         m.requires_rx, m.gst_rate,
         round(l.unit_price * (1 - coalesce(tr.discount_pct, 0) / 100), 2),
         sum(i.quantity - i.reserved)::int,
         min(b.expiry_date)
  from public.listings l
  join public.medicines m on m.id = l.medicine_id
  join public.batches b on b.medicine_id = m.id
  join public.inventory i on i.batch_id = b.id and i.owner_id = l.owner_id
  join public.profiles sp on sp.id = l.owner_id
  left join public.trade_relations tr on tr.seller_id = l.owner_id and tr.buyer_id = auth.uid()
  where l.owner_id = p_seller
    and public._can_buy(public.current_role_name(), sp.role)
    and i.quantity - i.reserved > 0 and b.status = 'active' and b.expiry_date >= current_date
  group by m.id, l.unit_price, tr.discount_pct
  order by m.name
$$;

drop function if exists public.search_availability(text);
create or replace function public.search_availability(p_query text, p_lat double precision default null, p_lng double precision default null)
returns table (seller_id uuid, org_name text, city text, address text, phone text, verified boolean,
               medicine_id uuid, medicine text, generic_name text, strength text, dosage_form text,
               requires_rx boolean, mrp numeric, unit_price numeric, available integer,
               distance_km double precision, rating_avg numeric, rating_count integer)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.org_name, sp.city, sp.address, sp.phone, sp.verified,
         m.id, m.name, m.generic_name, m.strength, m.dosage_form, m.requires_rx, m.mrp, l.unit_price,
         sum(i.quantity - i.reserved)::int,
         public._distance_km(p_lat, p_lng, sp.lat, sp.lng),
         (select round(avg(r.rating), 1) from public.reviews r where r.seller_id = sp.id),
         (select count(*)::int from public.reviews r where r.seller_id = sp.id)
  from public.listings l
  join public.profiles sp on sp.id = l.owner_id
  join public.medicines m on m.id = l.medicine_id
  join public.batches b on b.medicine_id = m.id
  join public.inventory i on i.batch_id = b.id and i.owner_id = l.owner_id
  where public._can_buy(public.current_role_name(), sp.role) and sp.status = 'active'
    and i.quantity - i.reserved > 0 and b.status = 'active' and b.expiry_date >= current_date
    and (m.name ilike '%' || p_query || '%' or m.generic_name ilike '%' || p_query || '%')
  group by sp.id, m.id, l.unit_price
  order by 16 asc nulls last, l.unit_price asc
  limit 100
$$;

create or replace function public.alternatives(p_medicine_id uuid)
returns table (medicine_id uuid, name text, strength text, dosage_form text, pack_size text, mrp numeric, sellers integer)
language sql stable security definer set search_path = public as $$
  select m2.id, m2.name, m2.strength, m2.dosage_form, m2.pack_size, m2.mrp, count(distinct l.owner_id)::int
  from public.medicines m1
  join public.medicines m2 on lower(m2.generic_name) = lower(m1.generic_name) and m2.id <> m1.id
  join public.listings l on l.medicine_id = m2.id
  join public.profiles sp on sp.id = l.owner_id
  where m1.id = p_medicine_id and m1.generic_name <> ''
    and public._can_buy(public.current_role_name(), sp.role)
    and public._available(l.owner_id, m2.id) > 0
  group by m2.id
  order by m2.mrp
$$;

create or replace function public.pharmacy_profile(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'org_name', p.org_name, 'city', p.city, 'address', p.address,
    'phone', p.phone, 'verified', p.verified, 'about', p.about, 'lat', p.lat, 'lng', p.lng,
    'rating_avg', (select round(avg(rating), 1) from public.reviews where seller_id = p.id),
    'rating_count', (select count(*) from public.reviews where seller_id = p.id),
    'medicines_in_stock', (select count(distinct b.medicine_id) from public.inventory i
        join public.batches b on b.id = i.batch_id
        where i.owner_id = p.id and i.quantity - i.reserved > 0 and b.status = 'active' and b.expiry_date >= current_date),
    'is_favorite', exists (select 1 from public.favorites where user_id = auth.uid() and seller_id = p.id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', r.rating, 'comment', r.comment,
        'who', split_part(public._display_name(r.reviewer_id), ' ', 1), 'at', r.created_at) order by r.created_at desc)
        from (select * from public.reviews where seller_id = p.id order by created_at desc limit 10) r), '[]'::jsonb)
  )
  from public.profiles p where p.id = p_id and p.role in ('manufacturer','distributor','retailer')
$$;

create or replace function public.reorder_suggestions()
returns table (medicine_id uuid, name text, strength text, pack_size text, available integer, reorder_level integer,
               suggested_qty integer, supplier_id uuid, supplier_name text, unit_price numeric, supplier_available integer)
language sql stable security definer set search_path = public as $$
  select l.medicine_id, m.name, m.strength, m.pack_size, a.avail, l.reorder_level,
         greatest(l.reorder_level * 2 - a.avail, 1), s.sid, s.org, s.price, s.avail2
  from public.listings l
  join public.medicines m on m.id = l.medicine_id
  cross join lateral (select public._available(l.owner_id, l.medicine_id) as avail) a
  left join lateral (
    select sl.owner_id as sid, public._display_name(sl.owner_id) as org,
           round(sl.unit_price * (1 - coalesce(tr.discount_pct, 0) / 100), 2) as price,
           public._available(sl.owner_id, l.medicine_id) as avail2
    from public.listings sl
    join public.profiles sp on sp.id = sl.owner_id and sp.status = 'active'
    left join public.trade_relations tr on tr.seller_id = sl.owner_id and tr.buyer_id = auth.uid()
    where sl.medicine_id = l.medicine_id and public._can_buy(public.current_role_name(), sp.role)
      and public._available(sl.owner_id, l.medicine_id) > 0
    order by 3 asc limit 1
  ) s on true
  where l.owner_id = auth.uid() and a.avail < l.reorder_level
  order by (a.avail::numeric / greatest(l.reorder_level, 1)) asc
$$;

create or replace function public.account_balances()
returns table (counterparty_id uuid, org_name text, role text, receivable numeric, payable numeric, overdue numeric)
language sql stable security definer set search_path = public as $$
  select x.cp, public._display_name(x.cp), (select pr.role from public.profiles pr where pr.id = x.cp),
         sum(x.rec), sum(x.pay), sum(x.od)
  from (
    select buyer_id as cp, greatest(total - credit_total - paid_total, 0) as rec, 0::numeric as pay,
           case when due_date < current_date then greatest(total - credit_total - paid_total, 0) else 0 end as od
    from public.invoices where seller_id = auth.uid() and status in ('unpaid','partial')
    union all
    select seller_id, 0::numeric, greatest(total - credit_total - paid_total, 0),
           case when due_date < current_date then greatest(total - credit_total - paid_total, 0) else 0 end
    from public.invoices where buyer_id = auth.uid() and status in ('unpaid','partial')
  ) x
  group by x.cp
  order by 4 desc
$$;

-- ---------------------------------------------------------------------
-- 6. DASHBOARDS
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_res jsonb;
begin
  select jsonb_build_object(
    'total_units', coalesce((select sum(quantity) from public.inventory where owner_id = v_uid), 0),
    'distinct_medicines', (select count(distinct b.medicine_id) from public.inventory i
                           join public.batches b on b.id = i.batch_id where i.owner_id = v_uid and i.quantity > 0),
    'inventory_value', coalesce((select sum(i.quantity * l.unit_price) from public.inventory i
                           join public.batches b on b.id = i.batch_id
                           join public.listings l on l.owner_id = i.owner_id and l.medicine_id = b.medicine_id
                           where i.owner_id = v_uid), 0),
    'expiring_30d', (select count(*) from public.inventory i join public.batches b on b.id = i.batch_id
                     where i.owner_id = v_uid and i.quantity > 0 and b.expiry_date >= current_date and b.expiry_date < current_date + 30),
    'expired', (select count(*) from public.inventory i join public.batches b on b.id = i.batch_id
                where i.owner_id = v_uid and i.quantity > 0 and b.expiry_date < current_date),
    'recalled', (select count(*) from public.inventory i join public.batches b on b.id = i.batch_id
                 where i.owner_id = v_uid and i.quantity > 0 and b.status = 'recalled'),
    'low_stock', (select count(*) from public.listings l where l.owner_id = v_uid and public._available(v_uid, l.medicine_id) < l.reorder_level),
    'incoming_pending', (select count(*) from public.orders where seller_id = v_uid and status = 'pending'),
    'to_ship', (select count(*) from public.orders where seller_id = v_uid and status in ('accepted','partially_shipped')),
    'outgoing_open', (select count(*) from public.orders where buyer_id = v_uid and status in ('pending','accepted','partially_shipped','shipped')),
    'awaiting_receipt', (select count(*) from public.orders o where o.buyer_id = v_uid
                         and exists (select 1 from public.shipments s where s.order_id = o.id and s.received_at is null)),
    'open_returns', (select count(*) from public.returns where seller_id = v_uid and status = 'requested'),
    'revenue_30d', coalesce((select sum(total) from public.orders where seller_id = v_uid and status = 'delivered' and delivered_at > now() - interval '30 days'), 0)
                 + coalesce((select sum(quantity * unit_price) from public.sales where retailer_id = v_uid and created_at > now() - interval '30 days'), 0)
                 + coalesce((select sum(total - refunded_total) from public.sale_bills where retailer_id = v_uid and created_at > now() - interval '30 days'), 0),
    'spend_30d', coalesce((select sum(total) from public.orders where buyer_id = v_uid and status = 'delivered' and delivered_at > now() - interval '30 days'), 0),
    'produced_30d', coalesce((select sum(quantity) from public.stock_movements where owner_id = v_uid and movement_type = 'production' and created_at > now() - interval '30 days'), 0),
    'activity_14d', coalesce((
        select jsonb_agg(jsonb_build_object('day', d::date,
          'in',  coalesce((select sum(quantity) from public.stock_movements where owner_id = v_uid and quantity > 0 and created_at::date = d::date), 0),
          'out', coalesce((select -sum(quantity) from public.stock_movements where owner_id = v_uid and quantity < 0 and created_at::date = d::date), 0))
          order by d)
        from generate_series(current_date - 13, current_date, interval '1 day') d), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

create or replace function public.dashboard_analytics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return jsonb_build_object(
    'stock_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', s.category, 'units', s.units) order by s.units desc)
        from (select m.category, sum(i.quantity)::int as units from public.inventory i
              join public.batches b on b.id = i.batch_id join public.medicines m on m.id = b.medicine_id
              where i.owner_id = v_uid and i.quantity > 0 group by m.category) s), '[]'::jsonb),
    'top_medicines', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'units', t.units) order by t.units desc)
        from (select m.name, (-sum(sm.quantity))::int as units from public.stock_movements sm
              join public.medicines m on m.id = sm.medicine_id
              where sm.owner_id = v_uid and sm.movement_type in ('sale','transfer_out') and sm.created_at > now() - interval '30 days'
              group by m.name order by 2 desc limit 5) t), '[]'::jsonb),
    'sales_30d', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'revenue',
          coalesce((select sum(total) from public.orders where seller_id = v_uid and status = 'delivered' and delivered_at::date = d::date), 0)
        + coalesce((select sum(total - refunded_total) from public.sale_bills where retailer_id = v_uid and created_at::date = d::date), 0)
        + coalesce((select sum(quantity * unit_price) from public.sales where retailer_id = v_uid and created_at::date = d::date), 0)) order by d)
        from generate_series(current_date - 29, current_date, interval '1 day') d), '[]'::jsonb),
    'expiry_buckets', (select jsonb_build_object(
          'expired', coalesce(sum(i.quantity) filter (where b.expiry_date < current_date), 0),
          'd30', coalesce(sum(i.quantity) filter (where b.expiry_date >= current_date and b.expiry_date < current_date + 30), 0),
          'd90', coalesce(sum(i.quantity) filter (where b.expiry_date >= current_date + 30 and b.expiry_date < current_date + 90), 0),
          'd180', coalesce(sum(i.quantity) filter (where b.expiry_date >= current_date + 90 and b.expiry_date < current_date + 180), 0),
          'later', coalesce(sum(i.quantity) filter (where b.expiry_date >= current_date + 180), 0))
        from public.inventory i join public.batches b on b.id = i.batch_id where i.owner_id = v_uid and i.quantity > 0),
    'orders_in', coalesce((select jsonb_object_agg(s.status, s.c) from (select status, count(*) as c from public.orders where seller_id = v_uid group by status) s), '{}'::jsonb),
    'orders_out', coalesce((select jsonb_object_agg(s.status, s.c) from (select status, count(*) as c from public.orders where buyer_id = v_uid group by status) s), '{}'::jsonb),
    'receivable', coalesce((select sum(greatest(total - credit_total - paid_total, 0)) from public.invoices where seller_id = v_uid and status in ('unpaid','partial')), 0),
    'payable', coalesce((select sum(greatest(total - credit_total - paid_total, 0)) from public.invoices where buyer_id = v_uid and status in ('unpaid','partial')), 0),
    'overdue_receivable', coalesce((select sum(greatest(total - credit_total - paid_total, 0)) from public.invoices where seller_id = v_uid and status in ('unpaid','partial') and due_date < current_date), 0),
    'overdue_payable', coalesce((select sum(greatest(total - credit_total - paid_total, 0)) from public.invoices where buyer_id = v_uid and status in ('unpaid','partial') and due_date < current_date), 0),
    'shipped_30d', coalesce((select -sum(quantity) from public.stock_movements where owner_id = v_uid and movement_type = 'transfer_out' and created_at > now() - interval '30 days'), 0),
    'top_buyers', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'total', t.total) order by t.total desc)
        from (select public._display_name(o.buyer_id) as name, sum(o.total) as total from public.orders o
              where o.seller_id = v_uid and o.status not in ('rejected','cancelled','pending') and o.created_at > now() - interval '90 days'
              group by o.buyer_id order by 2 desc limit 5) t), '[]'::jsonb),
    'top_suppliers', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'total', t.total) order by t.total desc)
        from (select public._display_name(o.seller_id) as name, sum(o.total) as total from public.orders o
              where o.buyer_id = v_uid and o.status not in ('rejected','cancelled','pending') and o.created_at > now() - interval '90 days'
              group by o.seller_id order by 2 desc limit 5) t), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 7. ADMIN
-- ---------------------------------------------------------------------
create or replace function public.set_verified(p_user uuid, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Admins only'; end if;
  update public.profiles set verified = p_value where id = p_user;
  perform public._notify(p_user, case when p_value then 'Account verified' else 'Verification removed' end, '', '/profile', 'account');
  perform public._audit('user.verify', 'profile', p_user, jsonb_build_object('verified', p_value));
end $$;

create or replace function public.set_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Admins only'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid status'; end if;
  if p_user = auth.uid() then raise exception 'You cannot suspend yourself'; end if;
  update public.profiles set status = p_status where id = p_user and role <> 'admin';
  perform public._audit('user.' || p_status, 'profile', p_user, '{}'::jsonb);
end $$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'manufacturers', (select count(*) from public.profiles where role = 'manufacturer'),
    'distributors',  (select count(*) from public.profiles where role = 'distributor'),
    'retailers',     (select count(*) from public.profiles where role = 'retailer'),
    'consumers',     (select count(*) from public.profiles where role = 'consumer'),
    'unverified',    (select count(*) from public.profiles where role in ('manufacturer','distributor','retailer') and not verified),
    'suspended',     (select count(*) from public.profiles where status = 'suspended'),
    'orders',        (select count(*) from public.orders),
    'open_orders',   (select count(*) from public.orders where status in ('pending','accepted','partially_shipped','shipped')),
    'batches',       (select count(*) from public.batches),
    'recalled',      (select count(*) from public.batches where status = 'recalled'),
    'units_in_system', coalesce((select sum(quantity) from public.inventory), 0),
    'gmv_30d',       coalesce((select sum(total) from public.orders where status not in ('rejected','cancelled') and created_at > now() - interval '30 days'), 0),
    'outstanding',   coalesce((select sum(greatest(total - credit_total - paid_total, 0)) from public.invoices where status in ('unpaid','partial')), 0),
    'orders_14d',    coalesce((select jsonb_agg(jsonb_build_object('day', d::date,
                        'orders', (select count(*) from public.orders where created_at::date = d::date),
                        'value', coalesce((select sum(total) from public.orders where created_at::date = d::date and status not in ('rejected','cancelled')), 0)) order by d)
                      from generate_series(current_date - 13, current_date, interval '1 day') d), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY (new tables)
-- ---------------------------------------------------------------------
alter table public.shipments        enable row level security;
alter table public.shipment_lines   enable row level security;
alter table public.invoices         enable row level security;
alter table public.payments         enable row level security;
alter table public.returns          enable row level security;
alter table public.return_items     enable row level security;
alter table public.order_events     enable row level security;
alter table public.order_messages   enable row level security;
alter table public.retail_customers enable row level security;
alter table public.sale_bills       enable row level security;
alter table public.sale_bill_lines  enable row level security;
alter table public.bill_refunds     enable row level security;
alter table public.trade_relations  enable row level security;
alter table public.reviews          enable row level security;
alter table public.favorites        enable row level security;
alter table public.recall_acks      enable row level security;
alter table public.audit_log        enable row level security;

create or replace function public._is_order_party(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = p_order
    and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.current_role_name() = 'admin'))
$$;

drop policy if exists shipments_read on public.shipments;
create policy shipments_read on public.shipments for select to authenticated using (public._is_order_party(order_id));
drop policy if exists shipment_lines_read on public.shipment_lines;
create policy shipment_lines_read on public.shipment_lines for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id and public._is_order_party(s.order_id)));
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.current_role_name() = 'admin');
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.current_role_name() = 'admin');
drop policy if exists returns_read on public.returns;
create policy returns_read on public.returns for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.current_role_name() = 'admin');
drop policy if exists return_items_read on public.return_items;
create policy return_items_read on public.return_items for select to authenticated
  using (exists (select 1 from public.returns r where r.id = return_id
         and (r.seller_id = auth.uid() or r.buyer_id = auth.uid() or public.current_role_name() = 'admin')));
drop policy if exists order_events_read on public.order_events;
create policy order_events_read on public.order_events for select to authenticated using (public._is_order_party(order_id));
drop policy if exists order_messages_read on public.order_messages;
create policy order_messages_read on public.order_messages for select to authenticated using (public._is_order_party(order_id));
drop policy if exists order_messages_insert on public.order_messages;
create policy order_messages_insert on public.order_messages for insert to authenticated
  with check (sender_id = auth.uid() and public._is_order_party(order_id));

drop policy if exists retail_customers_read on public.retail_customers;
create policy retail_customers_read on public.retail_customers for select to authenticated using (retailer_id = auth.uid());
drop policy if exists sale_bills_read on public.sale_bills;
create policy sale_bills_read on public.sale_bills for select to authenticated using (retailer_id = auth.uid());
drop policy if exists sale_bill_lines_read on public.sale_bill_lines;
create policy sale_bill_lines_read on public.sale_bill_lines for select to authenticated
  using (exists (select 1 from public.sale_bills b where b.id = bill_id and b.retailer_id = auth.uid()));
drop policy if exists bill_refunds_read on public.bill_refunds;
create policy bill_refunds_read on public.bill_refunds for select to authenticated
  using (exists (select 1 from public.sale_bills b where b.id = bill_id and b.retailer_id = auth.uid()));

drop policy if exists trade_relations_read on public.trade_relations;
create policy trade_relations_read on public.trade_relations for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid());
drop policy if exists trade_relations_write on public.trade_relations;
create policy trade_relations_write on public.trade_relations for insert to authenticated
  with check (seller_id = auth.uid()
    and public._can_buy((select role from public.profiles where id = buyer_id), public.current_role_name()));
drop policy if exists trade_relations_update on public.trade_relations;
create policy trade_relations_update on public.trade_relations for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists trade_relations_delete on public.trade_relations;
create policy trade_relations_delete on public.trade_relations for delete to authenticated using (seller_id = auth.uid());

drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated
  using (reviewer_id = auth.uid() or seller_id = auth.uid() or public.current_role_name() = 'admin');
drop policy if exists favorites_all_read on public.favorites;
create policy favorites_all_read on public.favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists favorites_ins on public.favorites;
create policy favorites_ins on public.favorites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists favorites_del on public.favorites;
create policy favorites_del on public.favorites for delete to authenticated using (user_id = auth.uid());

drop policy if exists recall_acks_read on public.recall_acks;
create policy recall_acks_read on public.recall_acks for select to authenticated
  using (owner_id = auth.uid() or public.current_role_name() = 'admin'
         or exists (select 1 from public.batches b where b.id = batch_id and b.manufacturer_id = auth.uid()));
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using (public.current_role_name() = 'admin');

-- ---------------------------------------------------------------------
-- 9. BACKFILL v1 DATA
-- ---------------------------------------------------------------------
do $$
declare o record; v_ship uuid;
begin
  -- GST snapshot for business orders created under v1
  update public.order_items oi set gst_rate = m.gst_rate
  from public.medicines m, public.orders od, public.profiles bp
  where m.id = oi.medicine_id and od.id = oi.order_id and bp.id = od.buyer_id
    and bp.role <> 'consumer' and oi.gst_rate = 0 and m.gst_rate <> 0;

  -- turn v1 shipped/delivered orders into shipment records
  for o in
    select * from public.orders od
    where od.shipped_at is not null and od.status in ('shipped','delivered')
      and not exists (select 1 from public.shipments s where s.order_id = od.id)
  loop
    insert into public.shipments (order_id, shipped_at, received_at)
    values (o.id, o.shipped_at, case when o.status = 'delivered' then coalesce(o.delivered_at, o.shipped_at) end)
    returning id into v_ship;
    insert into public.shipment_lines (shipment_id, allocation_id, order_item_id, batch_id, quantity)
    select v_ship, a.id, a.order_item_id, a.batch_id, a.quantity from public.order_allocations a where a.order_id = o.id and a.shipped_qty = 0;
    update public.order_allocations set shipped_qty = quantity where order_id = o.id and shipped_qty = 0;
    update public.order_items oi set shipped_qty = coalesce((select sum(quantity) from public.order_allocations where order_item_id = oi.id), 0)
      where oi.order_id = o.id;
  end loop;

  -- invoices for v1 orders past 'pending'
  for o in
    select * from public.orders od where od.status in ('accepted','shipped','delivered')
      and not exists (select 1 from public.invoices i where i.order_id = od.id)
  loop
    perform public._create_invoice(o.id);
    if (select role from public.profiles where id = o.buyer_id) = 'consumer' and o.status = 'delivered' then
      update public.invoices set paid_total = total, status = 'paid' where order_id = o.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. STORAGE: private prescription bucket
-- ---------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public) values ('prescriptions', 'prescriptions', false) on conflict (id) do nothing;
  execute 'drop policy if exists "rx_insert_own" on storage.objects';
  execute 'create policy "rx_insert_own" on storage.objects for insert to authenticated
           with check (bucket_id = ''prescriptions'' and (storage.foldername(name))[1] = auth.uid()::text)';
  execute 'drop policy if exists "rx_read" on storage.objects';
  execute 'create policy "rx_read" on storage.objects for select to authenticated
           using (bucket_id = ''prescriptions'' and (
             (storage.foldername(name))[1] = auth.uid()::text
             or exists (select 1 from public.orders o where o.prescription_path = name and o.seller_id = auth.uid())))';
exception when others then
  raise notice 'Storage setup skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 11. GRANTS (re-applied in full: lock down, then open exactly what is needed)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on
  public.profiles, public.medicines, public.batches, public.inventory, public.listings, public.orders,
  public.order_items, public.order_allocations, public.stock_movements, public.sales, public.notifications,
  public.shipments, public.shipment_lines, public.invoices, public.payments, public.returns, public.return_items,
  public.order_events, public.order_messages, public.retail_customers, public.sale_bills, public.sale_bill_lines,
  public.bill_refunds, public.trade_relations, public.reviews, public.favorites, public.recall_acks, public.audit_log
to authenticated;
grant select on public.medicines to anon;

grant update (full_name, org_name, phone, address, city, license_no, lat, lng, about, gstin) on public.profiles to authenticated;
grant insert (manufacturer_id, name, generic_name, category, dosage_form, strength, pack_size, mrp, requires_rx, gst_rate, barcode)
  on public.medicines to authenticated;
grant update (name, generic_name, category, dosage_form, strength, pack_size, mrp, requires_rx, active, gst_rate, barcode)
  on public.medicines to authenticated;
grant update (unit_price, reorder_level) on public.listings to authenticated;
grant update (read) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert (order_id, sender_id, body) on public.order_messages to authenticated;
grant insert (user_id, seller_id) on public.favorites to authenticated;
grant delete on public.favorites to authenticated;
grant insert (seller_id, buyer_id, credit_limit, discount_pct) on public.trade_relations to authenticated;
grant update (credit_limit, discount_pct) on public.trade_relations to authenticated;
grant delete on public.trade_relations to authenticated;
grant usage on all sequences in schema public to authenticated;

grant execute on function public.current_role_name(), public._can_buy(text, text), public._is_order_party(uuid) to anon, authenticated;

grant execute on function
  public.create_batch(uuid, text, date, date, integer),
  public.adjust_stock(uuid, integer, text, text),
  public.record_sale(uuid, integer, numeric, text),
  public.place_order(uuid, jsonb, text, text),
  public.advance_order(uuid, text, text),
  public.ship_order(uuid, jsonb, date, text),
  public.receive_shipment(uuid),
  public.record_payment(uuid, numeric, text, text, text),
  public.request_return(uuid, jsonb, text),
  public.respond_return(uuid, text, text),
  public.recall_batch(uuid, text),
  public.ack_recall(uuid, text, text),
  public.batch_distribution(uuid),
  public.create_bill(jsonb, text, text, numeric, text),
  public.refund_bill(uuid, jsonb, text),
  public.submit_review(uuid, integer, text),
  public.list_suppliers(double precision, double precision),
  public.get_supplier_catalog(uuid),
  public.search_availability(text, double precision, double precision),
  public.alternatives(uuid),
  public.pharmacy_profile(uuid),
  public.reorder_suggestions(),
  public.account_balances(),
  public.dashboard_stats(),
  public.dashboard_analytics(),
  public.set_verified(uuid, boolean),
  public.set_status(uuid, text),
  public.admin_overview()
to authenticated;

grant execute on function public.verify_batch(text) to anon, authenticated;
grant execute on function public.pharmacy_profile(uuid) to anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.order_messages; exception when duplicate_object then null; end;
  end if;
end $$;
