# 🚀 Moduvise: AI-Powered Market Predictor

**Moduvise** is a high-performance financial intelligence platform hosted at **moduvise.com**. It leverages Machine Learning (ML) and Natural Language Processing (NLP) to analyze global news and predict directional price movement (Increase/Decrease) for **Stocks, Crypto, and Forex (FX)**.

> **Disclaimer:** Moduvise is a **Decision-Support Tool**, not an automated trading bot. It provides directional bias and historical probability to assist in manual trade execution on **cTrader** and **MetaTrader 5 (MT5)**.

---

## 🎯 Project Goal
The primary objective of Moduvise is to eliminate "emotional trading" by quantifying the impact of news. Instead of guessing how the market will react, Moduvise matches current headlines against 7+ years of historical data to forecast if an asset is likely to **Increase** or **Decrease** in value.

---

## 🧠 How It Works

### 1. News Sentiment Analysis (NLP)
Using **FinBERT** (a specialized Financial BERT model), Moduvise reads thousands of real-time headlines and assigns a sentiment score. It understands financial nuances like "Hawkish" vs. "Dovish" that standard AI might miss.

### 2. Historical Impact Correlation
The system maintains a database of past news events paired with 1-minute (M1) and 5-minute (M5) price data.
- **The Logic:** If "X news" happened in the past, did the price go UP or DOWN?
- **The Output:** A probability percentage (e.g., *"75% historical probability of an INCREASE within 30 minutes"*).

### 3. Manual Execution Workflow
1. **Check Moduvise:** View the live dashboard for a high-confidence signal.
2. **Review Bias:** See if the AI predicts an **Increase** or **Decrease**.
3. **Manual Trade:** Switch to **cTrader/MT5** and execute the trade based on the AI’s suggested risk parameters.

---

## 🛠️ Technical Stack

- **Frontend:** Next.js, Tailwind CSS, Lucide React (Icons).
- **Backend:** FastAPI (Python), Uvicorn.
- **ML/AI:** PyTorch (FinBERT), XGBoost (Classification), Scikit-learn.
- **Data APIs:** Finnhub, NewsAPI, yfinance, Binance API.

---

## 📂 Project Structure

```text
├── api/                # FastAPI backend and prediction routes
├── data_engine/        # Scripts for scraping news and price data
├── models/             # ML model training and saved weights
│   ├── sentiment_analyzer.py
│   └── impact_classifier.py
├── frontend/           # Next.js web dashboard (moduvise.com)
├── scripts/            # Utility scripts for data cleaning
└── requirements.txt    # Python dependencies
