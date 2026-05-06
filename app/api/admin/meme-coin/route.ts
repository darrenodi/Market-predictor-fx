import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const COINS: Record<string, { geckoId: string; name: string }> = {
  DOGE: { geckoId: 'dogecoin', name: 'Dogecoin' },
  PEPE: { geckoId: 'pepe', name: 'Pepe' },
  WIF: { geckoId: 'dogwifcoin', name: 'dogwifhat' },
  SHIB: { geckoId: 'shiba-inu', name: 'Shiba Inu' },
  BONK: { geckoId: 'bonk', name: 'Bonk' },
  FLOKI: { geckoId: 'floki', name: 'FLOKI' },
  SOL: { geckoId: 'solana', name: 'Solana' },
  TRUMP: { geckoId: 'maga', name: 'TRUMP' },
}

export async function GET() {
  const { data } = await supabaseAdmin
    .from('config')
    .select('value')
    .eq('key', 'meme_coin')
    .single()

  return NextResponse.json({
    current: data?.value ?? 'DOGE',
    available: Object.keys(COINS),
  })
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { symbol } = await req.json()
  const coin = COINS[String(symbol).toUpperCase()]
  if (!coin) {
    return NextResponse.json(
      { error: `Unknown coin. Available: ${Object.keys(COINS).join(', ')}` },
      { status: 400 },
    )
  }

  await supabaseAdmin.from('config').upsert([
    { key: 'meme_coin', value: symbol.toUpperCase() },
    { key: 'meme_coin_gecko_id', value: coin.geckoId },
    { key: 'meme_coin_name', value: coin.name },
  ])

  return NextResponse.json({ ok: true, coin })
}
