import { Signal } from '@/types'
import { GeneratedSignal } from './signals'

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

export async function sendMessage(chatId: string, text: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return

  await fetch(`${BASE()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  const res = await fetch(`${BASE()}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  })
  if (!res.ok) throw new Error(`setWebhook failed: ${res.status}`)
}

function confidenceStars(c: number): string {
  if (c >= 0.8) return '⭐⭐⭐'
  if (c >= 0.6) return '⭐⭐'
  return '⭐'
}

function fmt(n: number): string {
  if (n < 1) return n.toFixed(6)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function nowGMT(): string {
  return new Date().toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

export function formatNewSignal(s: GeneratedSignal): string {
  const emoji = s.direction === 'long' ? '📈' : '📉'
  const dir = s.direction.toUpperCase()
  const pct = Math.round(s.confidence * 100)

  return `🎯 <b>NEW SIGNAL — ${s.symbol}</b>
━━━━━━━━━━━━━━━━
${emoji} <b>Direction:</b> ${dir}
⚡ <b>Leverage:</b> ${s.leverage}x
💼 <b>Portfolio:</b> ${s.portfolio_pct}%
🎯 <b>Take Profit:</b> $${fmt(s.tp)}
🛡 <b>Stop Loss:</b> $${fmt(s.sl)}
💰 <b>Entry Price:</b> $${fmt(s.market_price)}
📊 <b>Confidence:</b> ${pct}% ${confidenceStars(s.confidence)}
📰 <b>Analysis:</b> ${s.reasoning}
━━━━━━━━━━━━━━━━
🕐 ${nowGMT()}`
}

export function formatTPHit(s: Signal): string {
  const pct = s.direction === 'long'
    ? ((s.tp - s.market_price) / s.market_price) * 100
    : ((s.market_price - s.tp) / s.market_price) * 100
  const lev = pct * s.leverage

  return `✅ <b>TP HIT! — ${s.symbol}</b>
━━━━━━━━━━━━━━━━
Take Profit of <b>$${fmt(s.tp)}</b> reached!
Entry: $${fmt(s.market_price)}
Gain: +${pct.toFixed(2)}% (+${lev.toFixed(1)}% with ${s.leverage}x)
━━━━━━━━━━━━━━━━
🕐 ${nowGMT()}`
}

export function formatSLHit(s: Signal): string {
  const pct = s.direction === 'long'
    ? ((s.market_price - s.sl) / s.market_price) * 100
    : ((s.sl - s.market_price) / s.market_price) * 100
  const lev = pct * s.leverage

  return `❌ <b>SL HIT — ${s.symbol}</b>
━━━━━━━━━━━━━━━━
Stop Loss of <b>$${fmt(s.sl)}</b> triggered
Entry: $${fmt(s.market_price)}
Loss: -${pct.toFixed(2)}% (-${lev.toFixed(1)}% with ${s.leverage}x)
━━━━━━━━━━━━━━━━
🕐 ${nowGMT()}`
}

export async function notifyNewSignal(signal: GeneratedSignal): Promise<void> {
  const groupId = process.env.TELEGRAM_GROUP_ID
  if (!groupId || signal.confidence < 0.55) return
  await sendMessage(groupId, formatNewSignal(signal))
}
