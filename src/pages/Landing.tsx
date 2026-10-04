import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, BarChart3, Boxes, ClipboardList, Factory, FileCheck2, QrCode, RotateCcw, Search, ShieldCheck, ShoppingBag, Store, Truck, Warehouse,
} from 'lucide-react'

const ROLES = [
  { id: 'manufacturer', icon: Factory, title: 'Factories', text: 'Register batches with QR labels, sell to dealers, run recalls in one click.' },
  { id: 'distributor', icon: Warehouse, title: 'Dealers & wholesalers', text: 'Buy from factories, supply retailers on credit, track receivables.' },
  { id: 'retailer', icon: Store, title: 'Pharmacies', text: 'Bill customers fast, auto-pick earliest expiry, never run out of stock.' },
  { id: 'consumer', icon: ShoppingBag, title: 'Customers', text: 'Find a medicine nearby, reserve it, and verify it is genuine.' },
]

const FEATURES = [
  { icon: Boxes, title: 'Batch-level inventory', text: 'Every unit tracked by batch and expiry, with FEFO picking and low-stock alerts.' },
  { icon: Truck, title: 'Orders that match reality', text: 'Stock reservation, partial shipments, delivery ETAs and returns with credit notes.' },
  { icon: FileCheck2, title: 'GST invoices & payments', text: 'Auto invoices, credit limits, buyer discounts and payment tracking.' },
  { icon: ShieldCheck, title: 'Recalls & verification', text: 'Public batch check with full chain of custody. Recall reaches every holder instantly.' },
  { icon: BarChart3, title: 'Live analytics', text: 'Sales trends, expiry timeline, top movers and receivables on one dashboard.' },
  { icon: RotateCcw, title: 'Reorder suggestions', text: 'Smart purchase suggestions from the cheapest eligible supplier.' },
]

export default function Landing() {
  const nav = useNavigate()
  const [batch, setBatch] = useState('')
  function check(e: FormEvent) { e.preventDefault(); if (batch.trim()) nav(`/check/${encodeURIComponent(batch.trim())}`) }

  return (
    <div className="landing">
      <header className="land-nav">
        <div className="brand"><span className="logo">✚</span> MedOS</div>
        <div className="row gap">
          <Link to="/check" className="btn ghost sm">Verify a batch</Link>
          <Link to="/login" className="btn ghost sm">Sign in</Link>
          <Link to="/signup" className="btn primary sm">Get started</Link>
        </div>
      </header>

      <section className="hero">
        <span className="pill">Medicine supply chain platform</span>
        <h1>Track every medicine, from factory to pharmacy shelf.</h1>
        <p>One platform for manufacturers, dealers, retailers and customers — inventory, orders, invoices and authenticity checks in real time.</p>
        <div className="row gap center-row wrap">
          <Link to="/signup" className="btn primary lg">Create free account <ArrowRight size={18} /></Link>
          <Link to="/login" className="btn lg">Sign in</Link>
        </div>
        <form className="hero-verify" onSubmit={check}>
          <QrCode size={20} />
          <input value={batch} onChange={e => setBatch(e.target.value)} placeholder="Check a medicine — enter the batch number on the pack" />
          <button className="btn primary">Verify</button>
        </form>
      </section>

      <section className="land-section">
        <h2>Built for every link in the chain</h2>
        <div className="cards four">
          {ROLES.map(r => (
            <Link key={r.id} to={`/signup?role=${r.id}`} className="card tile">
              <span className="feature-icon"><r.icon size={22} /></span>
              <h3>{r.title}</h3><p className="muted">{r.text}</p>
              <span className="row gap small link-ish">Join as {r.title.toLowerCase()} <ArrowRight size={14} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="land-section alt">
        <h2>How it works</h2>
        <ol className="chain-flow">
          <li><Factory size={22} /><b>Factory</b><span>Registers a batch</span></li>
          <li className="arrow"><ArrowRight /></li>
          <li><Warehouse size={22} /><b>Dealer</b><span>Orders &amp; receives</span></li>
          <li className="arrow"><ArrowRight /></li>
          <li><Store size={22} /><b>Pharmacy</b><span>Stocks &amp; sells</span></li>
          <li className="arrow"><ArrowRight /></li>
          <li><Search size={22} /><b>Customer</b><span>Finds &amp; verifies</span></li>
        </ol>
      </section>

      <section className="land-section">
        <h2>Everything an MVP supply chain needs</h2>
        <div className="cards three">
          {FEATURES.map(f => (
            <div key={f.title} className="card">
              <span className="feature-icon"><f.icon size={22} /></span>
              <h3>{f.title}</h3><p className="muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta">
        <ClipboardList size={28} />
        <h2>Ready to see your whole inventory in one place?</h2>
        <Link to="/signup" className="btn lg light-btn">Get started <ArrowRight size={18} /></Link>
      </section>
      <footer className="land-foot muted small">© MedOS · Always verify medicines before use. · <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/refunds">Refunds</Link></footer>
    </div>
  )
}
