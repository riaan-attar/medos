import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import Suspended from './auth/Suspended'
import { ToastProvider } from './components/Toast'
import { Skeleton } from './components/ui'
import Layout from './components/Layout'
import { isConfigured } from './lib/supabase'
import type { Permission, Role } from './lib/types'
import Setup from './pages/Setup'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Landing from './pages/Landing'

// heavier / less-visited screens are code-split (recharts lives in Dashboard)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Marketplace = lazy(() => import('./pages/Marketplace'))
const Medicines = lazy(() => import('./pages/Medicines'))
const Batches = lazy(() => import('./pages/Batches'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Orders = lazy(() => import('./pages/Orders'))
const OrderDetail = lazy(() => import('./pages/OrderDetail'))
const Returns = lazy(() => import('./pages/Returns'))
const Partners = lazy(() => import('./pages/Partners'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Ledger = lazy(() => import('./pages/Ledger'))
const Reorder = lazy(() => import('./pages/Reorder'))
const POS = lazy(() => import('./pages/POS'))
const Sales = lazy(() => import('./pages/Sales'))
const Customers = lazy(() => import('./pages/Customers'))
const FindMedicine = lazy(() => import('./pages/FindMedicine'))
const PharmacyPage = lazy(() => import('./pages/PharmacyPage'))
const Favorites = lazy(() => import('./pages/Favorites'))
const Verify = lazy(() => import('./pages/Verify'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Settings = lazy(() => import('./pages/Settings'))
const AdminUsers = lazy(() => import('./pages/AdminUsers'))
const Reports = lazy(() => import('./pages/Reports'))
const Legal = lazy(() => import('./pages/Legal'))
const H1Register = lazy(() => import('./pages/H1Register'))
const AdminActivity = lazy(() => import('./pages/AdminActivity'))

// "/" shows the marketing page to visitors and the app shell to signed-in users
function Gate() {
  const { session, profile, suspended, loading } = useAuth()
  const { pathname } = useLocation()
  if (loading) return <div className="center-screen"><Skeleton rows={4} /></div>
  if (!session) return pathname === '/' ? <Landing /> : <Navigate to="/login" replace />
  if (!profile) return <div className="center-screen"><div className="card">Your profile could not be loaded. Did you run both SQL migrations?</div></div>
  if (suspended) return <Suspended />
  return <Layout />
}

function Only({ roles, perm, children }: { roles: Role[]; perm?: Permission; children: React.ReactNode }) {
  const { profile, can } = useAuth()
  if (!profile || !roles.includes(profile.role) || (perm && !can(perm))) return <Navigate to="/" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="center-screen"><Skeleton rows={3} /></div>
  return session ? <Navigate to="/" replace /> : <>{children}</>
}

function OrderFrom() {
  const { sellerId } = useParams()
  return <Marketplace presetSeller={sellerId} />
}

const BUYERS: Role[] = ['distributor', 'retailer']
const STOCKISTS: Role[] = ['manufacturer', 'distributor', 'retailer']
const BUSINESS: Role[] = STOCKISTS
const SELLERS_TO_BIZ: Role[] = ['manufacturer', 'distributor']

export default function App() {
  if (!isConfigured) return <Setup />
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<div className="center-screen"><Skeleton rows={4} /></div>}>
            <Routes>
              <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
              <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
              <Route path="/check/:batchNo?" element={<Verify standalone />} />
              <Route path="/legal/:doc?" element={<Legal />} />
              <Route path="/" element={<Gate />}>
                <Route index element={<Dashboard />} />
                <Route path="medicines" element={<Only perm="catalog" roles={['manufacturer']}><Medicines /></Only>} />
                <Route path="batches" element={<Only perm="batches" roles={['manufacturer']}><Batches /></Only>} />
                <Route path="inventory" element={<Only roles={STOCKISTS}><Inventory /></Only>} />
                <Route path="marketplace" element={<Only perm="orders_manage" roles={BUYERS}><Marketplace /></Only>} />
                <Route path="reorder" element={<Only perm="orders_manage" roles={BUYERS}><Reorder /></Only>} />
                <Route path="pos" element={<Only perm="sell" roles={['retailer']}><POS /></Only>} />
                <Route path="sales" element={<Only perm="sell" roles={['retailer']}><Sales /></Only>} />
                <Route path="h1-register" element={<Only perm="sell" roles={['retailer']}><H1Register /></Only>} />
                <Route path="customers" element={<Only perm="customers" roles={['retailer']}><Customers /></Only>} />
                <Route path="find" element={<Only roles={['consumer']}><FindMedicine /></Only>} />
                <Route path="favorites" element={<Only roles={['consumer']}><Favorites /></Only>} />
                <Route path="pharmacy/:id" element={<PharmacyPage />} />
                <Route path="orders/new/:sellerId" element={<Only roles={['consumer']}><OrderFrom /></Only>} />
                <Route path="orders" element={<Orders />} />
                <Route path="orders/:id" element={<OrderDetail />} />
                <Route path="returns" element={<Only perm="returns" roles={BUSINESS}><Returns /></Only>} />
                <Route path="partners" element={<Only perm="partners" roles={SELLERS_TO_BIZ}><Partners /></Only>} />
                <Route path="accounts" element={<Only perm="payments" roles={BUSINESS}><Accounts /></Only>} />
                <Route path="reports" element={<Only perm="reports" roles={BUSINESS}><Reports /></Only>} />
                <Route path="ledger" element={<Only perm="stock_adjust" roles={STOCKISTS}><Ledger /></Only>} />
                <Route path="verify/:batchNo?" element={<Verify />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="settings" element={<Settings />} />
                <Route path="profile" element={<Navigate to="/settings" replace />} />
                <Route path="admin/users" element={<Only roles={['admin']}><AdminUsers /></Only>} />
                <Route path="admin/activity" element={<Only roles={['admin']}><AdminActivity /></Only>} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
