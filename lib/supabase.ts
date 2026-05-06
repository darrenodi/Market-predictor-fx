import { createClient } from '@supabase/supabase-js'

// Fallback to placeholder strings at build time so the module can be imported
// without env vars. Actual calls will fail gracefully if env vars are missing at runtime.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key'

// Client for browser / public reads
export const supabase = createClient(url, anonKey)

// Admin client for server-side writes (cron jobs, webhooks)
export const supabaseAdmin = createClient(url, serviceKey)
