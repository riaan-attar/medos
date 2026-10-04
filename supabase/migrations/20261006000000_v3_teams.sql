-- =====================================================================
-- MedOS v3 · Phase 1 — Teams, staff & permissions  (run AFTER v2)
--   * A business can invite staff (manager, pharmacist, cashier, warehouse, accountant)
--   * Staff act AS the business (acting_org()); every action is permission-checked
--   * Every RPC / policy that used auth.uid() as "the owner" now uses acting_org()
--     (the generated sections below). Actor logging (audit, order events) still uses auth.uid().
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists org_id uuid references public.profiles(id) on delete cascade;
create index if not exists profiles_org_idx on public.profiles (org_id);

create table if not exists public.role_permissions (
  member_role text not null,
  permission  text not null,
  primary key (member_role, permission)
);

create table if not exists public.org_members (
  org_id      uuid not null references public.profiles(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  member_role text not null check (member_role in ('manager','pharmacist','cashier','warehouse','accountant')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (user_id)
);

create table if not exists public.org_invites (
  code        text primary key,
  org_id      uuid not null references public.profiles(id) on delete cascade,
  member_role text not null check (member_role in ('manager','pharmacist','cashier','warehouse','accountant')),
  email       text not null default '',
  created_by  uuid references public.profiles(id),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references public.profiles(id),
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists org_invites_org_idx on public.org_invites (org_id);

-- permission catalogue (owners implicitly have every permission)
delete from public.role_permissions;
insert into public.role_permissions (member_role, permission)
select 'manager', p from unnest(array['catalog','batches','recall','stock_adjust','receive','ship','orders_manage','sell','refund','payments','partners','pricing','returns','reports','customers','settings']) p
union all select 'pharmacist', p from unnest(array['sell','refund','stock_adjust','receive','returns','customers']) p
union all select 'cashier', p from unnest(array['sell','customers']) p
union all select 'warehouse', p from unnest(array['batches','stock_adjust','receive','ship','orders_manage','returns']) p
union all select 'accountant', p from unnest(array['payments','partners','reports']) p;

-- ---------------------------------------------------------------------
-- 2. CORE HELPERS
-- ---------------------------------------------------------------------
-- The business the caller acts for: their own account, or the org they belong to as active staff.
create or replace function public.acting_org()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.org_id from public.org_members m where m.user_id = auth.uid() and m.active),
    auth.uid())
$$;

-- Role of the acting business; null when the business OR the person is suspended.
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select o.role from public.profiles o, public.profiles u
  where o.id = public.acting_org() and o.status = 'active'
    and u.id = auth.uid() and u.status = 'active'
$$;

create or replace function public._can(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when auth.uid() = public.acting_org() then true
    else exists (select 1 from public.org_members m
                 join public.role_permissions rp on rp.member_role = m.member_role
                 where m.user_id = auth.uid() and m.active and rp.permission = p_permission)
  end
$$;

create or replace function public._require(p_permission text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can(p_permission) then
    raise exception 'Not permitted: your role cannot do this (requires "%")', p_permission;
  end if;
end $$;

-- Sign-up: staff join an existing business with an invite code; everyone else creates a normal account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(new.raw_user_meta_data->>'role', 'consumer');
  v_code text := nullif(upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', ''))), '');
  inv public.org_invites;
  org public.profiles;
begin
  if v_code is not null then
    select * into inv from public.org_invites where code = v_code and used_by is null and expires_at > now();
    if not found then raise exception 'Invalid or expired invite code'; end if;
    select * into org from public.profiles where id = inv.org_id;
    insert into public.profiles (id, role, full_name, org_name, phone, city, address, org_id)
    values (new.id, org.role, coalesce(new.raw_user_meta_data->>'full_name',''), org.org_name,
            coalesce(new.raw_user_meta_data->>'phone',''), org.city, org.address, org.id);
    insert into public.org_members (org_id, user_id, member_role) values (org.id, new.id, inv.member_role);
    update public.org_invites set used_by = new.id, used_at = now() where code = inv.code;
    return new;
  end if;
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

-- ---------------------------------------------------------------------
-- 2b. TEAM RPCs
-- ---------------------------------------------------------------------
create or replace function public.check_invite(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('org_name', o.org_name, 'role', o.role, 'member_role', i.member_role)
  from public.org_invites i join public.profiles o on o.id = i.org_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now()
$$;

create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'org_id', public.acting_org(),
    'member_role', coalesce((select m.member_role from public.org_members m where m.user_id = auth.uid() and m.active), 'owner'),
    'is_staff', exists (select 1 from public.org_members m where m.user_id = auth.uid() and m.active),
    'permissions', case
      when auth.uid() = public.acting_org()
        then (select coalesce(jsonb_agg(x.p), '[]'::jsonb) from (select permission as p from public.role_permissions union select 'team') x)
      else coalesce((select jsonb_agg(rp.permission) from public.org_members m
                     join public.role_permissions rp on rp.member_role = m.member_role
                     where m.user_id = auth.uid() and m.active), '[]'::jsonb) end)
$$;

create or replace function public.create_invite(p_role text, p_email text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  perform public._require('team');
  if public.current_role_name() not in ('manufacturer','distributor','retailer') then raise exception 'Only businesses can invite staff'; end if;
  if p_role not in ('manager','pharmacist','cashier','warehouse','accountant') then raise exception 'Invalid staff role'; end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 8));
  insert into public.org_invites (code, org_id, member_role, email, created_by)
  values (v_code, public.acting_org(), p_role, coalesce(p_email,''), auth.uid());
  perform public._audit('team.invite', 'org', public.acting_org(), jsonb_build_object('role', p_role));
  return v_code;
end $$;

create or replace function public.revoke_invite(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require('team');
  delete from public.org_invites where code = upper(trim(p_code)) and org_id = public.acting_org() and used_by is null;
end $$;

create or replace function public.set_member(p_user uuid, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require('team');
  if p_user = auth.uid() then raise exception 'You cannot change your own access'; end if;
  if p_role not in ('manager','pharmacist','cashier','warehouse','accountant') then raise exception 'Invalid staff role'; end if;
  update public.org_members set member_role = p_role, active = p_active where org_id = public.acting_org() and user_id = p_user;
  if not found then raise exception 'Team member not found'; end if;
  update public.profiles set status = case when p_active then 'active' else 'suspended' end where id = p_user and org_id = public.acting_org();
  perform public._audit('team.member', 'profile', p_user, jsonb_build_object('role', p_role, 'active', p_active));
end $$;

create or replace function public.list_team()
returns table (user_id uuid, full_name text, email text, member_role text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('team');
  return query
    select m.user_id, p.full_name, u.email::text, m.member_role, m.active, m.created_at
    from public.org_members m
    join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.org_id = public.acting_org()
    order by m.created_at;
end $$;

-- staff profiles are readable by their own org; hidden from the public business directory
drop policy if exists profiles_business on public.profiles;
create policy profiles_business on public.profiles for select to authenticated
  using (role in ('manufacturer','distributor','retailer') and org_id is null);
drop policy if exists profiles_org on public.profiles;
create policy profiles_org on public.profiles for select to authenticated
  using (id = public.acting_org() or org_id = public.acting_org());
drop policy if exists profiles_update_org on public.profiles;
create policy profiles_update_org on public.profiles for update to authenticated
  using (id = public.acting_org() and public._can('settings'))
  with check (id = public.acting_org() and public._can('settings'));

-- direct-write tables now check the acting business AND the staff permission
drop policy if exists medicines_insert on public.medicines;
create policy medicines_insert on public.medicines for insert to authenticated
  with check (manufacturer_id = public.acting_org() and public.current_role_name() = 'manufacturer' and public._can('catalog'));
drop policy if exists medicines_update on public.medicines;
create policy medicines_update on public.medicines for update to authenticated
  using (manufacturer_id = public.acting_org() and public._can('catalog'))
  with check (manufacturer_id = public.acting_org() and public._can('catalog'));
drop policy if exists listings_update_own on public.listings;
create policy listings_update_own on public.listings for update to authenticated
  using (owner_id = public.acting_org() and public._can('pricing'))
  with check (owner_id = public.acting_org() and public._can('pricing'));
drop policy if exists trade_relations_write on public.trade_relations;
create policy trade_relations_write on public.trade_relations for insert to authenticated
  with check (seller_id = public.acting_org() and public._can('partners')
    and public._can_buy((select role from public.profiles where id = buyer_id), public.current_role_name()));
drop policy if exists trade_relations_update on public.trade_relations;
create policy trade_relations_update on public.trade_relations for update to authenticated
  using (seller_id = public.acting_org() and public._can('partners'))
  with check (seller_id = public.acting_org() and public._can('partners'));
drop policy if exists trade_relations_delete on public.trade_relations;
create policy trade_relations_delete on public.trade_relations for delete to authenticated
  using (seller_id = public.acting_org() and public._can('partners'));

alter table public.role_permissions enable row level security;
alter table public.org_members      enable row level security;
alter table public.org_invites      enable row level security;
drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members for select to authenticated
  using (org_id = public.acting_org() or user_id = auth.uid());
drop policy if exists org_invites_read on public.org_invites;
create policy org_invites_read on public.org_invites for select to authenticated
  using (org_id = public.acting_org() and public._can('team'));

-- ---------------------------------------------------------------------
-- 3. EXISTING RPCs, re-emitted: owner = acting_org(), permission check added
--    (generated from the v1/v2 definitions; actor logging still uses auth.uid())
-- ---------------------------------------------------------------------
create or replace function public.create_batch(
  p_medicine_id uuid, p_batch_no text, p_mfg_date date, p_expiry_date date, p_quantity integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.acting_org();
  v_med public.medicines;
  v_batch uuid;
begin
  perform public._require('batches');
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
  perform public._require('stock_adjust');
  if public.acting_org() is null or public.current_role_name() not in ('manufacturer','distributor','retailer') then
    raise exception 'Not allowed';
  end if;
  if p_type not in ('adjustment','damage','expired_writeoff','recall_writeoff') then
    raise exception 'Invalid adjustment type';
  end if;
  v_delta := case when p_type = 'adjustment' then p_delta else -abs(p_delta) end;
  if v_delta = 0 then raise exception 'Quantity must be non-zero'; end if;
  select * into v_inv from public.inventory where owner_id = public.acting_org() and batch_id = p_batch_id;
  if not found then raise exception 'You do not hold this batch'; end if;
  if v_inv.quantity + v_delta < v_inv.reserved then
    raise exception 'Cannot reduce below % units reserved for open orders', v_inv.reserved;
  end if;
  perform public._move_stock(public.acting_org(), p_batch_id, v_delta, p_type, null, null, p_note);
  perform public._audit('stock.' || p_type, 'batch', p_batch_id, jsonb_build_object('delta', v_delta));
end $$;

create or replace function public.record_sale(
  p_batch_id uuid, p_quantity integer, p_unit_price numeric, p_customer text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.acting_org();
  v_b public.batches;
  v_mrp numeric;
  v_sale uuid;
begin
  perform public._require('sell');
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

create or replace function public.place_order(
  p_seller uuid, p_items jsonb, p_notes text default '', p_prescription_path text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.acting_org();
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
  perform public._require('orders_manage');
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

create or replace function public.advance_order(p_order_id uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.acting_org();
  o public.orders; it record; sh record; v_n integer;
begin
  perform public._require(case p_action when 'ship' then 'ship' when 'receive' then 'receive' else 'orders_manage' end);
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

create or replace function public.recall_batch(p_batch_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_b public.batches; h record; v_n integer := 0; v_name text;
begin
  perform public._require('recall');
  select * into v_b from public.batches where id = p_batch_id and manufacturer_id = public.acting_org();
  if not found then raise exception 'Batch not found or not yours'; end if;
  if v_b.status = 'recalled' then raise exception 'Batch already recalled'; end if;
  update public.batches set status = 'recalled', recall_reason = coalesce(p_reason,'') where id = p_batch_id;
  select m.name into v_name from public.medicines m where m.id = v_b.medicine_id;
  for h in select distinct owner_id from public.inventory where batch_id = p_batch_id and quantity > 0 and owner_id <> public.acting_org() loop
    perform public._notify(h.owner_id, 'BATCH RECALL: ' || v_name || ' ' || v_b.batch_no,
      coalesce(p_reason,'Stop selling and quarantine this batch.'), '/inventory', 'recall');
    v_n := v_n + 1;
  end loop;
  perform public._audit('batch.recall', 'batch', p_batch_id, jsonb_build_object('reason', p_reason, 'holders', v_n));
  return v_n;
end $$;

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
    exists (select 1 from public.favorites f where f.user_id = public.acting_org() and f.seller_id = p.id)
  from public.profiles p
  where public._can_buy(public.current_role_name(), p.role) and p.id <> public.acting_org() and p.status = 'active' and p.org_id is null
  order by 10 asc nulls last, 11 desc nulls last, p.org_name
$$;

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
  left join public.trade_relations tr on tr.seller_id = l.owner_id and tr.buyer_id = public.acting_org()
  where l.owner_id = p_seller
    and public._can_buy(public.current_role_name(), sp.role)
    and i.quantity - i.reserved > 0 and b.status = 'active' and b.expiry_date >= current_date
  group by m.id, l.unit_price, tr.discount_pct
  order by m.name
$$;

create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.acting_org(); v_res jsonb;
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

create or replace function public.ship_order(
  p_order_id uuid, p_quantities jsonb default null, p_eta date default null, p_tracking text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_role text; it record; a record; v_ship uuid; v_qty integer; v_take integer;
  v_total integer := 0; v_bt record; v_pay numeric;
begin
  perform public._require('ship');
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.seller_id <> public.acting_org() then raise exception 'Only the seller can ship'; end if;
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
      select id, order_id, seller_id, buyer_id, v_pay, 'cash', 'Paid at handover', public.acting_org()
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
  perform public._require('receive');
  select * into sh from public.shipments where id = p_shipment_id;
  if not found then raise exception 'Shipment not found'; end if;
  select * into o from public.orders where id = sh.order_id for update;
  if o.buyer_id <> public.acting_org() then raise exception 'Only the buyer can receive'; end if;
  if sh.received_at is not null then raise exception 'Shipment already received'; end if;
  perform public._receive_shipment(sh.id);
  perform public._recompute_status(o.id);
  perform public._event(o.id, 'received', 'Shipment received');
  perform public._notify(o.seller_id, 'Shipment received', o.order_no || ' was received', '/orders/' || o.id, 'order');
end $$;

create or replace function public.record_payment(
  p_invoice_id uuid, p_amount numeric, p_method text default 'bank', p_reference text default '', p_note text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_out numeric;
begin
  perform public._require('payments');
  select * into i from public.invoices where id = p_invoice_id for update;
  if not found or i.seller_id <> public.acting_org() then raise exception 'Invoice not found'; end if;
  if i.status = 'void' then raise exception 'Invoice is void'; end if;
  v_out := i.total - i.credit_total - i.paid_total;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_amount > v_out + 0.005 then raise exception 'Amount exceeds outstanding balance (%)', v_out; end if;
  insert into public.payments (invoice_id, order_id, seller_id, buyer_id, amount, method, reference, note, recorded_by)
  values (i.id, i.order_id, i.seller_id, i.buyer_id, round(p_amount, 2), p_method, coalesce(p_reference,''), coalesce(p_note,''), public.acting_org());
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
  perform public._require('returns');
  select * into o from public.orders where id = p_order_id;
  if not found or o.buyer_id <> public.acting_org() then raise exception 'Not your order'; end if;
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
  perform public._require('returns');
  select * into r from public.returns where id = p_return_id for update;
  if not found or r.seller_id <> public.acting_org() then raise exception 'Return not found'; end if;
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

create or replace function public.ack_recall(p_batch_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_mfr uuid; v_name text;
begin
  perform public._require('stock_adjust');
  if not exists (select 1 from public.inventory where owner_id = public.acting_org() and batch_id = p_batch_id) then
    raise exception 'You do not hold this batch';
  end if;
  insert into public.recall_acks (batch_id, owner_id, status, note) values (p_batch_id, public.acting_org(), p_status, coalesce(p_note,''))
  on conflict (batch_id, owner_id) do update set status = excluded.status, note = excluded.note, updated_at = now();
  select manufacturer_id into v_mfr from public.batches where id = p_batch_id;
  v_name := public._display_name(public.acting_org());
  perform public._notify(v_mfr, 'Recall update', v_name || ' marked the batch ' || p_status, '/batches', 'recall');
end $$;

create or replace function public.batch_distribution(p_batch_id uuid)
returns table (owner_id uuid, org_name text, role text, quantity integer, ack_status text, ack_note text)
language sql stable security definer set search_path = public as $$
  select i.owner_id, public._display_name(i.owner_id), p.role, i.quantity, a.status, a.note
  from public.inventory i
  join public.batches b on b.id = i.batch_id and b.manufacturer_id = public.acting_org()
  join public.profiles p on p.id = i.owner_id
  left join public.recall_acks a on a.batch_id = i.batch_id and a.owner_id = i.owner_id
  where i.batch_id = p_batch_id and i.quantity > 0
  order by i.quantity desc
$$;

create or replace function public.create_bill(
  p_lines jsonb, p_customer_name text default '', p_customer_phone text default '',
  p_discount numeric default 0, p_payment_mode text default 'cash'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.acting_org(); v_bill uuid; v_no text; v_line jsonb; v_med public.medicines;
  v_qty integer; v_need integer; v_take integer; v_price numeric; v_sub numeric := 0; b record; v_cust uuid;
begin
  perform public._require('sell');
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
  perform public._require('refund');
  select * into v_bill from public.sale_bills where id = p_bill_id and retailer_id = public.acting_org() for update;
  if not found then raise exception 'Bill not found'; end if;
  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_item->>'quantity')::int;
    select * into l from public.sale_bill_lines where id = (v_item->>'line_id')::uuid and bill_id = v_bill.id for update;
    if not found or v_qty is null or v_qty <= 0 or v_qty > l.quantity - l.returned_qty then raise exception 'Invalid refund quantity'; end if;
    perform public._move_stock(public.acting_org(), l.batch_id, v_qty, 'sale_return', null, null, v_bill.bill_no);
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
  if not found or o.buyer_id <> public.acting_org() then raise exception 'Not your order'; end if;
  if o.status <> 'delivered' then raise exception 'You can review after delivery'; end if;
  insert into public.reviews (order_id, reviewer_id, seller_id, rating, comment)
  values (o.id, o.buyer_id, o.seller_id, p_rating, coalesce(left(p_comment, 500), ''))
  on conflict (order_id) do update set rating = excluded.rating, comment = excluded.comment;
  perform public._notify(o.seller_id, 'New review', o.order_no || ' was rated ' || p_rating || '/5', '/orders/' || o.id, 'general');
end $$;

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
    'is_favorite', exists (select 1 from public.favorites where user_id = public.acting_org() and seller_id = p.id),
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
    left join public.trade_relations tr on tr.seller_id = sl.owner_id and tr.buyer_id = public.acting_org()
    where sl.medicine_id = l.medicine_id and public._can_buy(public.current_role_name(), sp.role)
      and public._available(sl.owner_id, l.medicine_id) > 0
    order by 3 asc limit 1
  ) s on true
  where l.owner_id = public.acting_org() and a.avail < l.reorder_level
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
    from public.invoices where seller_id = public.acting_org() and status in ('unpaid','partial')
    union all
    select seller_id, 0::numeric, greatest(total - credit_total - paid_total, 0),
           case when due_date < current_date then greatest(total - credit_total - paid_total, 0) else 0 end
    from public.invoices where buyer_id = public.acting_org() and status in ('unpaid','partial')
  ) x
  group by x.cp
  order by 4 desc
$$;

create or replace function public.dashboard_analytics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.acting_org();
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

create or replace function public.set_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Admins only'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid status'; end if;
  if p_user = public.acting_org() then raise exception 'You cannot suspend yourself'; end if;
  update public.profiles set status = p_status where id = p_user and role <> 'admin';
  perform public._audit('user.' || p_status, 'profile', p_user, '{}'::jsonb);
end $$;

create or replace function public._is_order_party(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = p_order
    and (o.buyer_id = public.acting_org() or o.seller_id = public.acting_org() or public.current_role_name() = 'admin'))
$$;

-- ---------------------------------------------------------------------
-- 4. RLS: owner checks use acting_org()
-- ---------------------------------------------------------------------
drop policy if exists profiles_counterparty on public.profiles;
create policy profiles_counterparty on public.profiles for select to authenticated
  using (exists (select 1 from public.orders o
                 where (o.buyer_id = public.acting_org() and o.seller_id = profiles.id)
                    or (o.seller_id = public.acting_org() and o.buyer_id = profiles.id)));
drop policy if exists batches_read on public.batches;
create policy batches_read on public.batches for select to authenticated using (
  manufacturer_id = public.acting_org()
  or exists (select 1 from public.inventory i where i.batch_id = batches.id and i.owner_id = public.acting_org())
  or exists (select 1 from public.order_allocations a join public.orders o on o.id = a.order_id
             where a.batch_id = batches.id and (o.buyer_id = public.acting_org() or o.seller_id = public.acting_org()))
  or public.current_role_name() = 'admin');
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated
  using (owner_id = public.acting_org() or public.current_role_name() = 'admin');
drop policy if exists listings_read_own on public.listings;
create policy listings_read_own on public.listings for select to authenticated using (owner_id = public.acting_org());
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (buyer_id = public.acting_org() or seller_id = public.acting_org() or public.current_role_name() = 'admin');
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.buyer_id = public.acting_org() or o.seller_id = public.acting_org() or public.current_role_name() = 'admin')));
drop policy if exists order_alloc_read on public.order_allocations;
create policy order_alloc_read on public.order_allocations for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.buyer_id = public.acting_org() or o.seller_id = public.acting_org() or public.current_role_name() = 'admin')));
drop policy if exists movements_read on public.stock_movements;
create policy movements_read on public.stock_movements for select to authenticated using (owner_id = public.acting_org());
drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated using (retailer_id = public.acting_org());
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using (user_id = public.acting_org());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated
  using (user_id = public.acting_org()) with check (user_id = public.acting_org());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (user_id = public.acting_org());
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (seller_id = public.acting_org() or buyer_id = public.acting_org() or public.current_role_name() = 'admin');
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (seller_id = public.acting_org() or buyer_id = public.acting_org() or public.current_role_name() = 'admin');
drop policy if exists returns_read on public.returns;
create policy returns_read on public.returns for select to authenticated
  using (seller_id = public.acting_org() or buyer_id = public.acting_org() or public.current_role_name() = 'admin');
drop policy if exists return_items_read on public.return_items;
create policy return_items_read on public.return_items for select to authenticated
  using (exists (select 1 from public.returns r where r.id = return_id
         and (r.seller_id = public.acting_org() or r.buyer_id = public.acting_org() or public.current_role_name() = 'admin')));
drop policy if exists retail_customers_read on public.retail_customers;
create policy retail_customers_read on public.retail_customers for select to authenticated using (retailer_id = public.acting_org());
drop policy if exists sale_bills_read on public.sale_bills;
create policy sale_bills_read on public.sale_bills for select to authenticated using (retailer_id = public.acting_org());
drop policy if exists sale_bill_lines_read on public.sale_bill_lines;
create policy sale_bill_lines_read on public.sale_bill_lines for select to authenticated
  using (exists (select 1 from public.sale_bills b where b.id = bill_id and b.retailer_id = public.acting_org()));
drop policy if exists bill_refunds_read on public.bill_refunds;
create policy bill_refunds_read on public.bill_refunds for select to authenticated
  using (exists (select 1 from public.sale_bills b where b.id = bill_id and b.retailer_id = public.acting_org()));
drop policy if exists trade_relations_read on public.trade_relations;
create policy trade_relations_read on public.trade_relations for select to authenticated
  using (seller_id = public.acting_org() or buyer_id = public.acting_org());
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated
  using (reviewer_id = public.acting_org() or seller_id = public.acting_org() or public.current_role_name() = 'admin');
drop policy if exists recall_acks_read on public.recall_acks;
create policy recall_acks_read on public.recall_acks for select to authenticated
  using (owner_id = public.acting_org() or public.current_role_name() = 'admin'
         or exists (select 1 from public.batches b where b.id = batch_id and b.manufacturer_id = public.acting_org()));

-- admin counts should not include staff logins
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'admin' then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'manufacturers', (select count(*) from public.profiles where org_id is null and role = 'manufacturer'),
    'distributors',  (select count(*) from public.profiles where org_id is null and role = 'distributor'),
    'retailers',     (select count(*) from public.profiles where org_id is null and role = 'retailer'),
    'consumers',     (select count(*) from public.profiles where org_id is null and role = 'consumer'),
    'unverified',    (select count(*) from public.profiles where org_id is null and role in ('manufacturer','distributor','retailer') and not verified),
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
-- 5. GRANTS for everything new (existing functions keep their grants)
-- ---------------------------------------------------------------------
grant select on public.role_permissions, public.org_members, public.org_invites to authenticated;
revoke execute on function
  public.acting_org(), public._can(text), public._require(text), public.my_context(),
  public.create_invite(text, text), public.revoke_invite(text), public.set_member(uuid, text, boolean),
  public.list_team(), public.check_invite(text)
from public, anon, authenticated;
grant execute on function
  public.acting_org(), public._can(text), public.my_context(), public.create_invite(text, text),
  public.revoke_invite(text), public.set_member(uuid, text, boolean), public.list_team()
to authenticated;
grant execute on function public.check_invite(text) to anon, authenticated;
grant execute on function public.current_role_name() to anon, authenticated;
