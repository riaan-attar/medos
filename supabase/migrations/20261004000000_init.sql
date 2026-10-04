-- =====================================================================
-- MedOS — medicine supply chain & inventory coordination
-- Single-file migration. Paste into the Supabase SQL Editor, or use
-- `supabase db push`. Safe to read top to bottom:
--   1. tables  2. helpers/triggers  3. RPC functions  4. RLS  5. grants
-- Roles: manufacturer -> distributor -> retailer -> consumer (+ admin)
-- All stock mutations go through SECURITY DEFINER functions so clients
-- can never edit inventory or order state directly.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'consumer'
              check (role in ('manufacturer','distributor','retailer','consumer','admin')),
  full_name   text not null default '',
  org_name    text not null default '',
  phone       text not null default '',
  address     text not null default '',
  city        text not null default '',
  license_no  text not null default '',
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.medicines (
  id                 uuid primary key default gen_random_uuid(),
  manufacturer_id    uuid not null references public.profiles(id),
  name               text not null,
  generic_name       text not null default '',
  category           text not null default 'General',
  dosage_form        text not null default 'Tablet',
  strength           text not null default '',
  pack_size          text not null default '',
  mrp                numeric(12,2) not null check (mrp >= 0),
  requires_rx        boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (manufacturer_id, name, strength, pack_size)
);

create table public.batches (
  id               uuid primary key default gen_random_uuid(),
  medicine_id      uuid not null references public.medicines(id),
  manufacturer_id  uuid not null references public.profiles(id),
  batch_no         text not null,
  mfg_date         date not null,
  expiry_date      date not null,
  quantity         integer not null check (quantity > 0),
  status           text not null default 'active' check (status in ('active','recalled')),
  recall_reason    text,
  created_at       timestamptz not null default now(),
  unique (medicine_id, batch_no),
  check (expiry_date > mfg_date)
);
create index on public.batches (batch_no);
create index on public.batches (manufacturer_id);

-- what each owner currently holds, per batch
create table public.inventory (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id),
  batch_id   uuid not null references public.batches(id),
  quantity   integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (owner_id, batch_id)
);
create index on public.inventory (owner_id);

-- what each owner sells a medicine for, plus their reorder threshold
create table public.listings (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id),
  medicine_id   uuid not null references public.medicines(id),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  reorder_level integer not null default 50 check (reorder_level >= 0),
  unique (owner_id, medicine_id)
);

create sequence public.order_seq start 1000;

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     text not null unique default ('ORD-' || nextval('public.order_seq')),
  buyer_id     uuid not null references public.profiles(id),
  seller_id    uuid not null references public.profiles(id),
  status       text not null default 'pending'
               check (status in ('pending','accepted','rejected','shipped','delivered','cancelled')),
  notes        text not null default '',
  status_note  text not null default '',
  total        numeric(14,2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  shipped_at   timestamptz,
  delivered_at timestamptz,
  check (buyer_id <> seller_id)
);
create index on public.orders (buyer_id);
create index on public.orders (seller_id);

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id),
  quantity    integer not null check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0)
);
create index on public.order_items (order_id);

-- which batches physically fulfilled an order item (FEFO), set at shipping
create table public.order_allocations (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete cascade,
  batch_id      uuid not null references public.batches(id),
  quantity      integer not null check (quantity > 0)
);
create index on public.order_allocations (order_id);
create index on public.order_allocations (batch_id);

-- immutable stock ledger (audit trail)
create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id),
  batch_id        uuid not null references public.batches(id),
  medicine_id     uuid not null references public.medicines(id),
  movement_type   text not null check (movement_type in
                  ('production','transfer_in','transfer_out','sale','adjustment',
                   'damage','expired_writeoff','recall_writeoff')),
  quantity        integer not null,             -- signed delta for owner
  order_id        uuid references public.orders(id),
  counterparty_id uuid references public.profiles(id),
  note            text not null default '',
  created_at      timestamptz not null default now()
);
create index on public.stock_movements (owner_id, created_at desc);

