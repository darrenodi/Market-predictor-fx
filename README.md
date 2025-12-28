# 🚀 Moduvise: AI-Powered Financial Market Predictor
**Official Domain:** [moduvise.com](https://moduvise.com)

Moduvise is a high-frequency sentiment correlation engine built with Python and Next.js. It leverages Machine Learning (ML) and Natural Language Processing (NLP) to predict directional price movement (**Increase/Decrease**) for Stocks, Crypto, and Forex (FX) by analyzing the historical impact of news events.

---

## 🎯 Project Objective
The goal is to eliminate emotional bias in trading by quantifying news impact. Moduvise does not place trades automatically; it provides a statistical "Bias" to assist traders in manual execution on **cTrader** and **MetaTrader 5 (MT5)**.

### Key Targets:
- **Directional Accuracy:** Target >70% probability on high-impact news events.
- **Assets:** Gold ($XAUUSD$), Bitcoin ($BTC$), S&P 500 ($SPX$), and Major FX Pairs (EUR/USD, GBP/USD).
- **Risk Management:** Intelligent lot size calculation for $1,000 accounts to ensure long-term sustainability.

---

## 🧠 System Architecture

### 1. Data Ingestion (The "Eyes")
- **News Scraper:** Real-time ingestion from NewsAPI, Finnhub, and CryptoPanic.
- **Price Engine:** Historical M1/M5 price data via YFinance and Binance API.
- **Historical Correlation:** Logic to map specific headlines to price deltas at $T+5$, $T+30$, and $T+60$ minutes.

### 2. Machine Learning Pipeline (The "Brain")
- **Sentiment Engine:** Uses **FinBERT** (Financial BERT) to classify headlines as Hawkish, Dovish, Bullish, or Bearish.
- **Inference Model:** An **XGBoost Classifier** trained on 7+ years of historical event-impact pairs.
- **Prediction Logic:** Classification output: `1` (Increase), `-1` (Decrease), or `0` (Neutral/Stable).

### 3. Trader Dashboard (The "Interface")
- **Directional Bias:** Instant INCREASE/DECREASE visual indicators.
- **Confidence Score:** Percentage-based certainty based on historical model backtesting.
- **Historical Context:** UI component showing how the market reacted to the last 5 similar news events.

---

## 📂 Repository Structure
```text
├── api/                # FastAPI backend & ML inference routes
├── data_engine/        # Python scrapers for news and price data
├── models/             # ML training scripts (FinBERT + XGBoost)
├── frontend/           # Next.js web dashboard (moduvise.com)
├── scripts/            # Data cleaning and impact-labeling utilities
└── requirements.txt    # Project dependencies

```

---

## 🛠️ Setup & Installation

### 1. Clone & Environment

```bash
git clone [https://github.com/your-username/Market-predictor.git](https://github.com/your-username/Market-predictor.git)
cd Market-predictor
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

```

### 2. Configure API Keys (.env)

Create a `.env` file in the root:

```env
NEWS_API_KEY=your_newsapi_key
FINNHUB_KEY=your_finnhub_key
BINANCE_SECRET=your_binance_secret

```

### 3. Launching

* **Backend:** `uvicorn api.main:app --reload`
* **Frontend:** `cd frontend && npm run dev`

---

## 📈 Manual Trading Workflow (cTrader / MT5)

1. **Analyze:** Open Moduvise.com to check for a high-confidence (>75%) directional signal.
2. **Verify:** Confirm the AI bias matches the current technical trend (Price Action/Structure).
3. **Execute:** Manually open the trade on **cTrader** or **MT5**.
4. **Safety:** Follow the Moduvise lot-size recommendation (e.g., 0.01 - 0.05 lots for a $1,000 account) based on current ATR/Volatility.

---

## ⚠️ Risk Disclaimer

Trading financial markets involves significant risk of loss. Moduvise is a statistical tool; it does not guarantee profit. Past performance as analyzed by ML is not indicative of future results. **Always use a Stop Loss and trade responsibly.**

---

*Built for the next generation of data-driven traders.*

```

```
