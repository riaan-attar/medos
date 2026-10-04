import { Link } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AlertTriangle, ArrowRight, Boxes, ClipboardList, Clock, Coins, Factory, PackageSearch, Plus, ScanLine, Search, ShieldCheck,
  ShoppingCart, Truck, Wallet,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { money, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { Alert, Empty, ErrorBox, PageHeader, Skeleton, Stat, StatusBadge } from '../components/ui'
import type { DashboardAnalytics, DashboardStats, Order } from '../lib/types'

const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d']
const axis = { fontSize: 11, fill: 'var(--muted)' }
const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: 'var(--text)' } }

export default function Dashboard() {
  const { profile } = useAuth()
  if (!profile) return null
  if (profile.role === 'admin') return <AdminHome />
  if (profile.role === 'consumer') return <ConsumerHome />
  return <BusinessHome />
}

function ChartCard({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="card">
      <div className="row between"><h2>{title}</h2>{hint && <span className="muted small">{hint}</span>}</div>
      {children}
    </section>
  )
}

function BusinessHome() {
  const { profile } = useAuth()
  const role = profile!.role
  const uid = profile!.id
  const s = useAsync(() => api.dashboard(), [])
  const a = useAsync(() => api.analytics(), [])
  const o = useAsync(() => api.orders(uid), [uid])
  if (s.loading && !s.data) return <Skeleton rows={8} />
  if (s.error) return <ErrorBox message={s.error} onRetry={s.reload} />
  const d = s.data!
  const an = a.data

  const actions =
    role === 'manufacturer' ? [{ to: '/batches', icon: Factory, label: 'New batch' }, { to: '/medicines', icon: Plus, label: 'Add medicine' }]
    : role === 'distributor' ? [{ to: '/marketplace', icon: ShoppingCart, label: 'Buy stock' }, { to: '/reorder', icon: PackageSearch, label: 'Reorder suggestions' }]
    : [{ to: '/pos', icon: ScanLine, label: 'New bill' }, { to: '/marketplace', icon: ShoppingCart, label: 'Buy stock' }, { to: '/reorder', icon: PackageSearch, label: 'Reorder suggestions' }]

  return (
    <>
      <PageHeader title={`Welcome back, ${(profile!.org_name || profile!.full_name).split(' ')[0]}`} subtitle="Your stock, orders and cash position at a glance"
        actions={actions.map(x => <Link key={x.to} to={x.to} className="btn"><x.icon size={16} /> {x.label}</Link>)} />

      <Attention d={d} an={an} />

      <div className="stats">
        <Stat label="Units in stock" value={num(d.total_units)} hint={`${d.distinct_medicines} medicines`} icon={<Boxes size={18} />} to="/inventory" />
        <Stat label="Stock value" value={money(d.inventory_value)} hint="at your listing prices" icon={<Coins size={18} />} />
        <Stat label="Revenue (30d)" value={money(d.revenue_30d)} tone="good" icon={<Wallet size={18} />} />
        {role === 'manufacturer'
          ? <Stat label="Produced (30d)" value={num(d.produced_30d)} icon={<Factory size={18} />} />
          : <Stat label="Purchases (30d)" value={money(d.spend_30d)} icon={<ShoppingCart size={18} />} />}
        <Stat label="Incoming orders" value={d.incoming_pending} hint="awaiting your response" tone={d.incoming_pending ? 'warn' : undefined} icon={<ClipboardList size={18} />} to="/orders" />
        <Stat label="To ship" value={d.to_ship} hint="accepted / partial" icon={<Truck size={18} />} to="/orders" />
        {role !== 'manufacturer' && <Stat label="Awaiting receipt" value={d.awaiting_receipt} hint="shipped to you" icon={<Clock size={18} />} to="/orders" />}
        {an && <Stat label="Receivable" value={money(an.receivable)} hint={an.overdue_receivable ? `${money(an.overdue_receivable)} overdue` : 'nothing overdue'} tone={an.overdue_receivable ? 'bad' : undefined} icon={<Wallet size={18} />} to="/accounts" />}
        {an && role !== 'manufacturer' && <Stat label="Payable" value={money(an.payable)} hint={an.overdue_payable ? `${money(an.overdue_payable)} overdue` : 'nothing overdue'} tone={an.overdue_payable ? 'warn' : undefined} icon={<Wallet size={18} />} to="/accounts" />}
      </div>

      {a.loading && !an && <Skeleton rows={4} />}
      {an && <Charts an={an} d={d} />}

      <div className="grid-2-1">
        <RecentOrders orders={o.data ?? []} uid={uid} />
        <section className="card">
          <div className="row between"><h2>{role === 'manufacturer' ? 'Top buyers (90d)' : 'Top partners (90d)'}</h2></div>
          {(() => {
            const list = role === 'retailer' ? an?.top_suppliers : role === 'distributor' ? [...(an?.top_buyers ?? []), ...(an?.top_suppliers ?? [])].slice(0, 5) : an?.top_buyers
            return !list || list.length === 0 ? <p className="muted">No completed trade yet.</p> : (
              <ul className="plain">{list.map((x, i) => (
                <li key={x.name + i} className="row between"><span>{i + 1}. {x.name}</span><b>{money(x.total)}</b></li>
              ))}</ul>
            )
          })()}
        </section>
      </div>
    </>
  )
}

