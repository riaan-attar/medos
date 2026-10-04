-- =====================================================================
-- MedOS v3 · Phase 2 — Compliance & GST-correct documents (run AFTER v3_teams)
--   * HSN codes + drug schedule (OTC / H / H1 / X) on medicines
--   * Seller/buyer state → CGST+SGST vs IGST split on invoices, tax breakup by rate
--   * Schedule X blocked for consumers & counter sales; H/H1 need prescription details
--   * Schedule H1 register (retailer) written automatically by create_bill_ex()
--   * terms acceptance timestamp
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUMNS
-- ---------------------------------------------------------------------
alter table public.medicines
  add column if not exists hsn_code text not null default '3004',
  add column if not exists drug_schedule text not null default 'OTC',
  add column if not exists composition text not null default '';
alter table public.medicines drop constraint if exists medicines_drug_schedule_check;
alter table public.medicines add constraint medicines_drug_schedule_check check (drug_schedule in ('OTC','H','H1','X'));

alter table public.profiles
  add column if not exists state text not null default '',
  add column if not exists state_code text not null default '',
  add column if not exists accepted_terms_at timestamptz;

alter table public.invoices
  add column if not exists cgst numeric(14,2) not null default 0,
  add column if not exists sgst numeric(14,2) not null default 0,
  add column if not exists igst numeric(14,2) not null default 0,
  add column if not exists place_of_supply text not null default '',
  add column if not exists tax_breakup jsonb not null default '[]'::jsonb;

alter table public.sale_bills
  add column if not exists patient_name text not null default '',
  add column if not exists doctor_name text not null default '',
  add column if not exists doctor_reg_no text not null default '',
  add column if not exists rx_number text not null default '';

create table if not exists public.h1_register (
  id           uuid primary key default gen_random_uuid(),
  retailer_id  uuid not null references public.profiles(id),
  bill_id      uuid not null references public.sale_bills(id) on delete cascade,
  bill_line_id uuid not null references public.sale_bill_lines(id) on delete cascade,
  medicine_id  uuid not null references public.medicines(id),
  batch_id     uuid not null references public.batches(id),
  quantity     integer not null check (quantity > 0),
  patient_name text not null,
  doctor_name  text not null,
  doctor_reg_no text not null default '',
  rx_number    text not null default '',
  sold_at      timestamptz not null default now()
);
create index if not exists h1_register_idx on public.h1_register (retailer_id, sold_at desc);

-- ---------------------------------------------------------------------
-- 2. TRIGGERS
-- ---------------------------------------------------------------------
-- requires_rx always mirrors the schedule (a manually ticked Rx box on an OTC drug promotes it to H)
create or replace function public.medicines_schedule_sync()
returns trigger language plpgsql as $$
begin
  if new.requires_rx and new.drug_schedule = 'OTC' then new.drug_schedule := 'H'; end if;
  new.requires_rx := new.drug_schedule <> 'OTC';
  return new;
end $$;
drop trigger if exists medicines_schedule_sync on public.medicines;
create trigger medicines_schedule_sync before insert or update on public.medicines
  for each row execute function public.medicines_schedule_sync();

-- GSTIN's first two digits are the state code
create or replace function public.profiles_gst_state()
returns trigger language plpgsql as $$
begin
  if new.gstin ~ '^[0-9]{2}' and (tg_op = 'INSERT' or new.gstin is distinct from old.gstin) then
    new.state_code := left(new.gstin, 2);
  end if;
  return new;
end $$;
drop trigger if exists profiles_gst_state on public.profiles;
create trigger profiles_gst_state before insert or update on public.profiles
  for each row execute function public.profiles_gst_state();

-- Schedule X can never be sold to a consumer, nor over the counter
create or replace function public.order_items_schedule_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sched text; v_name text; v_role text;
begin
  select drug_schedule, name into v_sched, v_name from public.medicines where id = new.medicine_id;
  select p.role into v_role from public.orders o join public.profiles p on p.id = o.buyer_id where o.id = new.order_id;
  if v_sched = 'X' and v_role = 'consumer' then
    raise exception '% is a Schedule X drug and cannot be reserved online', v_name;
  end if;
  return new;
end $$;
drop trigger if exists order_items_schedule_check on public.order_items;
create trigger order_items_schedule_check before insert on public.order_items
  for each row execute function public.order_items_schedule_check();

create or replace function public.bill_lines_schedule_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sched text; v_name text;
begin
  select drug_schedule, name into v_sched, v_name from public.medicines where id = new.medicine_id;
  if v_sched = 'X' then raise exception '% is a Schedule X drug and cannot be sold over the counter', v_name; end if;
  return new;
end $$;
drop trigger if exists bill_lines_schedule_check on public.sale_bill_lines;
create trigger bill_lines_schedule_check before insert on public.sale_bill_lines
  for each row execute function public.bill_lines_schedule_check();

