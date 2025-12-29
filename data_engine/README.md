# Data Engine - News Scraper

This module provides real-time news scraping from NewsAPI and Finnhub APIs for financial market analysis.

## Features

- ✅ Connect to NewsAPI and Finnhub APIs
- ✅ Parse and normalize headline data
- ✅ Store in database with timestamps
- ✅ Handle API rate limits gracefully
- ✅ Support for stocks, crypto, and forex categories

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure API keys by creating a `.env` file:
```bash
cp .env.example .env
# Edit .env and add your API keys
```

3. Get API keys:
   - NewsAPI: https://newsapi.org/register
   - Finnhub: https://finnhub.io/register

## Usage

### Command Line

Run the scraper directly:
```bash
python -m data_engine.scraper
```

### Programmatic Usage

```python
from data_engine.scraper import NewsScraper
from data_engine.models import init_db

# Initialize database
init_db()

# Create scraper instance
scraper = NewsScraper()

# Scrape all news
stats = scraper.scrape_all()

# Scrape specific categories
stats = scraper.scrape_stocks()
stats = scraper.scrape_crypto()
stats = scraper.scrape_forex()

# Get recent articles
articles = scraper.get_recent_articles(limit=50, category='crypto')

# Close when done
scraper.close()
```

## Database Schema

The `news_articles` table stores:
- `id`: Primary key
- `source`: 'newsapi' or 'finnhub'
- `headline`: Article title
- `description`: Article description/summary
- `url`: Article URL
- `published_at`: Publication timestamp
- `scraped_at`: When the article was scraped
- `category`: stocks/crypto/forex/general
- `symbols`: Related ticker symbols
- `sentiment`: Optional sentiment score

## Rate Limiting

The scrapers implement rate limiting to respect API quotas:
- NewsAPI: 100 requests/minute (configurable)
- Finnhub: 60 requests/minute (configurable)

Rate limits are handled automatically with exponential backoff.

## Configuration

All configuration is managed through environment variables in `.env`:

```env
NEWS_API_KEY=your_key_here
FINNHUB_KEY=your_key_here
DATABASE_URL=sqlite:///./market_predictor.db
NEWSAPI_RATE_LIMIT=100
FINNHUB_RATE_LIMIT=60
SCRAPER_INTERVAL_MINUTES=15
```

## Architecture

```
data_engine/
├── __init__.py          # Package initialization
├── config.py            # Configuration management
├── models.py            # Database models (SQLAlchemy)
├── newsapi_scraper.py   # NewsAPI integration
├── finnhub_scraper.py   # Finnhub integration
└── scraper.py           # Main orchestrator
```

## Error Handling

- API errors are logged and don't crash the scraper
- Duplicate articles are automatically detected and skipped
- Database integrity is maintained with proper error handling
- Rate limit exceeded errors trigger automatic retry with backoff
