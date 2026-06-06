# MEXC Futures Bot — Setup Guide

## Files

| File | Location in ModuVise | Purpose |
|---|---|---|
| mexc-bot.js | /pages/api/bot.js | Core bot — executes trades |
| bot-scheduler.js | /pages/api/bot-scheduler.js | Auto-scheduler with trend detection |
| vercel.json | /vercel.json | Cron job config |
| .env.local | /.env.local | API keys |

---

## Step 1 — Add Environment Variables

In Vercel dashboard → Settings → Environment Variables, add:

```
MEXC_ACCESS_KEY     = your access key from MEXC API Management
MEXC_SECRET_KEY     = your secret key from MEXC API Management
BOT_SECRET          = darren2026xau  (any random string you choose)
NEXT_PUBLIC_BOT_URL = https://moduvise.com/api/bot
```

---

## Step 2 — Add Files To ModuVise

Copy files to:
- `mexc-bot.js` → `/pages/api/bot.js`
- `bot-scheduler.js` → `/pages/api/bot-scheduler.js`
- `vercel.json` → `/vercel.json` (root of project)

---

## Step 3 — Configure Your Strategy

In mexc-bot.js, edit the CONFIG object at the top:

```javascript
SYMBOL: 'XAUT_USDT',      // Gold. Change to 'BTC_USDT' or 'ETH_USDT'
LEVERAGE: 100,             // Start with 100x
TP_ROE_PERCENT: 9.9,       // Take profit at 9.9% ROE
SL_THRESHOLD_BALANCE: 100, // Enable stop loss when balance > $100
SL_ROE_ACTIVE: 18.5,       // Stop loss at 18.5% ROE when active
MAX_TRADES_PER_DAY: 10,    // Maximum trades per day
```

---

## Step 4 — Deploy To Vercel

```bash
git add .
git commit -m "Add MEXC trading bot"
git push
```

Vercel auto-deploys. Cron activates immediately.

---

## Step 5 — Test Manually First

Before letting it run automatically, test each endpoint:

### Check Status
```bash
curl https://moduvise.com/api/bot?action=status \
  -H "x-bot-secret: darren2026xau"
```

Expected response:
```json
{
  "success": true,
  "balance": 9.00,
  "price": 4503.5,
  "symbol": "XAUT_USDT",
  "leverage": 100,
  "hasOpenPosition": false
}
```

### Place Manual Trade (LONG)
```bash
curl -X POST https://moduvise.com/api/bot \
  -H "Content-Type: application/json" \
  -H "x-bot-secret: darren2026xau" \
  -d '{"action": "trade", "direction": "LONG"}'
```

### Place Manual Trade (SHORT)
```bash
curl -X POST https://moduvise.com/api/bot \
  -H "Content-Type: application/json" \
  -H "x-bot-secret: darren2026xau" \
  -d '{"action": "trade", "direction": "SHORT"}'
```

### Change Symbol On The Fly
```bash
curl -X POST https://moduvise.com/api/bot \
  -H "Content-Type: application/json" \
  -H "x-bot-secret: darren2026xau" \
  -d '{"action": "config", "symbol": "BTC_USDT", "leverage": 100}'
```

### Trigger Scheduler Manually
```bash
curl https://moduvise.com/api/bot-scheduler \
  -H "x-bot-secret: darren2026xau"
```

---

## How The Bot Works

### Trade Flow
```
Scheduler fires (every 6 mins, 8am-6pm UTC weekdays)
  ↓
Check daily trade count < 10
  ↓
Check no open position
  ↓
Check balance > $1
  ↓
Fetch last 3 one-minute candles
  ↓
Detect trend:
  - 3 green candles → LONG
  - 3 red candles → SHORT
  - Mixed → SKIP
  ↓
Place limit order at current price +/- 0.002%
  ↓
Set TP at 9.9% ROE
  ↓
Set SL at 18.5% ROE (only if balance > $100)
  ↓
Wait for TP hit → full balance + profit available
  ↓
Next scheduler cycle opens new trade with compounded balance
```

### Fee Structure (API trades)
| Order Type | Fee |
|---|---|
| Maker (limit) | 0.08% |
| Taker (market) | 0.081% |

Bot uses limit orders on entry. TP closes as limit (maker). Total round trip: ~0.16%.

### Minimum Profitable Move At $9 Balance, 100x
- Position: $900
- Round trip fees: $900 × 0.16% = $1.44
- Net per trade at 9.9% ROE: ~$0.17
- Daily at 10 trades: ~$1.70 = 18.9% daily

---

## Adding Bot Controls To ModuVise Dashboard

Add these buttons to your existing ModuVise UI:

```jsx
// In your Dashboard component

const [botStatus, setBotStatus] = useState(null);

const checkStatus = async () => {
  const res = await fetch('/api/bot?action=status', {
    headers: { 'x-bot-secret': process.env.NEXT_PUBLIC_BOT_SECRET }
  });
  const data = await res.json();
  setBotStatus(data);
};

const trade = async (direction) => {
  const res = await fetch('/api/bot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bot-secret': process.env.NEXT_PUBLIC_BOT_SECRET
    },
    body: JSON.stringify({ action: 'trade', direction })
  });
  const data = await res.json();
  console.log(data);
};

// JSX
<button onClick={checkStatus}>Check Status</button>
<button onClick={() => trade('LONG')}>Manual LONG</button>
<button onClick={() => trade('SHORT')}>Manual SHORT</button>
{botStatus && (
  <div>
    Balance: ${botStatus.balance?.toFixed(4)}
    Price: ${botStatus.price}
    Position open: {botStatus.hasOpenPosition ? 'YES' : 'NO'}
  </div>
)}
```

---

## Important Notes

1. **API fees are 0.08% maker** — not 0.01% web rate. This is built into all calculations.

2. **MEXC clause 5.2** — bot trading may trigger risk flags again. If account gets flagged, switch SYMBOL to BTC_USDT or ETH_USDT and reduce trade frequency.

3. **No SL until $100** — bot holds through dips below $100 balance. Above $100 it auto-enables 18.5% ROE stop loss.

4. **Cron schedule** — `*/6 8-18 * * 1-5` fires every 6 minutes, 8am-6pm UTC, Monday-Friday. This targets London and New York sessions when Gold moves most actively.

5. **One position at a time** — bot checks for open position before every trade. Will not stack positions.

6. **Vercel cron requires Pro plan** — free plan only allows daily crons. Upgrade to Pro ($20/month) for 6-minute intervals, or call the scheduler endpoint manually from ModuVise dashboard.

---

## Troubleshooting

| Error | Fix |
|---|---|
| 401 Unauthorized | Check BOT_SECRET matches in .env and request header |
| Balance fetch failed | Check MEXC_ACCESS_KEY and MEXC_SECRET_KEY are correct |
| Order placement failed | Check KYC is complete on MEXC, futures trading enabled |
| Signature error | Check system clock is synced, Request-Time within 10 seconds |
| Position too small | Increase balance or reduce leverage |