-- ---------------------------------------------------------------------
-- 3. INVOICE MATHS: per-rate breakup, CGST+SGST (intra-state) or IGST (inter-state)
--    Unknown state on either side is treated as intra-state.
-- ---------------------------------------------------------------------
create or replace function public._recalc_invoice(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_sub numeric; v_tax numeric; v_cgst numeric := 0; v_sgst numeric := 0; v_igst numeric := 0;
  v_seller public.profiles; v_buyer public.profiles; v_intra boolean; v_break jsonb;
begin
  select id into v_id from public.invoices where order_id = p_order and status <> 'void';
  if v_id is null then return; end if;
  select * into v_seller from public.profiles where id = (select seller_id from public.orders where id = p_order);
  select * into v_buyer  from public.profiles where id = (select buyer_id  from public.orders where id = p_order);
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
         total = v_sub + v_tax, tax_breakup = v_break,
         place_of_supply = coalesce(nullif(v_buyer.state, ''), v_buyer.state_code, '')
   where id = v_id;
  perform public._refresh_invoice_status(v_id);
end $$;

-- ---------------------------------------------------------------------
-- 4. COUNTER SALE WITH PRESCRIPTION DETAILS (+ H1 register)
--    create_bill itself stays as-is but is no longer callable from the client:
--    create_bill_ex wraps it so the prescription rules cannot be bypassed.
-- ---------------------------------------------------------------------
create or replace function public.create_bill_ex(
  p_lines jsonb, p_customer_name text default '', p_customer_phone text default '',
  p_discount numeric default 0, p_payment_mode text default 'cash',
  p_patient text default '', p_doctor text default '', p_doctor_reg text default '', p_rx_no text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_bill uuid; v_needs_rx boolean; v_has_h1 boolean; v_patient text;
begin
  v_bill := public.create_bill(p_lines, p_customer_name, p_customer_phone, p_discount, p_payment_mode);
  select coalesce(bool_or(m.drug_schedule in ('H','H1')), false), coalesce(bool_or(m.drug_schedule = 'H1'), false)
    into v_needs_rx, v_has_h1
  from public.sale_bill_lines sl join public.medicines m on m.id = sl.medicine_id where sl.bill_id = v_bill;
  v_patient := coalesce(nullif(trim(p_patient), ''), nullif(trim(p_customer_name), ''), '');
  if v_needs_rx and coalesce(trim(p_doctor), '') = '' then
    raise exception 'Prescription details (doctor name) are required for Schedule H / H1 drugs';
  end if;
  if v_has_h1 and v_patient = '' then
    raise exception 'Patient name is required for Schedule H1 drugs';
  end if;
  update public.sale_bills set patient_name = v_patient, doctor_name = coalesce(trim(p_doctor), ''),
         doctor_reg_no = coalesce(trim(p_doctor_reg), ''), rx_number = coalesce(trim(p_rx_no), '')
   where id = v_bill;
  insert into public.h1_register (retailer_id, bill_id, bill_line_id, medicine_id, batch_id, quantity, patient_name, doctor_name, doctor_reg_no, rx_number)
  select public.acting_org(), v_bill, sl.id, sl.medicine_id, sl.batch_id, sl.quantity, v_patient,
         coalesce(trim(p_doctor), ''), coalesce(trim(p_doctor_reg), ''), coalesce(trim(p_rx_no), '')
  from public.sale_bill_lines sl join public.medicines m on m.id = sl.medicine_id
  where sl.bill_id = v_bill and m.drug_schedule = 'H1';
  return v_bill;
end $$;

-- ---------------------------------------------------------------------
-- 5. RLS + GRANTS
-- ---------------------------------------------------------------------
alter table public.h1_register enable row level security;
drop policy if exists h1_register_read on public.h1_register;
create policy h1_register_read on public.h1_register for select to authenticated using (retailer_id = public.acting_org());

grant select on public.h1_register to authenticated;
grant update (full_name, org_name, phone, address, city, license_no, lat, lng, about, gstin, state, state_code, accepted_terms_at) on public.profiles to authenticated;
grant insert (manufacturer_id, name, generic_name, category, dosage_form, strength, pack_size, mrp, requires_rx, gst_rate, barcode, hsn_code, drug_schedule, composition) on public.medicines to authenticated;
grant update (name, generic_name, category, dosage_form, strength, pack_size, mrp, requires_rx, active, gst_rate, barcode, hsn_code, drug_schedule, composition) on public.medicines to authenticated;

revoke execute on function public.create_bill_ex(jsonb, text, text, numeric, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_bill_ex(jsonb, text, text, numeric, text, text, text, text, text) to authenticated;
-- the unchecked originals are for internal use only
revoke execute on function public.create_bill(jsonb, text, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.record_sale(uuid, integer, numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. BACKFILL (existing data)
-- ---------------------------------------------------------------------
update public.medicines set drug_schedule = 'H' where requires_rx and drug_schedule = 'OTC';
update public.medicines set drug_schedule = 'H1'
  where drug_schedule = 'H' and generic_name ~* '(azithromycin|ciprofloxacin|cefixime)';
update public.medicines set hsn_code = '3004' where hsn_code = '';

-- states from city, so the demo shows both CGST+SGST and IGST invoices
update public.profiles p set state = x.state, state_code = x.code
from (values ('Pune','Maharashtra','27'), ('Mumbai','Maharashtra','27'), ('Hyderabad','Telangana','36'),
             ('Bengaluru','Karnataka','29'), ('Delhi','Delhi','07'), ('Chennai','Tamil Nadu','33'),
             ('Ahmedabad','Gujarat','24'), ('Kolkata','West Bengal','19')) as x(city, state, code)
where p.city = x.city and p.state_code = '';
update public.profiles set gstin = state_code || substr(gstin, 3)
  where gstin ~ '^[0-9]{2}' and state_code <> '' and left(gstin, 2) <> state_code;

-- re-price every existing invoice with the new CGST/SGST/IGST logic. Per-rate rounding can shift a total
-- by a few paise, so invoices that were fully paid stay paid.
do $$
declare i record; v_was_paid uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_was_paid from public.invoices where status = 'paid';
  for i in select order_id from public.invoices where status <> 'void' loop
    perform public._recalc_invoice(i.order_id);
  end loop;
  update public.invoices set paid_total = total - credit_total
   where id = any(v_was_paid) and abs(total - credit_total - paid_total) < 1;
  for i in select id from public.invoices where id = any(v_was_paid) loop
    perform public._refresh_invoice_status(i.id);
  end loop;
end $$;