-- walk-in sales recorded by retailers
create table public.sales (
  id            uuid primary key default gen_random_uuid(),
  retailer_id   uuid not null references public.profiles(id),
  batch_id      uuid not null references public.batches(id),
  medicine_id   uuid not null references public.medicines(id),
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  customer_name text not null default '',
  created_at    timestamptz not null default now()
);
create index on public.sales (retailer_id, created_at desc);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. HELPERS & TRIGGERS
-- ---------------------------------------------------------------------

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public._notify(p_user uuid, p_title text, p_body text, p_link text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, link) values (p_user, p_title, p_body, p_link)
$$;

create or replace function public._display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(org_name,''), nullif(full_name,''), 'Unknown') from public.profiles where id = p_user
$$;

-- new auth user -> profile. 'admin' can never be self-assigned via metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(new.raw_user_meta_data->>'role', 'consumer');
begin
  if r not in ('manufacturer','distributor','retailer','consumer') then r := 'consumer'; end if;
  insert into public.profiles (id, role, full_name, org_name, phone, address, city, license_no)
  values (new.id, r,
          coalesce(new.raw_user_meta_data->>'full_name',''),
          coalesce(new.raw_user_meta_data->>'org_name',''),
          coalesce(new.raw_user_meta_data->>'phone',''),
          coalesce(new.raw_user_meta_data->>'address',''),
          coalesce(new.raw_user_meta_data->>'city',''),
          coalesce(new.raw_user_meta_data->>'license_no',''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- sellers may never list above MRP
create or replace function public.enforce_price_cap()
returns trigger language plpgsql as $$
declare v_mrp numeric;
begin
  select mrp into v_mrp from public.medicines where id = new.medicine_id;
  if new.unit_price > v_mrp then
    raise exception 'Price % exceeds MRP %', new.unit_price, v_mrp;
  end if;
  return new;
end $$;

create trigger listings_price_cap
  before insert or update of unit_price on public.listings
  for each row execute function public.enforce_price_cap();

-- manufacturers lowering MRP below existing listings is blocked
create or replace function public.enforce_mrp_floor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mrp < old.mrp and exists
     (select 1 from public.listings where medicine_id = new.id and unit_price > new.mrp) then
    raise exception 'MRP cannot be lowered below an existing listing price';
  end if;
  return new;
end $$;

create trigger medicines_mrp_floor
  before update of mrp on public.medicines
  for each row execute function public.enforce_mrp_floor();

-- internal: apply a signed stock delta + ledger row
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
  -- the check constraint (quantity >= 0) rejects overdrafts
  insert into public.stock_movements
    (owner_id, batch_id, medicine_id, movement_type, quantity, order_id, counterparty_id, note)
  values (p_owner, p_batch, v_med, p_type, p_delta, p_order, p_counterparty, p_note);
end $$;

-- internal: ensure a listing exists for owner/medicine
create or replace function public._ensure_listing(p_owner uuid, p_medicine uuid, p_price numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_mrp numeric;
begin
  select mrp into v_mrp from public.medicines where id = p_medicine;
  insert into public.listings (owner_id, medicine_id, unit_price)
  values (p_owner, p_medicine, least(round(p_price, 2), v_mrp))
  on conflict (owner_id, medicine_id) do nothing;
end $$;

-- who may buy from whom
create or replace function public._can_buy(p_buyer_role text, p_seller_role text)
returns boolean language sql immutable as $$
  select (p_buyer_role, p_seller_role) in
    (('distributor','manufacturer'),
     ('retailer','manufacturer'),
     ('retailer','distributor'),
     ('consumer','retailer'))
$$;

-- sellable units of a medicine for an owner (non-expired, non-recalled)
create or replace function public._available(p_owner uuid, p_medicine uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.quantity), 0)::int
  from public.inventory i join public.batches b on b.id = i.batch_id
  where i.owner_id = p_owner and b.medicine_id = p_medicine
    and b.status = 'active' and b.expiry_date >= current_date
$$;

-- ---------------------------------------------------------------------
-- 3. RPC FUNCTIONS
-- ---------------------------------------------------------------------

-- Manufacturer registers a produced batch
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
  return v_batch;
end $$;

-- Owner corrects / writes off stock. Non-'adjustment' types always reduce stock.
create or replace function public.adjust_stock(
  p_batch_id uuid, p_delta integer, p_type text, p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare v_delta integer;
begin
  if auth.uid() is null or public.current_role_name() not in ('manufacturer','distributor','retailer') then
    raise exception 'Not allowed';
  end if;
  if p_type not in ('adjustment','damage','expired_writeoff','recall_writeoff') then
    raise exception 'Invalid adjustment type';
  end if;
  v_delta := case when p_type = 'adjustment' then p_delta else -abs(p_delta) end;
  if v_delta = 0 then raise exception 'Quantity must be non-zero'; end if;
  if not exists (select 1 from public.inventory where owner_id = auth.uid() and batch_id = p_batch_id) then
    raise exception 'You do not hold this batch';
  end if;
  perform public._move_stock(auth.uid(), p_batch_id, v_delta, p_type, null, null, p_note);
end $$;

-- Retailer walk-in sale
create or replace function public.record_sale(
  p_batch_id uuid, p_quantity integer, p_unit_price numeric, p_customer text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_b public.batches;
  v_mrp numeric;
  v_sale uuid;
begin
  if public.current_role_name() <> 'retailer' then raise exception 'Only retailers can record sales'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into v_b from public.batches where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  if v_b.status = 'recalled' then raise exception 'Batch is recalled and cannot be sold'; end if;
  if v_b.expiry_date < current_date then raise exception 'Batch is expired and cannot be sold'; end if;
  select mrp into v_mrp from public.medicines where id = v_b.medicine_id;
  if p_unit_price > v_mrp then raise exception 'Price exceeds MRP (%)', v_mrp; end if;

  perform public._move_stock(v_uid, p_batch_id, -p_quantity, 'sale', null, null, coalesce(p_customer,''));
  insert into public.sales (retailer_id, batch_id, medicine_id, quantity, unit_price, customer_name)
  values (v_uid, p_batch_id, v_b.medicine_id, p_quantity, p_unit_price, coalesce(p_customer,''))
  returning id into v_sale;
  return v_sale;
end $$;

-- Place an order. p_items = [{"medicine_id": "...", "quantity": 10}, ...]
create or replace function public.place_order(p_seller uuid, p_items jsonb, p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_buyer_role text := public.current_role_name();
  v_seller_role text;
  v_order uuid;
  v_item jsonb;
  v_med uuid;
  v_qty integer;
  v_price numeric;
  v_total numeric := 0;
begin
  select role into v_seller_role from public.profiles where id = p_seller;
  if v_seller_role is null or not public._can_buy(v_buyer_role, v_seller_role) then
    raise exception 'A % cannot buy from a %', coalesce(v_buyer_role,'?'), coalesce(v_seller_role,'?');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order has no items';
  end if;

  insert into public.orders (buyer_id, seller_id, notes) values (v_uid, p_seller, coalesce(p_notes,''))
  returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_med := (v_item->>'medicine_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select unit_price into v_price from public.listings where owner_id = p_seller and medicine_id = v_med;
    if v_price is null then raise exception 'Seller does not list one of the medicines'; end if;
    if public._available(p_seller, v_med) < v_qty then
      raise exception 'Insufficient stock with seller for requested quantity';
    end if;
    insert into public.order_items (order_id, medicine_id, quantity, unit_price)
    values (v_order, v_med, v_qty, v_price);
    v_total := v_total + v_price * v_qty;
  end loop;

  update public.orders set total = v_total where id = v_order;
  perform public._notify(p_seller, 'New order received',
    public._display_name(v_uid) || ' placed an order', '/orders/' || v_order);
  return v_order;
end $$;

-- Order state machine. p_action: accept | reject | cancel | ship | receive
create or replace function public.advance_order(p_order_id uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o public.orders;
  v_buyer_role text;
  it record;
  b record;
  v_need integer;
  v_take integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_uid not in (o.buyer_id, o.seller_id) then raise exception 'Not your order'; end if;
  select role into v_buyer_role from public.profiles where id = o.buyer_id;

  if p_action = 'accept' then
    if v_uid <> o.seller_id or o.status <> 'pending' then raise exception 'Cannot accept this order'; end if;
    update public.orders set status = 'accepted', updated_at = now() where id = o.id;
    perform public._notify(o.buyer_id, 'Order accepted', o.order_no || ' was accepted', '/orders/' || o.id);

  elsif p_action = 'reject' then
    if v_uid <> o.seller_id or o.status <> 'pending' then raise exception 'Cannot reject this order'; end if;
    update public.orders set status = 'rejected', status_note = coalesce(p_note,''), updated_at = now() where id = o.id;
    perform public._notify(o.buyer_id, 'Order rejected', o.order_no || ' was rejected', '/orders/' || o.id);

  elsif p_action = 'cancel' then
    if o.status not in ('pending','accepted') then raise exception 'Order can no longer be cancelled'; end if;
    update public.orders set status = 'cancelled', status_note = coalesce(p_note,''), updated_at = now() where id = o.id;
    perform public._notify(case when v_uid = o.buyer_id then o.seller_id else o.buyer_id end,
      'Order cancelled', o.order_no || ' was cancelled', '/orders/' || o.id);

  elsif p_action = 'ship' then
    if v_uid <> o.seller_id or o.status <> 'accepted' then raise exception 'Cannot ship this order'; end if;
    -- allocate FEFO from the seller's stock, locking rows
    for it in select * from public.order_items where order_id = o.id loop
      v_need := it.quantity;
      for b in
        select i.id as inv_id, i.batch_id, i.quantity
        from public.inventory i join public.batches bt on bt.id = i.batch_id
        where i.owner_id = o.seller_id and bt.medicine_id = it.medicine_id
          and bt.status = 'active' and bt.expiry_date >= current_date and i.quantity > 0
        order by bt.expiry_date asc, bt.created_at asc
        for update of i
      loop
        exit when v_need <= 0;
        v_take := least(b.quantity, v_need);
        perform public._move_stock(o.seller_id, b.batch_id, -v_take, 'transfer_out', o.id, o.buyer_id, o.order_no);
        insert into public.order_allocations (order_item_id, order_id, batch_id, quantity)
        values (it.id, o.id, b.batch_id, v_take);
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then
        raise exception 'Insufficient valid stock to ship % (short by %)', o.order_no, v_need;
      end if;
    end loop;

    if v_buyer_role = 'consumer' then
      -- handover to the customer completes the order
      update public.orders set status = 'delivered', shipped_at = now(), delivered_at = now(), updated_at = now() where id = o.id;
      perform public._notify(o.buyer_id, 'Order ready', o.order_no || ' has been fulfilled', '/orders/' || o.id);
    else
      update public.orders set status = 'shipped', shipped_at = now(), updated_at = now() where id = o.id;
      perform public._notify(o.buyer_id, 'Order shipped', o.order_no || ' is on its way', '/orders/' || o.id);
    end if;

  elsif p_action = 'receive' then
    if v_uid <> o.buyer_id or o.status <> 'shipped' then raise exception 'Cannot receive this order'; end if;
    for b in
      select a.batch_id, a.quantity, oi.medicine_id, oi.unit_price
      from public.order_allocations a join public.order_items oi on oi.id = a.order_item_id
      where a.order_id = o.id
    loop
      perform public._move_stock(o.buyer_id, b.batch_id, b.quantity, 'transfer_in', o.id, o.seller_id, o.order_no);
      -- default resale price: distributors +10%, retailers at MRP (always capped at MRP)
      perform public._ensure_listing(o.buyer_id, b.medicine_id,
        case when v_buyer_role = 'retailer'
             then (select mrp from public.medicines where id = b.medicine_id)
             else b.unit_price * 1.10 end);
    end loop;
    update public.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = o.id;
    perform public._notify(o.seller_id, 'Order delivered', o.order_no || ' was received', '/orders/' || o.id);

  else
    raise exception 'Unknown action %', p_action;
  end if;
end $$;

-- Manufacturer recalls a batch; every current holder is notified.
create or replace function public.recall_batch(p_batch_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_b public.batches;
  h record;
  v_n integer := 0;
  v_name text;
begin
  select * into v_b from public.batches where id = p_batch_id and manufacturer_id = auth.uid();
  if not found then raise exception 'Batch not found or not yours'; end if;
  if v_b.status = 'recalled' then raise exception 'Batch already recalled'; end if;
  update public.batches set status = 'recalled', recall_reason = coalesce(p_reason,'') where id = p_batch_id;
  select m.name into v_name from public.medicines m where m.id = v_b.medicine_id;
  for h in select distinct owner_id from public.inventory where batch_id = p_batch_id and quantity > 0 and owner_id <> auth.uid() loop
    perform public._notify(h.owner_id, 'BATCH RECALL: ' || v_name || ' ' || v_b.batch_no,
      coalesce(p_reason,'Stop selling and quarantine this batch.'), '/inventory');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Public authenticity check + chain of custody (no quantities exposed)
create or replace function public.verify_batch(p_batch_no text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(rec.j), '[]'::jsonb) from (
    select jsonb_build_object(
      'batch_id', b.id,
      'batch_no', b.batch_no,
      'medicine', m.name,
      'generic_name', m.generic_name,
      'strength', m.strength,
      'dosage_form', m.dosage_form,
      'mrp', m.mrp,
      'manufacturer', public._display_name(b.manufacturer_id),
      'manufacturer_verified', (select verified from public.profiles where id = b.manufacturer_id),
      'mfg_date', b.mfg_date,
      'expiry_date', b.expiry_date,
      'expired', b.expiry_date < current_date,
      'status', b.status,
      'recall_reason', b.recall_reason,
      'custody', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'from', public._display_name(o.seller_id),
                 'to', public._display_name(o.buyer_id),
                 'at', o.delivered_at) order by o.delivered_at)
        from (select distinct o2.id from public.order_allocations a
              join public.orders o2 on o2.id = a.order_id
              where a.batch_id = b.id and o2.status = 'delivered') d
        join public.orders o on o.id = d.id
        where (select role from public.profiles where id = o.buyer_id) <> 'consumer'
      ), '[]'::jsonb)
    ) as j
    from public.batches b join public.medicines m on m.id = b.medicine_id
    where lower(b.batch_no) = lower(trim(p_batch_no))
    limit 20
  ) rec
$$;

-- Suppliers the caller is allowed to buy from, with how much they stock
create or replace function public.list_suppliers()
returns table (id uuid, role text, org_name text, full_name text, city text, address text,
               phone text, verified boolean, medicines_in_stock integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, p.org_name, p.full_name, p.city, p.address, p.phone, p.verified,
    (select count(distinct b.medicine_id)::int
       from public.inventory i join public.batches b on b.id = i.batch_id
       where i.owner_id = p.id and i.quantity > 0 and b.status = 'active' and b.expiry_date >= current_date)
  from public.profiles p
  where public._can_buy(public.current_role_name(), p.role) and p.id <> auth.uid()
  order by p.org_name
$$;

-- A supplier's sellable catalog (one row per medicine, quantity aggregated)
create or replace function public.get_supplier_catalog(p_seller uuid)
returns table (medicine_id uuid, name text, generic_name text, category text, dosage_form text,
               strength text, pack_size text, mrp numeric, requires_rx boolean,
               unit_price numeric, available integer, nearest_expiry date)
language sql stable security definer set search_path = public as $$
  select m.id, m.name, m.generic_name, m.category, m.dosage_form, m.strength, m.pack_size, m.mrp,
         m.requires_rx, l.unit_price,
         sum(i.quantity)::int,
         min(b.expiry_date)
  from public.listings l
  join public.medicines m on m.id = l.medicine_id
  join public.batches b on b.medicine_id = m.id
  join public.inventory i on i.batch_id = b.id and i.owner_id = l.owner_id
  join public.profiles sp on sp.id = l.owner_id
  where l.owner_id = p_seller
    and public._can_buy(public.current_role_name(), sp.role)
    and i.quantity > 0 and b.status = 'active' and b.expiry_date >= current_date
  group by m.id, l.unit_price
  order by m.name
$$;

-- Consumers (and anyone buying) search which sellers stock a medicine
create or replace function public.search_availability(p_query text)
returns table (seller_id uuid, org_name text, city text, address text, phone text, verified boolean,
               medicine_id uuid, medicine text, strength text, dosage_form text,
               unit_price numeric, available integer)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.org_name, sp.city, sp.address, sp.phone, sp.verified,
         m.id, m.name, m.strength, m.dosage_form, l.unit_price, sum(i.quantity)::int
  from public.listings l
  join public.profiles sp on sp.id = l.owner_id
  join public.medicines m on m.id = l.medicine_id
  join public.batches b on b.medicine_id = m.id
  join public.inventory i on i.batch_id = b.id and i.owner_id = l.owner_id
  where public._can_buy(public.current_role_name(), sp.role)
    and i.quantity > 0 and b.status = 'active' and b.expiry_date >= current_date
    and (m.name ilike '%' || p_query || '%' or m.generic_name ilike '%' || p_query || '%')
  group by sp.id, m.id, l.unit_price
  order by m.name, l.unit_price
  limit 100
$$;

-- Role-aware dashboard numbers
create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
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
                     where i.owner_id = v_uid and i.quantity > 0 and b.expiry_date >= current_date
                       and b.expiry_date < current_date + 30),
    'expired', (select count(*) from public.inventory i join public.batches b on b.id = i.batch_id
                where i.owner_id = v_uid and i.quantity > 0 and b.expiry_date < current_date),
    'recalled', (select count(*) from public.inventory i join public.batches b on b.id = i.batch_id
                 where i.owner_id = v_uid and i.quantity > 0 and b.status = 'recalled'),
    'low_stock', (select count(*) from public.listings l
                  where l.owner_id = v_uid and public._available(v_uid, l.medicine_id) < l.reorder_level),
    'incoming_pending', (select count(*) from public.orders where seller_id = v_uid and status = 'pending'),
    'to_ship', (select count(*) from public.orders where seller_id = v_uid and status = 'accepted'),
    'outgoing_open', (select count(*) from public.orders where buyer_id = v_uid and status in ('pending','accepted','shipped')),
    'awaiting_receipt', (select count(*) from public.orders where buyer_id = v_uid and status = 'shipped'),
    'revenue_30d', coalesce((select sum(total) from public.orders
                             where seller_id = v_uid and status = 'delivered' and delivered_at > now() - interval '30 days'), 0)
                 + coalesce((select sum(quantity * unit_price) from public.sales
                             where retailer_id = v_uid and created_at > now() - interval '30 days'), 0),
    'spend_30d', coalesce((select sum(total) from public.orders
                           where buyer_id = v_uid and status = 'delivered' and delivered_at > now() - interval '30 days'), 0),
    'produced_30d', coalesce((select sum(quantity) from public.stock_movements
                              where owner_id = v_uid and movement_type = 'production' and created_at > now() - interval '30 days'), 0),
    'activity_14d', coalesce((
        select jsonb_agg(jsonb_build_object('day', d::date,
          'in',  coalesce((select sum(quantity) from public.stock_movements where owner_id = v_uid and quantity > 0 and created_at::date = d::date), 0),
          'out', coalesce((select -sum(quantity) from public.stock_movements where owner_id = v_uid and quantity < 0 and created_at::date = d::date), 0))
          order by d)
        from generate_series(current_date - 13, current_date, interval '1 day') d), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- Admin
create or replace function public.set_verified(p_user uuid, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Admins only'; end if;
  update public.profiles set verified = p_value where id = p_user;
  perform public._notify(p_user, case when p_value then 'Account verified' else 'Verification removed' end, '', '/profile');
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
    'orders',        (select count(*) from public.orders),
    'open_orders',   (select count(*) from public.orders where status in ('pending','accepted','shipped')),
    'batches',       (select count(*) from public.batches),
    'recalled',      (select count(*) from public.batches where status = 'recalled'),
    'units_in_system', coalesce((select sum(quantity) from public.inventory), 0)
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.medicines         enable row level security;
alter table public.batches           enable row level security;
alter table public.inventory         enable row level security;
alter table public.listings          enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.order_allocations enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.sales             enable row level security;
alter table public.notifications     enable row level security;

-- profiles: self, admins, all business accounts, and order counterparties
create policy profiles_self on public.profiles for select using (id = auth.uid());
create policy profiles_admin on public.profiles for select using (public.current_role_name() = 'admin');
create policy profiles_business on public.profiles for select to authenticated
  using (role in ('manufacturer','distributor','retailer'));
create policy profiles_counterparty on public.profiles for select to authenticated
  using (exists (select 1 from public.orders o
                 where (o.buyer_id = auth.uid() and o.seller_id = profiles.id)
                    or (o.seller_id = auth.uid() and o.buyer_id = profiles.id)));
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- medicines: public catalog; manufacturers manage their own
create policy medicines_read on public.medicines for select using (true);
create policy medicines_insert on public.medicines for insert to authenticated
  with check (manufacturer_id = auth.uid() and public.current_role_name() = 'manufacturer');
create policy medicines_update on public.medicines for update to authenticated
  using (manufacturer_id = auth.uid()) with check (manufacturer_id = auth.uid());

-- batches: visible to manufacturer, current holders, and order participants
create policy batches_read on public.batches for select to authenticated using (
  manufacturer_id = auth.uid()
  or exists (select 1 from public.inventory i where i.batch_id = batches.id and i.owner_id = auth.uid())
  or exists (select 1 from public.order_allocations a join public.orders o on o.id = a.order_id
             where a.batch_id = batches.id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid()))
  or public.current_role_name() = 'admin');

create policy inventory_read on public.inventory for select to authenticated
  using (owner_id = auth.uid() or public.current_role_name() = 'admin');

create policy listings_read_own on public.listings for select to authenticated using (owner_id = auth.uid());
create policy listings_update_own on public.listings for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy orders_read on public.orders for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.current_role_name() = 'admin');

create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.current_role_name() = 'admin')));
create policy order_alloc_read on public.order_allocations for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.current_role_name() = 'admin')));

