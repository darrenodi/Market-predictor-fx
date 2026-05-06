import Parser from 'rss-parser'

const parser = new Parser({ timeout: 8000 })

// Free RSS feeds — no API keys required
const CRYPTO_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://feeds.coindesk.com/rss/news',
  'https://decrypt.co/feed',
  'https://cryptonews.com/news/feed/',
]

const FINANCE_FEEDS = [
  'https://feeds.marketwatch.com/marketwatch/topstories/',
  'https://www.kitco.com/rss/metals.rss',
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

async function parseFeed(url: string): Promise<Parser.Output<Record<string, unknown>>> {
  return parser.parseURL(url)
}

export async function fetchNewsForSymbol(symbol: string, limit = 5): Promise<FeedItem[]> {
  const terms = SEARCH_TERMS[symbol.toUpperCase()] ?? [symbol.toLowerCase()]
  const feeds = symbol === 'XAU' ? FINANCE_FEEDS : CRYPTO_FEEDS
  const results: FeedItem[] = []

  const settled = await Promise.allSettled(feeds.map(url => parseFeed(url)))

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    const feed = result.value

    for (const item of feed.items ?? []) {
      const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`.toLowerCase()
      if (!terms.some(t => text.includes(t))) continue

      results.push({
        title: item.title ?? '',
        description: (item.contentSnippet ?? '').slice(0, 250),
        source: feed.title ?? '',
      })

      if (results.length >= limit) break
    }

    if (results.length >= limit) break
  }

  return results
}

export async function fetchAllNews(
  symbols: string[],
): Promise<Record<string, FeedItem[]>> {
  const entries = await Promise.allSettled(
    symbols.map(async s => [s, await fetchNewsForSymbol(s)] as const),
  )

  return Object.fromEntries(
    entries
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<readonly [string, FeedItem[]]>).value),
  )
}
