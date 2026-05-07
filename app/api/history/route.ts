import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .in('status', ['tp_hit', 'sl_hit', 'expired'])
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ signals: data ?? [] })
}
