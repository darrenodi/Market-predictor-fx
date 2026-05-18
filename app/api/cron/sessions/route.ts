import { NextRequest, NextResponse } from 'next/server'
import { SESSIONS, SessionKey } from '@/lib/daily-sessions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

// Maps UTC hour → which session event fires at that hour
function sessionEventForHour(h: number): { session: SessionKey; type: 'open' | 'close' } | null {
  for (const [key, cfg] of Object.entries(SESSIONS) as [SessionKey, typeof SESSIONS[SessionKey]][]) {
    if (cfg.openUTC === h)  return { session: key, type: 'open' }
    if (cfg.closeUTC === h) return { session: key, type: 'close' }
  }
  return null
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const h = new Date().getUTCHours()
  const event = sessionEventForHour(h)

  if (!event) {
    return NextResponse.json({ ok: true, skipped: `no session event at UTC ${h}:00` })
  }

  // Forward to the appropriate session-open or session-close route
  const base = new URL(req.url).origin
  const target = `${base}/api/cron/session-${event.type}?session=${event.session}`

  const res = await fetch(target, {
    headers: { authorization: req.headers.get('authorization') ?? '' },
  })

  const body = await res.json()
  return NextResponse.json({ ok: true, event, ...body })
}
