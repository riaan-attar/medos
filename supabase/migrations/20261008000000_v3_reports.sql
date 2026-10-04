-- =====================================================================
-- MedOS v3 · Phase 3 — Reports (run AFTER v3_compliance)
-- Read-only RPCs, scoped to the acting business, gated by the 'reports' permission.
-- Dates are inclusive. Safe to re-run.
-- =====================================================================

-- Sales: B2B invoices + customer reservations + counter bills (counter bills are tax-inclusive)
create or replace function public.report_sales(p_from date, p_to date)
returns table (doc_date date, kind text, ref_no text, party text, taxable numeric, tax numeric, total numeric, paid numeric, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  select i.created_at::date, 'invoice'::text, i.invoice_no, public._display_name(i.buyer_id),
         i.subtotal, i.tax, i.total - i.credit_total, i.paid_total, i.status
  from public.invoices i
  where i.seller_id = public.acting_org() and i.status <> 'void' and i.created_at::date between p_from and p_to
  union all
  select b.created_at::date, 'bill'::text, b.bill_no, coalesce(nullif(b.customer_name, ''), 'Walk-in'),
         round((b.total - b.refunded_total) - t.tax, 2), round(t.tax, 2), b.total - b.refunded_total, b.total - b.refunded_total,
         case when b.payment_mode = 'credit' then 'credit' else 'paid' end
  from public.sale_bills b
  cross join lateral (select coalesce(sum(l.quantity * l.unit_price * l.gst_rate / (100 + l.gst_rate)), 0) as raw
                      from public.sale_bill_lines l where l.bill_id = b.id) g
  cross join lateral (select case when b.subtotal > 0 and b.total > 0
                                  then g.raw * (b.total / b.subtotal) * ((b.total - b.refunded_total) / b.total) else 0 end as tax) t
  where b.retailer_id = public.acting_org() and b.created_at::date between p_from and p_to
  order by 1 desc, 3 desc;
end $$;

create or replace function public.report_purchases(p_from date, p_to date)
returns table (doc_date date, ref_no text, party text, taxable numeric, tax numeric, total numeric, paid numeric, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  select i.created_at::date, i.invoice_no, public._display_name(i.seller_id), i.subtotal, i.tax,
         i.total - i.credit_total, i.paid_total, i.status
  from public.invoices i
  where i.buyer_id = public.acting_org() and i.status <> 'void' and i.created_at::date between p_from and p_to
  order by 1 desc, 2 desc;
end $$;

-- GST: output tax collected vs input tax paid, by rate. CGST+SGST for intra-state supplies, IGST otherwise.
-- (Before credit notes. Customer reservations and counter bills are priced tax-inclusive, so tax is backed out.)
create or replace function public.report_gst_summary(p_from date, p_to date)
returns table (direction text, rate numeric, taxable numeric, cgst numeric, sgst numeric, igst numeric, tax numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  with lines as (
    select 'output'::text as dir, oi.gst_rate as rate, (oi.quantity * oi.unit_price)::numeric as taxable,
           (oi.quantity * oi.unit_price * oi.gst_rate / 100)::numeric as tax, (i.igst > 0) as inter
    from public.invoices i
    join public.order_items oi on oi.order_id = i.order_id
    join public.profiles bp on bp.id = i.buyer_id
    where i.seller_id = public.acting_org() and i.status <> 'void' and bp.role <> 'consumer'
      and i.created_at::date between p_from and p_to
    union all
    select 'output', m.gst_rate,
           (oi.quantity * oi.unit_price * 100 / (100 + m.gst_rate))::numeric,
           (oi.quantity * oi.unit_price * m.gst_rate / (100 + m.gst_rate))::numeric, false
    from public.invoices i
    join public.order_items oi on oi.order_id = i.order_id
    join public.medicines m on m.id = oi.medicine_id
    join public.profiles bp on bp.id = i.buyer_id
    where i.seller_id = public.acting_org() and i.status <> 'void' and bp.role = 'consumer'
      and i.created_at::date between p_from and p_to
    union all
    select 'output', l.gst_rate,
           (l.quantity * l.unit_price * 100 / (100 + l.gst_rate) * (case when b.subtotal > 0 then b.total / b.subtotal else 1 end)
              * (case when b.total > 0 then (b.total - b.refunded_total) / b.total else 1 end))::numeric,
           (l.quantity * l.unit_price * l.gst_rate / (100 + l.gst_rate) * (case when b.subtotal > 0 then b.total / b.subtotal else 1 end)
              * (case when b.total > 0 then (b.total - b.refunded_total) / b.total else 1 end))::numeric, false
    from public.sale_bills b join public.sale_bill_lines l on l.bill_id = b.id
    where b.retailer_id = public.acting_org() and b.created_at::date between p_from and p_to
    union all
    select 'input', oi.gst_rate, (oi.quantity * oi.unit_price)::numeric, (oi.quantity * oi.unit_price * oi.gst_rate / 100)::numeric, (i.igst > 0)
    from public.invoices i join public.order_items oi on oi.order_id = i.order_id
    where i.buyer_id = public.acting_org() and i.status <> 'void' and i.created_at::date between p_from and p_to
  )
  select x.dir, x.rate, round(sum(x.taxable), 2),
         round(sum(case when x.inter then 0 else x.tax / 2 end), 2),
         round(sum(case when x.inter then 0 else x.tax / 2 end), 2),
         round(sum(case when x.inter then x.tax else 0 end), 2),
         round(sum(x.tax), 2)
  from lines x group by x.dir, x.rate order by x.dir desc, x.rate;
end $$;

create or replace function public.report_stock_valuation()
returns table (medicine_id uuid, name text, strength text, pack_size text, units integer, unit_price numeric, value numeric,
               mrp numeric, value_at_mrp numeric, near_expiry_units integer, expired_units integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  select m.id, m.name, m.strength, m.pack_size, sum(i.quantity)::int, coalesce(l.unit_price, m.mrp),
         round(sum(i.quantity) * coalesce(l.unit_price, m.mrp), 2), m.mrp, round(sum(i.quantity) * m.mrp, 2),
         coalesce(sum(i.quantity) filter (where b.expiry_date >= current_date and b.expiry_date < current_date + 90), 0)::int,
         coalesce(sum(i.quantity) filter (where b.expiry_date < current_date), 0)::int
  from public.inventory i
  join public.batches b on b.id = i.batch_id
  join public.medicines m on m.id = b.medicine_id
  left join public.listings l on l.owner_id = i.owner_id and l.medicine_id = m.id
  where i.owner_id = public.acting_org() and i.quantity > 0
  group by m.id, l.unit_price
  order by 7 desc;
end $$;

-- Losses: written-off / damaged / recalled units in the period (valued at your price), plus expired stock still on the shelf
create or replace function public.report_expiry_loss(p_from date, p_to date)
returns table (doc_date date, kind text, medicine text, batch_no text, units integer, value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  select sm.created_at::date, sm.movement_type, m.name, b.batch_no, (-sm.quantity)::int,
         round(-sm.quantity * coalesce(l.unit_price, m.mrp), 2)
  from public.stock_movements sm
  join public.medicines m on m.id = sm.medicine_id
  join public.batches b on b.id = sm.batch_id
  left join public.listings l on l.owner_id = sm.owner_id and l.medicine_id = sm.medicine_id
  where sm.owner_id = public.acting_org() and sm.movement_type in ('expired_writeoff', 'damage', 'recall_writeoff')
    and sm.created_at::date between p_from and p_to
  union all
  select current_date, 'expired_on_hand'::text, m.name, b.batch_no, i.quantity,
         round(i.quantity * coalesce(l.unit_price, m.mrp), 2)
  from public.inventory i
  join public.batches b on b.id = i.batch_id
  join public.medicines m on m.id = b.medicine_id
  left join public.listings l on l.owner_id = i.owner_id and l.medicine_id = m.id
  where i.owner_id = public.acting_org() and i.quantity > 0 and b.expiry_date < current_date
  order by 1 desc, 6 desc;
end $$;

-- Margin per medicine = revenue (ex-GST) − units × weighted-average purchase price of what you bought.
-- Manufacturers have no purchase cost, so cost/margin are null for them.
create or replace function public.report_margin(p_from date, p_to date)
returns table (medicine_id uuid, name text, strength text, units integer, revenue numeric, avg_cost numeric,
               cogs numeric, margin numeric, margin_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  with sold as (
    select oi.medicine_id as mid, oi.quantity::numeric as qty,
           case when bp.role = 'consumer' then oi.quantity * oi.unit_price * 100 / (100 + m.gst_rate)
                else oi.quantity * oi.unit_price end as rev
    from public.invoices i
    join public.order_items oi on oi.order_id = i.order_id
    join public.medicines m on m.id = oi.medicine_id
    join public.profiles bp on bp.id = i.buyer_id
    where i.seller_id = public.acting_org() and i.status <> 'void' and i.created_at::date between p_from and p_to
    union all
    select l.medicine_id, l.quantity::numeric,
           l.quantity * l.unit_price * 100 / (100 + l.gst_rate) * (case when b.subtotal > 0 then b.total / b.subtotal else 1 end)
    from public.sale_bills b join public.sale_bill_lines l on l.bill_id = b.id
    where b.retailer_id = public.acting_org() and b.created_at::date between p_from and p_to
  ),
  agg as (select s.mid, sum(s.qty) as units, sum(s.rev) as revenue from sold s group by s.mid),
  cost as (
    select oi.medicine_id as mid, sum(oi.quantity * oi.unit_price) / nullif(sum(oi.quantity), 0) as avg_cost
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.buyer_id = public.acting_org() and o.status in ('shipped', 'partially_shipped', 'delivered')
    group by oi.medicine_id
  )
  select m.id, m.name, m.strength, a.units::int, round(a.revenue, 2), round(c.avg_cost, 2),
         round(a.units * c.avg_cost, 2), round(a.revenue - a.units * c.avg_cost, 2),
         round(case when a.revenue > 0 and c.avg_cost is not null then (a.revenue - a.units * c.avg_cost) / a.revenue * 100 end, 1)
  from agg a join public.medicines m on m.id = a.mid left join cost c on c.mid = a.mid
  order by a.revenue desc;
end $$;

-- Ageing of what customers owe you and what you owe suppliers, by days past due
create or replace function public.report_ageing()
returns table (side text, party text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  select s.side, public._display_name(s.cp),
         coalesce(sum(s.amt) filter (where s.days <= 0), 0), coalesce(sum(s.amt) filter (where s.days between 1 and 30), 0),
         coalesce(sum(s.amt) filter (where s.days between 31 and 60), 0), coalesce(sum(s.amt) filter (where s.days between 61 and 90), 0),
         coalesce(sum(s.amt) filter (where s.days > 90), 0), sum(s.amt)
  from (
    select 'receivable'::text as side, i.buyer_id as cp, greatest(i.total - i.credit_total - i.paid_total, 0) as amt, (current_date - i.due_date) as days
    from public.invoices i where i.seller_id = public.acting_org() and i.status in ('unpaid', 'partial')
    union all
    select 'payable', i.seller_id, greatest(i.total - i.credit_total - i.paid_total, 0), (current_date - i.due_date)
    from public.invoices i where i.buyer_id = public.acting_org() and i.status in ('unpaid', 'partial')
  ) s
  where s.amt > 0
  group by s.side, s.cp
  order by 1, 8 desc;
end $$;

-- Retailer end-of-day (Z) report by payment mode
create or replace function public.report_daily_close(p_date date)
returns table (mode text, bills integer, gross numeric, refunds numeric, net numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require('reports');
  return query
  select b.payment_mode, count(*)::int, round(sum(b.total), 2), round(sum(b.refunded_total), 2), round(sum(b.total - b.refunded_total), 2)
  from public.sale_bills b where b.retailer_id = public.acting_org() and b.created_at::date = p_date
  group by b.payment_mode
  union all
  select 'reservation pickups'::text, count(*)::int, round(coalesce(sum(i.total), 0), 2), 0::numeric, round(coalesce(sum(i.total), 0), 2)
  from public.invoices i join public.profiles bp on bp.id = i.buyer_id
  where i.seller_id = public.acting_org() and bp.role = 'consumer' and i.status <> 'void' and i.created_at::date = p_date
  having count(*) > 0
  order by 1;
end $$;

revoke execute on function
  public.report_sales(date, date), public.report_purchases(date, date), public.report_gst_summary(date, date),
  public.report_stock_valuation(), public.report_expiry_loss(date, date), public.report_margin(date, date),
  public.report_ageing(), public.report_daily_close(date)
from public, anon, authenticated;
grant execute on function
  public.report_sales(date, date), public.report_purchases(date, date), public.report_gst_summary(date, date),
  public.report_stock_valuation(), public.report_expiry_loss(date, date), public.report_margin(date, date),
  public.report_ageing(), public.report_daily_close(date)
to authenticated;
