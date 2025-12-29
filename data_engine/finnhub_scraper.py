"""
Finnhub API scraper implementation
"""
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
import logging
from ratelimit import limits, sleep_and_retry
import finnhub

from .config import Config
from .models import NewsArticle

logger = logging.getLogger(__name__)


class FinnhubScraper:
    """Scraper for Finnhub API"""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize Finnhub client
        
        Args:
            api_key: Finnhub API key, defaults to Config.FINNHUB_KEY
        """
        self.api_key = api_key or Config.FINNHUB_KEY
        if not self.api_key:
            raise ValueError("Finnhub API key not provided")
        
        self.client = finnhub.Client(api_key=self.api_key)
        self.rate_limit = Config.FINNHUB_RATE_LIMIT
    
    @sleep_and_retry
    @limits(calls=60, period=60)  # 60 calls per minute
    def _rate_limited_request(self, method, *args, **kwargs):
        """Rate-limited API request wrapper"""
        try:
            return method(*args, **kwargs)
        except Exception as e:
            logger.error(f"Finnhub API error: {str(e)}")
            return []
    
    def fetch_market_news(self, category: str = 'general') -> List[Dict]:
        """Fetch general market news
        
        Args:
            category: News category (general, forex, crypto, merger)
            
        Returns:
            List of news articles
        """
        try:
            news = self._rate_limited_request(
                self.client.general_news,
                category
            )
            logger.info(f"Fetched {len(news)} articles from Finnhub (category: {category})")
            return news
        except Exception as e:
            logger.error(f"Error fetching market news: {str(e)}")
            return []
    
    def fetch_company_news(self, symbol: str, 
                          from_date: Optional[datetime] = None,
                          to_date: Optional[datetime] = None) -> List[Dict]:
        """Fetch company-specific news
        
        Args:
            symbol: Stock symbol (e.g., 'AAPL', 'TSLA')
            from_date: Start date (defaults to 7 days ago)
            to_date: End date (defaults to now)
            
        Returns:
            List of news articles
        """
        if from_date is None:
            from_date = datetime.now(timezone.utc) - timedelta(days=7)
        if to_date is None:
            to_date = datetime.now(timezone.utc)
        
        try:
            news = self._rate_limited_request(
                self.client.company_news,
                symbol,
                _from=from_date.strftime('%Y-%m-%d'),
                to=to_date.strftime('%Y-%m-%d')
            )
            logger.info(f"Fetched {len(news)} articles for {symbol} from Finnhub")
            return news
        except Exception as e:
            logger.error(f"Error fetching company news for {symbol}: {str(e)}")
            return []
    
    def fetch_crypto_news(self) -> List[Dict]:
        """Fetch cryptocurrency news"""
        return self.fetch_market_news(category='crypto')
    
    def fetch_forex_news(self) -> List[Dict]:
        """Fetch forex news"""
        return self.fetch_market_news(category='forex')
    
    def fetch_all_symbols_news(self, symbols: List[str]) -> List[Dict]:
        """Fetch news for multiple symbols
        
        Args:
            symbols: List of stock symbols
            
        Returns:
            Combined list of news articles
        """
        all_news = []
        for symbol in symbols:
            news = self.fetch_company_news(symbol)
            all_news.extend(news)
        
        return all_news
    
    def normalize_article(self, article: Dict, category: str = 'general',
                         symbol: str = '') -> NewsArticle:
        """Convert Finnhub article to NewsArticle model
        
        Args:
            article: Raw article from Finnhub
            category: Category (stocks, crypto, forex)
            symbol: Related symbol if applicable
            
        Returns:
            NewsArticle instance
        """
        # Convert Unix timestamp to datetime
        published_at = datetime.fromtimestamp(article.get('datetime', 0), tz=timezone.utc)
        
        return NewsArticle(
            source='finnhub',
            headline=article.get('headline', ''),
            description=article.get('summary', ''),
            url=article.get('url', ''),
            published_at=published_at,
            scraped_at=datetime.now(timezone.utc),
            category=category,
            symbols=symbol,
        )
    
    def scrape_and_normalize(self, category: str = 'general') -> List[NewsArticle]:
        """Scrape news and return normalized NewsArticle objects
        
        Args:
            category: Category to scrape (general, stocks, crypto, forex)
            
        Returns:
            List of NewsArticle objects
        """
        articles = []
        raw_articles = []
        
        if category == 'crypto':
            raw_articles = self.fetch_crypto_news()
        elif category == 'forex':
            raw_articles = self.fetch_forex_news()
        elif category == 'stocks':
            # Fetch news for configured stock symbols
            raw_articles = self.fetch_all_symbols_news(Config.STOCK_SYMBOLS)
        else:
            raw_articles = self.fetch_market_news(category='general')
        
        for article in raw_articles:
            try:
                symbol = article.get('related', '')
                normalized = self.normalize_article(article, category, symbol)
                articles.append(normalized)
            except Exception as e:
                logger.error(f"Error normalizing article: {str(e)}")
                continue
        
        logger.info(f"Normalized {len(articles)} articles from Finnhub")
        return articles
