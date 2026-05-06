import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/telegram'
import { supabase } from '@/lib/supabase'
import { Signal } from '@/types'

export const dynamic = 'force-dynamic'

function fmt(n: number): string {
  if (n < 1) return n.toFixed(6)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message = body?.message
    if (!message?.text) return NextResponse.json({ ok: true })

    const chatId = String(message.chat.id)
    const text: string = message.text.toLowerCase().trim()

    if (text === '/start' || text === '/signals') {
      const { data: signals } = await supabase
        .from('signals')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(4)

      if (!signals?.length) {
        await sendMessage(chatId, '📊 No active signals right now. Check back soon!')
        return NextResponse.json({ ok: true })
      }

      const lines = (signals as Signal[]).map(s => {
        const dir = s.direction === 'long' ? '📈 LONG' : '📉 SHORT'
        return `<b>${s.symbol}</b> — ${dir}\n💰 Entry: $${fmt(s.market_price)}\n🎯 TP: $${fmt(s.tp)}\n🛡 SL: $${fmt(s.sl)}\n⚡ ${s.leverage}x | ${s.portfolio_pct}% portfolio`
      })

      await sendMessage(chatId, lines.join('\n\n'))
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Telegram webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}
