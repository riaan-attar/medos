-- =====================================================================
-- MedOS v3 · Phase 5 — Counter-sale upgrade & customer credit (udhaar)  (run AFTER v3_delivery)
--   * held_bills: park a bill and resume it later (survives refresh / other device)
--   * customer_ledger: running balance per retail customer for sales on credit,
--     payments collected, refunds on credit sales
--   * credit sales require a customer phone; refunds on credit sales reduce the balance
-- Safe to re-run.
-- =====================================================================

create table if not exists public.held_bills (
  id          uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.profiles(id) on delete cascade,
  label       text not null default '',
  payload     jsonb not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists held_bills_idx on public.held_bills (retailer_id, created_at desc);

create table if not exists public.customer_ledger (
  id          uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.retail_customers(id) on delete cascade,
  bill_id     uuid references public.sale_bills(id) on delete set null,
  kind        text not null check (kind in ('charge','payment','refund')),
  amount      numeric(14,2) not null check (amount > 0),
  mode        text not null default '' ,
  note        text not null default '',
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists customer_ledger_idx on public.customer_ledger (retailer_id, customer_id, created_at desc);

alter table public.held_bills enable row level security;
alter table public.customer_ledger enable row level security;
drop policy if exists held_bills_all on public.held_bills;
create policy held_bills_all on public.held_bills for all to authenticated
  using (retailer_id = public.acting_org() and public._can('sell'))
  with check (retailer_id = public.acting_org() and public._can('sell') and public.current_role_name() = 'retailer');
drop policy if exists customer_ledger_read on public.customer_ledger;
create policy customer_ledger_read on public.customer_ledger for select to authenticated
  using (retailer_id = public.acting_org() and public._can('customers'));

-- customers with their balance (balance = charges − payments − refunds)
create or replace function public.customer_balances()
returns table (customer_id uuid, name text, phone text, balance numeric, last_activity timestamptz, bills integer, spent numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('customers');
  return query
  select c.id, c.name, c.phone,
         coalesce((select sum(case when l.kind = 'charge' then l.amount else -l.amount end) from public.customer_ledger l where l.customer_id = c.id), 0),
         (select max(l.created_at) from public.customer_ledger l where l.customer_id = c.id),
         (select count(*)::int from public.sale_bills b where b.customer_id = c.id),
         coalesce((select sum(b.total - b.refunded_total) from public.sale_bills b where b.customer_id = c.id), 0)
  from public.retail_customers c where c.retailer_id = public.acting_org()
  order by 4 desc, 7 desc;
end $$;

create or replace function public.collect_customer_payment(p_customer uuid, p_amount numeric, p_mode text default 'cash', p_note text default '')
returns numeric language plpgsql security definer set search_path = public as $$
declare v_bal numeric;
begin
  perform public._require('customers');
  if p_mode not in ('cash','upi','card') then raise exception 'Invalid payment mode'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  perform 1 from public.retail_customers where id = p_customer and retailer_id = public.acting_org() for update;
  if not found then raise exception 'Customer not found'; end if;
  select coalesce(sum(case when kind = 'charge' then amount else -amount end), 0) into v_bal
    from public.customer_ledger where customer_id = p_customer;
  if round(p_amount, 2) > v_bal + 0.005 then raise exception 'Amount exceeds the outstanding balance (%)', v_bal; end if;
  insert into public.customer_ledger (retailer_id, customer_id, kind, amount, mode, note, created_by)
  values (public.acting_org(), p_customer, 'payment', round(p_amount, 2), p_mode, coalesce(p_note, ''), auth.uid());
  return v_bal - round(p_amount, 2);
end $$;

-- re-emitted: credit sales write to the ledger / credit refunds reduce it
create or replace function public.create_bill_ex(
  p_lines jsonb, p_customer_name text default '', p_customer_phone text default '',
  p_discount numeric default 0, p_payment_mode text default 'cash',
  p_patient text default '', p_doctor text default '', p_doctor_reg text default '', p_rx_no text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_bill uuid; v_needs_rx boolean; v_has_h1 boolean; v_patient text; v_cust uuid; v_total numeric;
begin
  v_bill := public.create_bill(p_lines, p_customer_name, p_customer_phone, p_discount, p_payment_mode);
  -- sales on credit (udhaar) must belong to an identifiable customer and are added to their running balance
  if p_payment_mode = 'credit' then
    select customer_id, total into v_cust, v_total from public.sale_bills where id = v_bill;
    if v_cust is null then raise exception 'A customer phone number is required for credit sales'; end if;
    insert into public.customer_ledger (retailer_id, customer_id, bill_id, kind, amount, note, created_by)
    values (public.acting_org(), v_cust, v_bill, 'charge', v_total, 'Bill on credit', auth.uid());
  end if;
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
  -- refunding a credit sale reduces what the customer owes
  if v_bill.payment_mode = 'credit' and v_bill.customer_id is not null and v_total > 0 then
    insert into public.customer_ledger (retailer_id, customer_id, bill_id, kind, amount, note, created_by)
    values (public.acting_org(), v_bill.customer_id, v_bill.id, 'refund', v_total, 'Refund on ' || v_bill.bill_no, auth.uid());
  end if;
  return v_total;
end $$;

-- backfill: bills already made "on credit" become ledger charges (those with a known customer)
insert into public.customer_ledger (retailer_id, customer_id, bill_id, kind, amount, note, created_at)
select b.retailer_id, b.customer_id, b.id, 'charge', b.total, 'Bill on credit', b.created_at
from public.sale_bills b
where b.payment_mode = 'credit' and b.customer_id is not null
  and not exists (select 1 from public.customer_ledger l where l.bill_id = b.id and l.kind = 'charge');
insert into public.customer_ledger (retailer_id, customer_id, bill_id, kind, amount, note, created_at)
select b.retailer_id, b.customer_id, b.id, 'refund', b.refunded_total, 'Refund on ' || b.bill_no, b.created_at
from public.sale_bills b
where b.payment_mode = 'credit' and b.customer_id is not null and b.refunded_total > 0
  and not exists (select 1 from public.customer_ledger l where l.bill_id = b.id and l.kind = 'refund');

grant select, insert, delete on public.held_bills to authenticated;
grant select on public.customer_ledger to authenticated;
revoke execute on function
  public.customer_balances(), public.collect_customer_payment(uuid, numeric, text, text),
  public.create_bill_ex(jsonb, text, text, numeric, text, text, text, text, text), public.refund_bill(uuid, jsonb, text)
from public, anon, authenticated;
grant execute on function
  public.customer_balances(), public.collect_customer_payment(uuid, numeric, text, text),
  public.create_bill_ex(jsonb, text, text, numeric, text, text, text, text, text), public.refund_bill(uuid, jsonb, text)
to authenticated;
