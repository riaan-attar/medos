-- =====================================================================
-- MedOS v3 · Phase 4 — Home delivery, saved addresses (run AFTER v3_reports)
--   * Pharmacies set delivery on/off, radius, fee, minimum order, free-delivery threshold
--   * Customers choose pickup or delivery at checkout; radius & minimum are enforced in place_order
--   * Delivery fee is added to the order total and the (tax-free) customer invoice
--   * customer_addresses: saved delivery addresses
-- Safe to re-run.
-- =====================================================================

alter table public.profiles
  add column if not exists delivery_enabled boolean not null default false,
  add column if not exists delivery_radius_km numeric(6,2) not null default 3 check (delivery_radius_km > 0),
  add column if not exists delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  add column if not exists delivery_min_order numeric(10,2) not null default 0 check (delivery_min_order >= 0),
  add column if not exists delivery_free_above numeric(10,2) check (delivery_free_above is null or delivery_free_above >= 0);

alter table public.orders
  add column if not exists fulfilment text not null default 'pickup',
  add column if not exists delivery_address text not null default '',
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision,
  add column if not exists delivery_phone text not null default '',
  add column if not exists delivery_fee numeric(10,2) not null default 0;
alter table public.orders drop constraint if exists orders_fulfilment_check;
alter table public.orders add constraint orders_fulfilment_check check (fulfilment in ('pickup','delivery'));

alter table public.invoices add column if not exists delivery_fee numeric(14,2) not null default 0;

create table if not exists public.customer_addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  label      text not null default 'Home',
  address    text not null check (length(trim(address)) > 3),
  phone      text not null default '',
  lat        double precision,
  lng        double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on public.customer_addresses (user_id);