function Attention({ d, an }: { d: DashboardStats; an: DashboardAnalytics | null }) {
  const items: { text: string; to: string; tone: 'err' | 'warn' }[] = []
  if (d.recalled) items.push({ text: `${d.recalled} recalled batch(es) in your stock — quarantine them`, to: '/inventory', tone: 'err' })
  if (d.expired) items.push({ text: `${d.expired} expired batch(es) — write them off`, to: '/inventory', tone: 'err' })
  if (an?.overdue_receivable) items.push({ text: `${money(an.overdue_receivable)} of receivables are overdue`, to: '/accounts', tone: 'warn' })
  if (an?.overdue_payable) items.push({ text: `${money(an.overdue_payable)} of payables are overdue`, to: '/accounts', tone: 'warn' })
  if (d.open_returns) items.push({ text: `${d.open_returns} return request(s) waiting for your decision`, to: '/returns', tone: 'warn' })
  if (d.expiring_30d) items.push({ text: `${d.expiring_30d} batch(es) expire within 30 days`, to: '/inventory', tone: 'warn' })
  if (d.low_stock) items.push({ text: `${d.low_stock} medicine(s) below reorder level`, to: '/reorder', tone: 'warn' })
  if (items.length === 0) return null
  return (
    <section className="card attention">
      <h2><AlertTriangle size={18} /> Needs attention</h2>
      <ul className="plain">
        {items.map(i => (
          <li key={i.text} className={`att ${i.tone}`}><span>{i.text}</span><Link to={i.to} className="small">Review <ArrowRight size={12} /></Link></li>
        ))}
      </ul>
    </section>
  )
}

