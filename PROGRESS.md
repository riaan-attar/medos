# MedOS — Progress Tracker

## Status

| Area | State |
|---|---|
| v1 (core app, schema, RLS) | ✅ Running against the owner's live Supabase project |
| v2 UI (redesign + all features below) | ✅ Builds clean: `tsc`, `vite build`, 5 unit tests pass, lint has only minor warnings |
| v2 SQL (`20261005000000_v2.sql`) | ⚠ **Written but not yet executed anywhere** — apply it, then run the e2e script |
| End-to-end verification (`scripts/e2e.mjs`) | ⚠ Written, **not yet run** (needs v2 applied + seeded demo users) |
| Browser walkthrough per role | ❌ Not done yet |

**Next step for the owner:** run the v2 SQL → `node scripts/seed.mjs` → `node scripts/e2e.mjs` → click through each role. Any SQL error or failed assertion points to the exact thing to fix.

## v3 (finishing the product) — in progress

| Phase | State |
|---|---|
| 1 Teams, staff & permissions (`20261006000000_v3_teams.sql`) | code done · **migration not yet applied** |
| 2 GST-correct invoices, drug schedules, H1 register, legal pages (`20261007000000_v3_compliance.sql`) | code done · **migration not yet applied** |
| 3 Reports & exports (`20261008000000_v3_reports.sql`) | code done · **migration not yet applied** |
| 4 Delivery & maps · 5 POS upgrade & customer credit · 6 Data import · 7 Forecasting · 8 Email notifications · 9 Polish/help/PWA · 10 QA · 11 Handover (e2e run, reset script, CI) · 12 Payments & plans (last) | planned |

Apply v3 migrations **in order** after v2. Note: `create_bill` / `record_sale` are no longer callable from the client — use `create_bill_ex` (prescription rules enforced). Scripts were updated accordingly.

## Roles & pages

| Role | Pages |
|---|---|
| **Manufacturer** | Dashboard (analytics) · Medicine catalog (GST, barcode) · Batches & recalls (QR label, CSV import, "where is it now", recall responses) · Inventory · Orders · Returns · Buyers & credit (limits, discounts) · Accounts · Stock ledger · Verify |
| **Distributor** | Dashboard · Buy from factories · Reorder suggestions · Inventory · Orders · Returns · Retailers & credit · Accounts · Ledger · Verify |
| **Retailer** | Dashboard · Point of sale · Sales & bills (refunds, receipts) · Customers · Buy stock · Reorder suggestions · Inventory · Orders · Returns · Accounts · Ledger · Verify |
| **Customer** | Home · Find medicine (nearest-first, alternatives) · My orders (prescription upload, reviews) · Saved pharmacies · Pharmacy profiles · Verify |
| **Admin** | Overview charts · Accounts (verify / suspend) · Monitoring (all orders, recalls, audit log) |
| Everyone | Landing page · ⌘K command palette · notification popover · Settings (profile, location, password, theme) · public `/check/<batch>` |

## What was added in v2

- **Design:** new design system (Inter, lucide icons, skeleton loaders, light/dark toggle), landing page, split-screen auth, grouped sidebar, command palette, sortable/searchable/paginated tables with CSV export everywhere.
- **Analytics:** revenue trend, stock by category, expiry timeline, top movers, stock in/out, receivable/payable, top buyers/suppliers, "needs attention" panel.
- **Money:** invoices with GST (consumer prices are MRP-inclusive), payments (partial, multiple methods), credit notes from returns, per-buyer credit limits and discounts, receivables/payables per party, printable invoice / packing slip / receipt.
- **Order lifecycle:** stock **reservation** at accept, **partial shipments** with ETA + tracking, per-shipment receipt, short-close, cancel (releases stock), returns with approval and credit note, order timeline, buyer↔seller messages, reorder button.
- **Retail:** multi-line POS with barcode/Enter-to-add, FEFO batch pick, discount, payment mode, auto customer directory, sales history with daily totals, refunds that restore stock.
- **Customer:** distance-based pharmacy search (browser location), prescription upload to a private Storage bucket (required for Rx items), reviews & ratings, saved pharmacies, same-salt alternatives.
- **Manufacturer:** QR batch labels, CSV batch import, batch distribution tracking, recall acknowledgements by holders.
- **Platform:** account suspension, audit log of sensitive actions, notification categories, reorder suggestions that pick the cheapest eligible supplier.

## Architecture notes

- **SQL:** `init.sql` (v1) + `v2.sql` (additive; redefines several RPCs: `place_order`, `advance_order`, `dashboard_stats`, `verify_batch`, `list_suppliers`, `search_availability`, `get_supplier_catalog`). All writes to stock/orders/money go through `SECURITY DEFINER` RPCs; clients only write their own profile, medicines, prices, messages, favourites, credit terms (as seller) and notification read-state. v2 ends by re-applying grants from scratch (revoke all, grant exactly what's needed).
- **Stock model:** `inventory.quantity` on hand, `inventory.reserved` held for accepted orders (`reserved <= quantity` enforced by a check). Sellable = `quantity − reserved`, non-expired, non-recalled.
- **Order status:** `pending → accepted → partially_shipped → shipped → delivered` (+ `rejected`, `cancelled`). Derived from shipments by `_recompute_status`.
- **Frontend:** `src/lib/api.ts` (all Supabase calls), `src/components/DataTable.tsx`, `ui.tsx`, `Layout.tsx`, `nav.ts` (role menus); one file per page in `src/pages`; Dashboard (recharts) and most pages are code-split.
- **Tests:** `src/lib/format.test.ts` (unit), `scripts/e2e.mjs` (live-DB integration incl. RLS isolation checks).

## Known limitations / ideas

- [ ] v2 SQL and e2e not yet executed (see above).
- [ ] No payment gateway — payments are recorded manually by the seller.
- [ ] Pharmacy "map" is a link to OpenStreetMap; no embedded map.
- [ ] No email/SMS/push notifications (in-app only, realtime).
- [ ] Seed script is not idempotent for orders (re-running adds more orders).
- [ ] Hand-written types; could be generated with `supabase gen types typescript`.
- [ ] Returns are business-to-business only; customers contact the pharmacy directly.
- [ ] Prescription files aren't virus-scanned or size-limited beyond Storage defaults.

## Changelog

- 2026-10-05 — v2: redesign + analytics, invoices/payments, reservations/partial shipments/returns, POS, customer experience, QR labels, recall acks, admin audit, tests.
- 2026-10-04 — v1: schema, RLS, RPCs, 5 roles, 17 pages, seed script.