alter table public.customer_addresses enable row level security;
drop policy if exists customer_addresses_all on public.customer_addresses;
create policy customer_addresses_all on public.customer_addresses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Re-emitted functions (new columns / parameters)
-- ---------------------------------------------------------------------
drop function if exists public.place_order(uuid, jsonb, text, text);
create or replace function public.place_order(
  p_seller uuid, p_items jsonb, p_notes text default '', p_prescription_path text default null,
  p_fulfilment text default 'pickup', p_delivery_address text default '', p_delivery_lat double precision default null,
  p_delivery_lng double precision default null, p_delivery_phone text default ''
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
  v_fee numeric := 0;
  v_seller public.profiles;
  v_dist double precision;
begin
  perform public._require('orders_manage');
  select role into v_seller_role from public.profiles where id = p_seller and status = 'active';
  if v_seller_role is null or not public._can_buy(v_buyer_role, v_seller_role) then
    raise exception 'A % cannot buy from a %', coalesce(v_buyer_role,'?'), coalesce(v_seller_role,'?');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Order has no items'; end if;
  select credit_limit, discount_pct into v_limit, v_disc from public.trade_relations where seller_id = p_seller and buyer_id = v_uid;
  v_disc := coalesce(v_disc, 0);

  if p_fulfilment not in ('pickup','delivery') then raise exception 'Invalid fulfilment option'; end if;
  if p_fulfilment = 'delivery' then
    select * into v_seller from public.profiles where id = p_seller;
    if v_buyer_role <> 'consumer' then raise exception 'Home delivery is only available to customers'; end if;
    if not v_seller.delivery_enabled then raise exception '% does not offer home delivery', v_seller.org_name; end if;
    if coalesce(trim(p_delivery_address), '') = '' then raise exception 'A delivery address is required'; end if;
    v_dist := public._distance_km(p_delivery_lat, p_delivery_lng, v_seller.lat, v_seller.lng);
    if v_dist is not null and v_dist > v_seller.delivery_radius_km then
      raise exception 'Outside the delivery area: % km away (limit % km)', round(v_dist::numeric, 1), v_seller.delivery_radius_km;
    end if;
  end if;

  insert into public.orders (buyer_id, seller_id, notes, prescription_path, fulfilment, delivery_address, delivery_lat, delivery_lng, delivery_phone)
  values (v_uid, p_seller, coalesce(p_notes,''), p_prescription_path, p_fulfilment,
          case when p_fulfilment = 'delivery' then trim(p_delivery_address) else '' end,
          case when p_fulfilment = 'delivery' then p_delivery_lat end, case when p_fulfilment = 'delivery' then p_delivery_lng end,
          case when p_fulfilment = 'delivery' then coalesce(trim(p_delivery_phone), '') else '' end)
  returning id into v_order;

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

  if p_fulfilment = 'delivery' then
    if v_total < v_seller.delivery_min_order then
      raise exception 'Minimum order for delivery is % (your items total %)', v_seller.delivery_min_order, round(v_total, 2);
    end if;
    v_fee := case when v_seller.delivery_free_above is not null and v_total >= v_seller.delivery_free_above then 0 else v_seller.delivery_fee end;
    update public.orders set delivery_fee = v_fee where id = v_order;
    v_total := v_total + v_fee;
  end if;

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
  perform public._notify(p_seller, 'New order received', public._display_name(v_uid) || case when p_fulfilment = 'delivery' then ' placed a delivery order' else ' placed an order' end, '/orders/' || v_order, 'order');
  return v_order;
end $$;

create or replace function public._recalc_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_sub numeric; v_tax numeric; v_cgst numeric := 0; v_sgst numeric := 0; v_igst numeric := 0;
  v_seller public.profiles; v_buyer public.profiles; v_intra boolean; v_break jsonb; v_fee numeric;
begin
  select id into v_id from public.invoices where order_id = p_order and status <> 'void';
  if v_id is null then return; end if;
  select * into v_seller from public.profiles where id = (select seller_id from public.orders where id = p_order);
  select * into v_buyer  from public.profiles where id = (select buyer_id  from public.orders where id = p_order);
  select coalesce(delivery_fee, 0) into v_fee from public.orders where id = p_order;
  v_intra := v_seller.state_code = '' or v_buyer.state_code = '' or v_seller.state_code = v_buyer.state_code;

  select coalesce(jsonb_agg(jsonb_build_object('rate', t.rate, 'taxable', t.taxable, 'tax', t.tax) order by t.rate), '[]'::jsonb),
         coalesce(sum(t.taxable), 0), coalesce(sum(t.tax), 0)
    into v_break, v_sub, v_tax
  from (select gst_rate as rate,
               round(sum(quantity * unit_price), 2) as taxable,
               round(sum(quantity * unit_price * gst_rate / 100), 2) as tax
        from public.order_items where order_id = p_order group by gst_rate) t;

  if v_intra then v_cgst := round(v_tax / 2, 2); v_sgst := v_tax - v_cgst; else v_igst := v_tax; end if;
  update public.invoices set subtotal = v_sub, tax = v_tax, cgst = v_cgst, sgst = v_sgst, igst = v_igst,
         delivery_fee = v_fee, total = v_sub + v_tax + v_fee, tax_breakup = v_break,
         place_of_supply = coalesce(nullif(v_buyer.state, ''), v_buyer.state_code, '')
   where id = v_id;
  perform public._refresh_invoice_status(v_id);
end $$;

drop function if exists public.list_suppliers(double precision, double precision);
create or replace function public.list_suppliers(p_lat double precision default null, p_lng double precision default null)
returns table (id uuid, role text, org_name text, full_name text, city text, address text, phone text,
               verified boolean, medicines_in_stock integer, distance_km double precision,
               rating_avg numeric, rating_count integer, is_favorite boolean,
               lat double precision, lng double precision, delivery_enabled boolean, delivery_fee numeric,
               delivery_min_order numeric, delivery_radius_km numeric, delivery_free_above numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, p.org_name, p.full_name, p.city, p.address, p.phone, p.verified,
    (select count(distinct b.medicine_id)::int from public.inventory i join public.batches b on b.id = i.batch_id
      where i.owner_id = p.id and i.quantity - i.reserved > 0 and b.status = 'active' and b.expiry_date >= current_date),
    public._distance_km(p_lat, p_lng, p.lat, p.lng),
    (select round(avg(r.rating), 1) from public.reviews r where r.seller_id = p.id),
    (select count(*)::int from public.reviews r where r.seller_id = p.id),
    exists (select 1 from public.favorites f where f.user_id = public.acting_org() and f.seller_id = p.id),
    p.lat, p.lng, p.delivery_enabled, p.delivery_fee, p.delivery_min_order, p.delivery_radius_km, p.delivery_free_above
  from public.profiles p
  where public._can_buy(public.current_role_name(), p.role) and p.id <> public.acting_org() and p.status = 'active' and p.org_id is null
  order by 10 asc nulls last, 11 desc nulls last, p.org_name
$$;

drop function if exists public.search_availability(text, double precision, double precision);
create or replace function public.search_availability(p_query text, p_lat double precision default null, p_lng double precision default null)
returns table (seller_id uuid, org_name text, city text, address text, phone text, verified boolean,
               medicine_id uuid, medicine text, generic_name text, strength text, dosage_form text,
               requires_rx boolean, mrp numeric, unit_price numeric, available integer,
               distance_km double precision, rating_avg numeric, rating_count integer,
               lat double precision, lng double precision, delivery_enabled boolean, delivery_fee numeric, delivery_min_order numeric)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.org_name, sp.city, sp.address, sp.phone, sp.verified,
         m.id, m.name, m.generic_name, m.strength, m.dosage_form, m.requires_rx, m.mrp, l.unit_price,
         sum(i.quantity - i.reserved)::int,
         public._distance_km(p_lat, p_lng, sp.lat, sp.lng),
         (select round(avg(r.rating), 1) from public.reviews r where r.seller_id = sp.id),
         (select count(*)::int from public.reviews r where r.seller_id = sp.id),
         sp.lat, sp.lng, sp.delivery_enabled, sp.delivery_fee, sp.delivery_min_order
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

create or replace function public.pharmacy_profile(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'org_name', p.org_name, 'city', p.city, 'address', p.address,
    'phone', p.phone, 'verified', p.verified, 'about', p.about, 'lat', p.lat, 'lng', p.lng, 'delivery_enabled', p.delivery_enabled, 'delivery_fee', p.delivery_fee,
    'delivery_min_order', p.delivery_min_order, 'delivery_radius_km', p.delivery_radius_km, 'delivery_free_above', p.delivery_free_above,
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

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.customer_addresses to authenticated;
grant update (full_name, org_name, phone, address, city, license_no, lat, lng, about, gstin, state, state_code, accepted_terms_at,
              delivery_enabled, delivery_radius_km, delivery_fee, delivery_min_order, delivery_free_above) on public.profiles to authenticated;

revoke execute on function
  public.place_order(uuid, jsonb, text, text, text, text, double precision, double precision, text),
  public.list_suppliers(double precision, double precision),
  public.search_availability(text, double precision, double precision),
  public.pharmacy_profile(uuid),
  public._recalc_invoice(uuid)
from public, anon, authenticated;
grant execute on function
  public.place_order(uuid, jsonb, text, text, text, text, double precision, double precision, text),
  public.list_suppliers(double precision, double precision),
  public.search_availability(text, double precision, double precision),
  public.pharmacy_profile(uuid)
to authenticated;
grant execute on function public.pharmacy_profile(uuid) to anon;