create policy movements_read on public.stock_movements for select to authenticated using (owner_id = auth.uid());
create policy sales_read on public.sales for select to authenticated using (retailer_id = auth.uid());

create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. GRANTS (lock down direct writes; everything else is via RPC)
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.profiles, public.medicines, public.batches, public.inventory, public.listings,
  public.orders, public.order_items, public.order_allocations, public.stock_movements, public.sales,
  public.notifications to authenticated;
grant select on public.medicines to anon;

grant update (full_name, org_name, phone, address, city, license_no) on public.profiles to authenticated;
grant insert (manufacturer_id, name, generic_name, category, dosage_form, strength, pack_size, mrp, requires_rx)
  on public.medicines to authenticated;
grant update (name, generic_name, category, dosage_form, strength, pack_size, mrp, requires_rx, active)
  on public.medicines to authenticated;
grant update (unit_price, reorder_level) on public.listings to authenticated;
grant update (read) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant usage on sequence public.order_seq to authenticated;

-- RLS helper used inside policies must be callable by the roles evaluating them
grant execute on function public.current_role_name() to anon, authenticated;

grant execute on function
  public.create_batch(uuid, text, date, date, integer),
  public.adjust_stock(uuid, integer, text, text),
  public.record_sale(uuid, integer, numeric, text),
  public.place_order(uuid, jsonb, text),
  public.advance_order(uuid, text, text),
  public.recall_batch(uuid, text),
  public.list_suppliers(),
  public.get_supplier_catalog(uuid),
  public.search_availability(text),
  public.dashboard_stats(),
  public.set_verified(uuid, boolean),
  public.admin_overview()
to authenticated;

-- public authenticity check works without login
grant execute on function public.verify_batch(text) to anon, authenticated;

-- realtime for live notification/order updates (no-op if publication absent)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.orders;
  end if;
end $$;
