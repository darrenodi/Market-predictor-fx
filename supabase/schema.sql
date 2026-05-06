-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── signals ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  symbol        TEXT        NOT NULL,                       -- e.g. 'BTC/USD'
  direction     TEXT        NOT NULL CHECK (direction IN ('long', 'short')),
  leverage      INTEGER     NOT NULL,
  portfolio_pct DECIMAL(5,2) NOT NULL,
  tp            DECIMAL(24,8) NOT NULL,
  sl            DECIMAL(24,8) NOT NULL,
  market_price  DECIMAL(24,8) NOT NULL,
  confidence    DECIMAL(4,3) NOT NULL,
  reasoning     TEXT,
  status        TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'tp_hit', 'sl_hit', 'expired')),
  tp_hit_at     TIMESTAMPTZ,
  sl_hit_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol     ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_status     ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_signals_updated_at ON signals;
CREATE TRIGGER trg_signals_updated_at
  BEFORE UPDATE ON signals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── price_history ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  symbol      TEXT        NOT NULL,
  price       DECIMAL(24,8) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_sym_time
  ON price_history(symbol, recorded_at DESC);

-- Auto-purge rows older than 7 days (keeps table small)
-- Run this manually or as a cron if pg_cron is available:
-- DELETE FROM price_history WHERE recorded_at < NOW() - INTERVAL '7 days';

-- ─── config ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default values
INSERT INTO config (key, value) VALUES
  ('meme_coin',          'DOGE'),
  ('meme_coin_gecko_id', 'dogecoin'),
  ('meme_coin_name',     'Dogecoin')
ON CONFLICT (key) DO NOTHING;

-- ─── RLS (Row Level Security) — read-only for anon users ─────────────────────
ALTER TABLE signals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE config       ENABLE ROW LEVEL SECURITY;

-- Allow public reads (signals are public information)
CREATE POLICY "Public read signals"
  ON signals FOR SELECT USING (true);

CREATE POLICY "Public read price_history"
  ON price_history FOR SELECT USING (true);

CREATE POLICY "Public read config"
  ON config FOR SELECT USING (true);

-- Service role bypasses RLS automatically — no write policies needed for anon.
