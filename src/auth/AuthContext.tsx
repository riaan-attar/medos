import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import type { Profile, Role } from '../lib/types'

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
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    }).catch(() => setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (!s) { setProfile(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    api.profile(uid)
      .then(p => { if (!cancelled) setProfile(p) })
      .catch(() => { if (!cancelled) setProfile(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [uid])

  const refreshProfile = useCallback(async () => {
    if (uid) setProfile(await api.profile(uid))
  }, [uid])

  const value = useMemo<AuthState>(() => ({
    session, profile, loading, refreshProfile,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    async signUp({ email, password, ...meta }) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: meta } })
      if (error) throw error
      return { needsConfirmation: !data.session }
    },
    async signOut() { await supabase.auth.signOut() },
  }), [session, profile, loading, refreshProfile])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