function Charts({ an, d }: { an: DashboardAnalytics; d: DashboardStats }) {
  const sales = an.sales_30d.map(x => ({ day: x.day.slice(5), revenue: Number(x.revenue) }))
  const eb = an.expiry_buckets
  const expiry = [
    { name: 'Expired', units: eb.expired, fill: '#dc2626' }, { name: '≤30d', units: eb.d30, fill: '#d97706' },
    { name: '31–90d', units: eb.d90, fill: '#eab308' }, { name: '91–180d', units: eb.d180, fill: '#2563eb' }, { name: '180d+', units: eb.later, fill: '#0f766e' },
  ]
  const activity = d.activity_14d.map(x => ({ day: x.day.slice(5), In: Number(x.in), Out: Number(x.out) }))
  const hasSales = sales.some(s => s.revenue > 0)
  return (
    <>
      <div className="grid-2-1">
        <ChartCard title="Revenue — last 30 days" hint={money(sales.reduce((s, x) => s + x.revenue, 0))}>
          {hasSales ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={sales} margin={{ left: 0, right: 8, top: 8 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} /><stop offset="100%" stopColor="#0f766e" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={axis} interval={4} /><YAxis tick={axis} width={52} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                <Tooltip {...tip} formatter={v => money(Number(v))} />
                <Area type="monotone" dataKey="revenue" stroke="#0f766e" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty title="No revenue yet" hint="Delivered orders and counter sales show up here." />}
        </ChartCard>
        <ChartCard title="Stock by category">
          {an.stock_by_category.length === 0 ? <Empty title="No stock" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={an.stock_by_category} dataKey="units" nameKey="category" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {an.stock_by_category.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip {...tip} formatter={v => num(Number(v)) + ' units'} /><Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
      <div className="grid3">
        <ChartCard title="Expiry timeline" hint="units">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={expiry}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="name" tick={axis} /><YAxis tick={axis} width={40} />
              <Tooltip {...tip} /><Bar dataKey="units" radius={[4, 4, 0, 0]}>{expiry.map(e => <Cell key={e.name} fill={e.fill} />)}</Bar></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top movers (30d)" hint="units out">
          {an.top_medicines.length === 0 ? <Empty title="No movement yet" /> : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={an.top_medicines} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={90} /><Tooltip {...tip} /><Bar dataKey="units" fill="#2563eb" radius={[0, 4, 4, 0]} /></BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Stock in / out" hint="14 days">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={activity}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" tick={axis} interval={2} /><YAxis tick={axis} width={40} />
              <Tooltip {...tip} /><Bar dataKey="In" fill="#0f766e" radius={[3, 3, 0, 0]} /><Bar dataKey="Out" fill="#d97706" radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  )
}

function RecentOrders({ orders, uid }: { orders: Order[]; uid: string }) {
  const recent = orders.slice(0, 6)
  return (
    <section className="card">
      <div className="row between"><h2>Recent orders</h2><Link to="/orders" className="small">View all <ArrowRight size={12} /></Link></div>
      {recent.length === 0 && <p className="muted">No orders yet.</p>}
      <ul className="plain">
        {recent.map(r => (
          <li key={r.id} className="row between">
            <Link to={`/orders/${r.id}`}><b>{r.order_no}</b></Link>
            <span className="muted grow-txt">{r.seller_id === uid ? 'to ' + (r.buyer?.org_name || r.buyer?.full_name) : 'from ' + r.seller?.org_name}</span>
            <StatusBadge status={r.status} buyerRole={r.buyer?.role} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ConsumerHome() {
  const { profile } = useAuth()
  const o = useAsync(() => api.orders(profile!.id), [profile])
  const open = (o.data ?? []).filter(x => ['pending', 'accepted'].includes(x.status))
  return (
    <>
      <PageHeader title={`Hello, ${(profile!.full_name || 'there').split(' ')[0]}`} subtitle="Find the medicines you need and make sure they are genuine" />
      <div className="cards three">
        <Link to="/find" className="card tile"><span className="feature-icon"><Search size={22} /></span><h3>Find a medicine</h3><p className="muted">See which pharmacies near you have it in stock, compare prices and reserve.</p></Link>
        <Link to="/verify" className="card tile"><span className="feature-icon"><ShieldCheck size={22} /></span><h3>Verify authenticity</h3><p className="muted">Enter the batch number on the pack to see its origin, expiry and recall status.</p></Link>
        <Link to="/orders" className="card tile"><span className="feature-icon"><ClipboardList size={22} /></span><h3>My orders</h3><p className="muted">{open.length ? `${open.length} reservation(s) in progress` : 'Track your reservations.'}</p></Link>
      </div>
      {open.length > 0 && (
        <section className="card"><h2>In progress</h2>
          <ul className="plain">{open.map(r => (
            <li key={r.id} className="row between"><Link to={`/orders/${r.id}`}><b>{r.order_no}</b></Link><span className="muted">{r.seller?.org_name}</span><StatusBadge status={r.status} buyerRole="consumer" /></li>
          ))}</ul>
        </section>
      )}
    </>
  )
}

function AdminHome() {
  const s = useAsync(() => api.adminOverview(), [])
  if (s.loading && !s.data) return <Skeleton rows={6} />
  if (s.error) return <ErrorBox message={s.error} onRetry={s.reload} />
  const d = s.data!
  const series = d.orders_14d.map(x => ({ day: x.day.slice(5), orders: Number(x.orders), value: Number(x.value) }))
  const people = [
    { name: 'Factories', n: d.manufacturers }, { name: 'Dealers', n: d.distributors }, { name: 'Pharmacies', n: d.retailers }, { name: 'Customers', n: d.consumers },
  ]
  return (
    <>
      <PageHeader title="Network overview" subtitle="Whole supply chain at a glance" actions={<Link to="/admin/activity" className="btn">Monitoring <ArrowRight size={16} /></Link>} />
      {(d.unverified > 0 || d.recalled > 0) && (
        <Alert tone="warn">{d.unverified > 0 && <>{d.unverified} business account(s) await verification. <Link to="/admin/users">Review →</Link> </>}{d.recalled > 0 && <>{d.recalled} batch recall(s) active.</>}</Alert>
      )}
      <div className="stats">
        <Stat label="GMV (30d)" value={money(d.gmv_30d)} tone="good" icon={<Coins size={18} />} />
        <Stat label="Outstanding credit" value={money(d.outstanding)} icon={<Wallet size={18} />} />
        <Stat label="Orders (open / all)" value={`${d.open_orders} / ${d.orders}`} icon={<ClipboardList size={18} />} />
        <Stat label="Units in system" value={num(d.units_in_system)} icon={<Boxes size={18} />} />
        <Stat label="Batches (recalled)" value={`${d.batches} (${d.recalled})`} tone={d.recalled ? 'bad' : undefined} icon={<Factory size={18} />} />
        <Stat label="Unverified businesses" value={d.unverified} tone={d.unverified ? 'warn' : undefined} icon={<ShieldCheck size={18} />} to="/admin/users" />
        <Stat label="Suspended accounts" value={d.suspended} icon={<AlertTriangle size={18} />} />
      </div>
      <div className="grid-2-1">
        <ChartCard title="Orders & value — 14 days">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" tick={axis} /><YAxis tick={axis} width={50} />
              <Tooltip {...tip} formatter={(v, n) => (n === 'value' ? money(Number(v)) : v)} /><Area type="monotone" dataKey="value" stroke="#0f766e" fill="#0f766e22" strokeWidth={2} /></AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Participants">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={people} layout="vertical"><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={80} />
              <Tooltip {...tip} /><Bar dataKey="n" fill="#2563eb" radius={[0, 4, 4, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  )
}
