import Parser from 'rss-parser'

const parser = new Parser({ timeout: 4000 })

const CRYPTO_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://feeds.coindesk.com/rss/news',
  'https://decrypt.co/feed',
]

const FINANCE_FEEDS = [
  'https://www.kitco.com/rss/metals.rss',
  'https://feeds.marketwatch.com/marketwatch/topstories/',
]

const WHALE_FEEDS = [
  'https://whale-alert.io/rss',
]

const SEARCH_TERMS: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'eth'],
  XAU: ['gold', 'xau', 'precious metal', 'bullion'],
  DOGE: ['dogecoin', 'doge'],
  PEPE: ['pepe', 'meme coin'],
  WIF: ['dogwifhat', 'wif'],
  SHIB: ['shiba', 'shib'],
  BONK: ['bonk'],
  FLOKI: ['floki'],
  SOL: ['solana', 'sol'],
}

interface FeedItem {
  title: string
  description: string
  source: string
}

export interface WhaleAlert {
  title: string
  symbol: string
}

type ParsedFeed = { items: Array<{ title?: string; contentSnippet?: string; pubDate?: string }>; title?: string }

async function fetchFeedWithTimeout(url: string): Promise<ParsedFeed | null> {
  try {
    return await parser.parseURL(url) as ParsedFeed
  } catch {
    return null
  }
}

export async function fetchAllNews(symbols: string[]): Promise<Record<string, FeedItem[]>> {
  const needsFinance = symbols.includes('XAU')
  const allFeeds = [...CRYPTO_FEEDS, ...(needsFinance ? FINANCE_FEEDS : [])]

  // Fetch every feed once in parallel
  const fetched = await Promise.all(allFeeds.map(url => fetchFeedWithTimeout(url)))

  const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000
  const result: Record<string, FeedItem[]> = {}

  for (const symbol of symbols) {
    const terms = SEARCH_TERMS[symbol.toUpperCase()] ?? [symbol.toLowerCase()]
    const feeds = symbol === 'XAU'
      ? fetched.slice(CRYPTO_FEEDS.length)
      : fetched.slice(0, CRYPTO_FEEDS.length)

    const items: FeedItem[] = []
    for (const feed of feeds) {
      if (!feed) continue
      for (const item of feed.items) {
        // Skip articles older than 2 hours if pubDate is available
        if (item.pubDate) {
          const pubTime = new Date(item.pubDate).getTime()
          if (pubTime < TWO_HOURS_AGO) continue
        }
        const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`.toLowerCase()
        if (!terms.some(t => text.includes(t))) continue
        items.push({
          title: item.title ?? '',
          description: (item.contentSnippet ?? '').slice(0, 200),
          source: feed.title ?? '',
        })
        if (items.length >= 4) break
      }
      if (items.length >= 4) break
    }
    result[symbol] = items
  }

  return result
}

export async function fetchWhaleAlerts(limit = 8): Promise<WhaleAlert[]> {
  const feed = await fetchFeedWithTimeout(WHALE_FEEDS[0])
  if (!feed) return []

  const results: WhaleAlert[] = []
  for (const item of feed.items) {
    const title = item.title ?? ''
    if (!title) continue
    const match = title.match(/#([A-Z]{2,6})/)
    results.push({ title, symbol: match ? match[1] : 'UNKNOWN' })
    if (results.length >= limit) break
  }
  return results
}
