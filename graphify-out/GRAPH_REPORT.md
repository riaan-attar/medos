# Graph Report - medos  (2026-10-04)

## Corpus Check
- 62 files · ~45,143 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 429 nodes · 1390 edges · 19 communities (18 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- ui.tsx
- types.ts
- App.tsx
- package.json
- errMsg
- compilerOptions
- compilerOptions
- seed.mjs
- .oxlintrc.json
- tsconfig.json
- Batches.tsx
- OrderDetail.tsx
- Settings.tsx
- Dashboard.tsx
- MedOS — Progress Tracker
- useAuth
- Signup.tsx
- MedOS — Medicine Supply Chain & Inventory Platform
- Landing.tsx

## God Nodes (most connected - your core abstractions)
1. `errMsg()` - 56 edges
2. `useAuth()` - 49 edges
3. `useAsync()` - 49 edges
4. `money()` - 45 edges
5. `react` - 35 edges
6. `lucide-react` - 30 edges
7. `useToast()` - 29 edges
8. `api` - 27 edges
9. `fmtDate()` - 27 edges
10. `react-router-dom` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Attention()` --calls--> `money()`  [EXTRACTED]
  src/pages/Dashboard.tsx → src/lib/format.ts
- `Timeline()` --calls--> `fmtDateTime()`  [EXTRACTED]
  src/pages/OrderDetail.tsx → src/lib/format.ts
- `create()` --calls--> `errMsg()`  [EXTRACTED]
  src/pages/Batches.tsx → src/lib/format.ts
- `run()` --calls--> `errMsg()`  [EXTRACTED]
  src/pages/Batches.tsx → src/lib/format.ts
- `Gate()` --calls--> `useAuth()`  [EXTRACTED]
  src/App.tsx → src/auth/AuthContext.tsx

## Import Cycles
- None detected.

## Communities (19 total, 1 thin omitted)

### Community 0 - "ui.tsx"
Cohesion: 0.15
Nodes (47): lucide-react, react, react-router-dom, Column, DataTable(), Props, ReceiptDoc(), Ctx (+39 more)

### Community 1 - "types.ts"
Cohesion: 0.06
Nodes (54): AuthProvider(), AuthState, Ctx, SignUpInput, CommandPalette(), Item, EXTRA, NAV (+46 more)

### Community 2 - "App.tsx"
Cohesion: 0.08
Nodes (23): Accounts, AdminActivity, AdminUsers, BUYERS, Customers, Favorites, FindMedicine, Inventory (+15 more)

### Community 3 - "package.json"
Cohesion: 0.05
Nodes (36): dependencies, lucide-react, qrcode.react, react, react-dom, react-router-dom, recharts, @supabase/supabase-js (+28 more)

### Community 4 - "errMsg"
Cohesion: 0.07
Nodes (48): useToast(), daysUntil(), errMsg(), num(), Coords, fmtKm(), load(), useLocation() (+40 more)

### Community 5 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 6 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 7 - "seed.mjs"
Cohesion: 0.10
Nodes (18): @supabase/supabase-js, c, check(), expectFail(), id, rpc(), who, admin (+10 more)

### Community 8 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 10 - "Batches.tsx"
Cohesion: 0.10
Nodes (23): RFC-4180, vitest, Batches, exportCsv(), Avatar(), PromptModal(), downloadCsv(), parseCsv() (+15 more)

### Community 11 - "OrderDetail.tsx"
Cohesion: 0.11
Nodes (15): qrcode.react, OrderDetail, InvoiceDoc(), StarInput(), outstanding(), timeAgo(), OrderStatus, Party (+7 more)

### Community 12 - "Settings.tsx"
Cohesion: 0.31
Nodes (8): App(), Settings, applyTheme(), initTheme(), read(), Theme, useTheme(), Tab

### Community 13 - "Dashboard.tsx"
Cohesion: 0.22
Nodes (6): Dashboard, Attention(), axis, ConsumerHome(), PALETTE, tip

### Community 14 - "MedOS — Progress Tracker"
Cohesion: 0.25
Nodes (7): Architecture notes, Changelog, Known limitations / ideas, MedOS — Progress Tracker, Roles & pages, Status, What was added in v2

### Community 15 - "useAuth"
Cohesion: 0.29
Nodes (7): Gate(), GuestOnly(), Only(), useAuth(), Suspended(), Layout(), Dashboard()

### Community 16 - "Signup.tsx"
Cohesion: 0.36
Nodes (5): AuthShell(), Field(), Login(), ROLES, SignupRole

### Community 17 - "MedOS — Medicine Supply Chain & Inventory Platform"
Cohesion: 0.40
Nodes (4): Making an admin, MedOS — Medicine Supply Chain & Inventory Platform, Scripts, Setup

### Community 18 - "Landing.tsx"
Cohesion: 0.40
Nodes (3): FEATURES, Landing(), ROLES

## Knowledge Gaps
- **127 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `name` (+122 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 152 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@supabase/supabase-js` connect `seed.mjs` to `types.ts`, `package.json`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `errMsg()` connect `errMsg` to `ui.tsx`, `Batches.tsx`, `OrderDetail.tsx`, `Settings.tsx`, `Signup.tsx`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `react` connect `ui.tsx` to `types.ts`, `App.tsx`, `package.json`, `errMsg`, `Batches.tsx`, `OrderDetail.tsx`, `Settings.tsx`, `Signup.tsx`, `Landing.tsx`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **What connects `$schema`, `plugins`, `react/rules-of-hooks` to the rest of the system?**
  _127 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ui.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.14738738738738738 - nodes in this community are weakly interconnected._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.058653846153846154 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._