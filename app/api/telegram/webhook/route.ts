import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/telegram'
import { supabase } from '@/lib/supabase'
import { Signal } from '@/types'
import { getInstantSignals } from '@/lib/instant'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function fmt(n: number): string {
  if (n < 1) return n.toFixed(6)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function stars(c: number): string {
  if (c >= 0.8) return '⭐⭐⭐'
  if (c >= 0.6) return '⭐⭐'
  return '⭐'
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

    if (text === '/instant') {
      await sendMessage(chatId, '⚡ <b>Generating instant signals…</b>\nAsking the AI right now — BTC, ETH &amp; Gold.')

      try {
        const { signals, prices } = await getInstantSignals()

        const ASSETS = ['BTC', 'ETH', 'XAU']
        const LABELS: Record<string, string> = { BTC: 'BTC/USD', ETH: 'ETH/USD', XAU: 'XAU/USD' }

        const blocks = ASSETS.map(asset => {
          const sym = LABELS[asset]
          const sig = signals.find(s => s.symbol === sym)
          const price = prices[asset]
          const priceStr = price?.price ? `$${fmt(price.price)}` : ''

          if (!sig) {
            return `<b>${sym}</b>${priceStr ? ` — ${priceStr}` : ''}\n⏸ No clear setup — market too choppy`
          }

          const dir = sig.direction === 'long' ? '📈 LONG' : '📉 SHORT'
          const pct = Math.round(sig.confidence * 100)
          return `${dir} <b>${sym}</b> ${stars(sig.confidence)} ${pct}%\n💰 Entry: $${fmt(sig.market_price)}  🎯 TP: $${fmt(sig.tp)}  🛡 SL: $${fmt(sig.sl)}\n⚡ ${sig.leverage}x | 💼 ${sig.portfolio_pct}%\n<i>${sig.reasoning}</i>`
        })

        const now = new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
        }) + ' GMT+1'

        await sendMessage(
          chatId,
          `⚡ <b>INSTANT SIGNALS — ${now}</b>\n━━━━━━━━━━━━━━━━\n${blocks.join('\n\n')}\n━━━━━━━━━━━━━━━━`
        )
      } catch (err) {
        await sendMessage(chatId, `❌ Failed to generate signals: ${String(err)}`)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Telegram webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}
