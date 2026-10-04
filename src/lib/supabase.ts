import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anon)

// Falls back to placeholders so the app can render a setup screen instead of crashing.
export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'missing-anon-key')
