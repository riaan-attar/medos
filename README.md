# MedOS — Medicine Supply Chain & Inventory Platform

Vite + React + TypeScript frontend, Supabase (Postgres, Auth, Realtime, Storage) backend.
Tracks medicine from **factory → dealer/wholesaler → retailer → customer** with batch-level traceability,
GST invoicing, payments, returns, recalls, point-of-sale and a public authenticity check.

## Setup

1. **Supabase project** → SQL Editor → run, in order:
   1. `supabase/migrations/20261004000000_init.sql` (v1 core)
   2. `supabase/migrations/20261005000000_v2.sql` (v2: invoices, reservations, POS, returns, reviews, audit…)
   Both are safe to re-run. If the v2 script reports an error, fix it before continuing — the app needs both.
2. Authentication → Email: disable **Confirm email** while testing.
3. `cp .env.example .env`, fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev`
5. Optional demo data (6 accounts + stock, orders, invoices, a fulfilled customer order, reviews):
   ```bash
   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed.mjs
   ```
   Logins (password `Demo@1234`): `factory@`, `dealer@`, `pharmacy1@`, `pharmacy2@`, `customer@`, `admin@` `medos.demo`.
5b. Optional **bulk demo data** (≈56 accounts, 57 medicines, ~245 orders in every status, 60 days of backdated history, 390 POS bills, payments, returns, reviews, a recall). Run after `seed.mjs`; refuses to run twice unless `--force`:
   ```bash
   set -a; . ./.env; set +a; node scripts/seed-bulk.mjs
   ```
   Extra logins (same password): `factory2..4@`, `dealer2..6@`, `pharmacy3..20@`, `customer2..28@` `medos.demo`.
6. Verify everything works against your project (creates uniquely-named `E2E-…` data, ~60 assertions):
   ```bash
   SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/e2e.mjs
   ```

## Scripts
`npm run dev` · `npm run build` · `npm run lint` · `npm test` (vitest unit tests)

## Making an admin
Signup can never create admins. The seed script promotes `admin@medos.demo`. Manually:
`update profiles set role='admin' where id = '<user uuid>';`

See **PROGRESS.md** for the feature list, architecture and status.
