import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import type { MemberRole, Permission, Profile, Role } from '../lib/types'

interface SignUpInput {
  email: string
  password: string
  role: Exclude<Role, 'admin'>
  full_name: string
  org_name: string
  phone: string
  city: string
  address: string
  license_no: string
  invite_code?: string
}

interface AuthState {
  session: Session | null
  /** The BUSINESS the user acts for (for staff this is their employer's profile). */
  profile: Profile | null
  /** The signed-in person's own profile. */
  userProfile: Profile | null
  orgId: string | null
  memberRole: MemberRole
  isStaff: boolean
  suspended: boolean
  loading: boolean
  can: (p: Permission) => boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

interface Loaded { org: Profile; user: Profile; memberRole: MemberRole; isStaff: boolean; perms: Permission[] }

async function load(uid: string): Promise<Loaded> {
  const [user, ctx] = await Promise.all([api.profile(uid), api.context()])
  const org = ctx.org_id === uid ? user : await api.profile(ctx.org_id)
  return { org, user, memberRole: ctx.member_role, isStaff: ctx.is_staff, perms: ctx.permissions }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session)
      if (!d.session) setLoading(false)
    }).catch(() => setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (!s) { setData(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    load(uid)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [uid])

  const refreshProfile = useCallback(async () => {
    if (uid) setData(await load(uid))
  }, [uid])

  const value = useMemo<AuthState>(() => ({
    session, loading, refreshProfile,
    profile: data?.org ?? null,
    userProfile: data?.user ?? null,
    orgId: data?.org.id ?? null,
    memberRole: data?.memberRole ?? 'owner',
    isStaff: data?.isStaff ?? false,
    suspended: !!data && (data.user.status === 'suspended' || data.org.status === 'suspended'),
    can: (p: Permission) => !!data && data.perms.includes(p),
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    async signUp({ email, password, ...meta }) {
      const { data: d, error } = await supabase.auth.signUp({ email, password, options: { data: meta } })
      if (error) throw error
      return { needsConfirmation: !d.session }
    },
    async signOut() { await supabase.auth.signOut() },
  }), [session, data, loading, refreshProfile])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
