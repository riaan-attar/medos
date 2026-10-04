import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun, SunMoon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { roleLabel } from '../lib/format'
import { useTheme } from '../lib/theme'
import { Avatar } from './ui'
import { NAV } from './nav'
import CommandPalette from './CommandPalette'
import TermsGate from './TermsGate'
import NotificationBell from './NotificationBell'

export default function Layout() {
  const { profile, userProfile, isStaff, memberRole, can, signOut } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const { theme, set } = useTheme()
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setOpen(false) }, [loc.pathname])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    if (!menu) return
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menu])

  const sections = useMemo(() => {
    if (!profile) return []
    const m = new Map<string, typeof NAV.admin>()
    for (const i of NAV[profile.role].filter(n => !n.perm || can(n.perm))) m.set(i.section, [...(m.get(i.section) ?? []), i])
    return [...m.entries()]
  }, [profile, can])

  if (!profile) return null
  const name = profile.org_name || profile.full_name || 'Account'
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/" className="brand"><span className="logo">✚</span> MedOS</Link>
        <nav>
          {sections.map(([section, items]) => (
            <div key={section} className="nav-section">
              <div className="nav-title">{section}</div>
              {items.map(i => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <i.icon size={18} />{i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Avatar name={name} />
          <div className="who">
            <strong>{name}</strong>
            <small>{isStaff ? `${memberRole} · ${userProfile?.full_name ?? ''}` : roleLabel[profile.role]}{profile.verified && !isStaff && ' · verified'}</small>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu" onClick={() => setOpen(o => !o)} aria-label="Menu"><Menu size={20} /></button>
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <Search size={16} /><span>Search pages & orders…</span><kbd>⌘K</kbd>
          </button>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => set(nextTheme)} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`}><ThemeIcon size={19} /></button>
          <NotificationBell />
          <div className="popover-wrap" ref={menuRef}>
            <button className="user-btn" onClick={() => setMenu(m => !m)}>
              <Avatar name={name} size={30} /><span className="user-name">{name}</span><ChevronDown size={14} />
            </button>
            {menu && (
              <div className="popover small-pop">
                <div className="popover-head"><div><strong>{name}</strong><div className="muted small">{roleLabel[profile.role]}</div></div></div>
                <button className="menu-item" onClick={() => { setMenu(false); nav('/settings') }}><Settings size={16} /> Settings</button>
                <button className="menu-item" onClick={async () => { await signOut(); nav('/login') }}><LogOut size={16} /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <TermsGate />
    </div>
  )
}
