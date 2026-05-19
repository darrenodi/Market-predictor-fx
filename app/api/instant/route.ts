import { NextResponse } from 'next/server'
import { getInstantSignals } from '@/lib/instant'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const result = await getInstantSignals()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[instant] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
