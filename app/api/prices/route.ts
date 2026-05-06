import { NextResponse } from 'next/server'
import { fetchAllPrices, fetchSparklineHistory } from '@/lib/prices'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Get active meme coin from config
    const { data: config } = await supabase.from('config').select('key, value')
    const configMap = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
    const memeCoin: string = configMap.meme_coin ?? 'DOGE'

    const symbols = ['BTC', 'ETH', 'XAU', memeCoin]

    // Fetch current prices (CoinGecko, cached 60s server-side)
    const currentPrices = await fetchAllPrices(memeCoin)

    // Fetch sparkline history from DB first (builds up over time as cron runs)
    const { data: dbHistory } = await supabase
      .from('price_history')
      .select('symbol, price, recorded_at')
      .in('symbol', symbols.map(s => (s === 'XAU' ? 'XAU/USD' : `${s}/USD`)))
      .gte('recorded_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('recorded_at', { ascending: true })

    // Group DB history by base symbol
    const dbBySymbol: Record<string, number[]> = {}
    for (const row of dbHistory ?? []) {
      const base = row.symbol.replace('/USD', '')
      ;(dbBySymbol[base] ??= []).push(Number(row.price))
    }

    // For symbols with no DB history yet, fall back to CoinGecko sparkline (cached 5 min)
    const sparklines: Record<string, number[]> = {}
    await Promise.allSettled(
      symbols.map(async s => {
        if ((dbBySymbol[s]?.length ?? 0) >= 4) {
          sparklines[s] = dbBySymbol[s]
        } else {
          sparklines[s] = await fetchSparklineHistory(s)
        }
      }),
    )

    // Combine into final response
    const prices: Record<string, { price: number; change_24h: number; history: number[] }> = {}
    for (const s of symbols) {
      if (!currentPrices[s]) continue
      prices[s] = {
        price: currentPrices[s].price,
        change_24h: currentPrices[s].change_24h,
        history: sparklines[s] ?? [],
      }
    }

    return NextResponse.json({ prices, meme_coin: memeCoin })
  } catch (err) {
    console.error('/api/prices error:', err)
    return NextResponse.json({ prices: {}, meme_coin: 'DOGE' }, { status: 500 })
  }
}
