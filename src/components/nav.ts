import {
  BarChart3, BookOpen, Boxes, Building2, ClipboardList, CreditCard, FileText, Factory, Home, LayoutDashboard, Pill,
  Receipt, RotateCcw, Search, ScanLine, Settings, ShieldCheck, ShoppingCart, Truck, Users, Wallet, Activity, PackageSearch,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '../lib/types'

export interface NavItem { to: string; label: string; icon: LucideIcon; section: string }

export const NAV: Record<Role, NavItem[]> = {
  manufacturer: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
    { to: '/medicines', label: 'Medicine catalog', icon: Pill, section: 'Production' },
    { to: '/batches', label: 'Batches & recalls', icon: Factory, section: 'Production' },
    { to: '/inventory', label: 'Inventory', icon: Boxes, section: 'Production' },
    { to: '/orders', label: 'Orders', icon: ClipboardList, section: 'Trade' },
    { to: '/returns', label: 'Returns', icon: RotateCcw, section: 'Trade' },
    { to: '/partners', label: 'Buyers & credit', icon: Users, section: 'Trade' },
    { to: '/accounts', label: 'Accounts', icon: Wallet, section: 'Finance' },
    { to: '/ledger', label: 'Stock ledger', icon: BookOpen, section: 'Finance' },
    { to: '/verify', label: 'Verify batch', icon: ShieldCheck, section: 'Tools' },
  ],
  distributor: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
    { to: '/marketplace', label: 'Buy from factories', icon: ShoppingCart, section: 'Buy' },
    { to: '/reorder', label: 'Reorder suggestions', icon: PackageSearch, section: 'Buy' },
    { to: '/inventory', label: 'Inventory', icon: Boxes, section: 'Stock' },
    { to: '/orders', label: 'Orders', icon: ClipboardList, section: 'Trade' },
    { to: '/returns', label: 'Returns', icon: RotateCcw, section: 'Trade' },
    { to: '/partners', label: 'Retailers & credit', icon: Users, section: 'Trade' },
    { to: '/accounts', label: 'Accounts', icon: Wallet, section: 'Finance' },
    { to: '/ledger', label: 'Stock ledger', icon: BookOpen, section: 'Finance' },
    { to: '/verify', label: 'Verify batch', icon: ShieldCheck, section: 'Tools' },
  ],
  retailer: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
    { to: '/pos', label: 'Point of sale', icon: ScanLine, section: 'Sell' },
    { to: '/sales', label: 'Sales & bills', icon: Receipt, section: 'Sell' },
    { to: '/customers', label: 'Customers', icon: Users, section: 'Sell' },
    { to: '/marketplace', label: 'Buy stock', icon: ShoppingCart, section: 'Buy' },
    { to: '/reorder', label: 'Reorder suggestions', icon: PackageSearch, section: 'Buy' },
    { to: '/inventory', label: 'Inventory', icon: Boxes, section: 'Stock' },
    { to: '/orders', label: 'Orders', icon: ClipboardList, section: 'Trade' },
    { to: '/returns', label: 'Returns', icon: RotateCcw, section: 'Trade' },
    { to: '/accounts', label: 'Accounts', icon: Wallet, section: 'Finance' },
    { to: '/ledger', label: 'Stock ledger', icon: BookOpen, section: 'Finance' },
    { to: '/verify', label: 'Verify batch', icon: ShieldCheck, section: 'Tools' },
  ],
  consumer: [
    { to: '/', label: 'Home', icon: Home, section: 'Overview' },
    { to: '/find', label: 'Find medicine', icon: Search, section: 'Shop' },
    { to: '/orders', label: 'My orders', icon: ClipboardList, section: 'Shop' },
    { to: '/favorites', label: 'Saved pharmacies', icon: Building2, section: 'Shop' },
    { to: '/verify', label: 'Verify medicine', icon: ShieldCheck, section: 'Tools' },
  ],
  admin: [
    { to: '/', label: 'Overview', icon: BarChart3, section: 'Platform' },
    { to: '/admin/users', label: 'Accounts', icon: Users, section: 'Platform' },
    { to: '/admin/activity', label: 'Monitoring', icon: Activity, section: 'Platform' },
    { to: '/verify', label: 'Verify batch', icon: ShieldCheck, section: 'Tools' },
  ],
}

// extra command-palette destinations
export const EXTRA: Record<string, { to: string; label: string; icon: LucideIcon }> = {
  settings: { to: '/settings', label: 'Settings', icon: Settings },
  notifications: { to: '/notifications', label: 'Notifications', icon: FileText },
  shipping: { to: '/orders', label: 'Orders', icon: Truck },
  payments: { to: '/accounts', label: 'Payments', icon: CreditCard },
}
