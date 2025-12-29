"""
NewsAPI scraper implementation
"""
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
import logging
from ratelimit import limits, sleep_and_retry
from newsapi import NewsApiClient
from newsapi.newsapi_exception import NewsAPIException

from .config import Config
from .models import NewsArticle

logger = logging.getLogger(__name__)


class NewsAPIScraper:
    """Scraper for NewsAPI.org"""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize NewsAPI client
        
        Args:
            api_key: NewsAPI key, defaults to Config.NEWS_API_KEY
        """
        self.api_key = api_key or Config.NEWS_API_KEY
        if not self.api_key:
            raise ValueError("NewsAPI key not provided")
        
        self.client = NewsApiClient(api_key=self.api_key)
        self.rate_limit = Config.NEWSAPI_RATE_LIMIT
    
    @sleep_and_retry
    @limits(calls=100, period=60)  # 100 calls per minute
    def _rate_limited_request(self, method, **kwargs):
        """Rate-limited API request wrapper"""
        return method(**kwargs)
    
    def fetch_financial_news(self, 
                            query: str = 'financial OR market OR stock OR crypto OR forex',
                            from_date: Optional[datetime] = None,
                            language: str = 'en') -> List[Dict]:
        """Fetch financial news articles
        
        Args:
            query: Search query for articles
            from_date: Start date for articles (defaults to 24 hours ago)
            language: Language of articles
            
        Returns:
            List of article dictionaries
        """
        if from_date is None:
            from_date = datetime.now(timezone.utc) - timedelta(hours=24)
        
        try:
            response = self._rate_limited_request(
                self.client.get_everything,
                q=query,
                from_param=from_date.strftime('%Y-%m-%d'),
                language=language,
                sort_by='publishedAt',
                page_size=100
            )
            
            if response['status'] == 'ok':
                logger.info(f"Fetched {len(response['articles'])} articles from NewsAPI")
                return response['articles']
            else:
                logger.error(f"NewsAPI error: {response.get('message', 'Unknown error')}")
                return []
                
        except NewsAPIException as e:
            logger.error(f"NewsAPI exception: {str(e)}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error fetching from NewsAPI: {str(e)}")
            return []
    
    def fetch_crypto_news(self, from_date: Optional[datetime] = None) -> List[Dict]:
        """Fetch cryptocurrency news"""
        return self.fetch_financial_news(
            query='cryptocurrency OR bitcoin OR ethereum OR crypto OR blockchain',
            from_date=from_date
        )
    
    def fetch_forex_news(self, from_date: Optional[datetime] = None) -> List[Dict]:
        """Fetch forex news"""
        return self.fetch_financial_news(
            query='forex OR currency OR EUR OR USD OR gold OR XAUUSD',
            from_date=from_date
        )
    
    def normalize_article(self, article: Dict, category: str = 'general') -> NewsArticle:
        """Convert NewsAPI article to NewsArticle model
        
        Args:
            article: Raw article from NewsAPI
            category: Category (stocks, crypto, forex)
            
        Returns:
            NewsArticle instance
        """
        # Parse published date
        published_at = datetime.fromisoformat(
            article['publishedAt'].replace('Z', '+00:00')
        )
        
        return NewsArticle(
            source='newsapi',
            headline=article.get('title', ''),
            description=article.get('description', ''),
            url=article.get('url', ''),
            published_at=published_at,
            scraped_at=datetime.now(timezone.utc),
            category=category,
            symbols='',  # NewsAPI doesn't provide symbols directly
        )
    
    def scrape_and_normalize(self, category: str = 'general') -> List[NewsArticle]:
        """Scrape news and return normalized NewsArticle objects
        
        Args:
            category: Category to scrape (general, crypto, forex)
            
        Returns:
            List of NewsArticle objects
        """
        articles = []
        
        if category == 'crypto':
            raw_articles = self.fetch_crypto_news()
        elif category == 'forex':
            raw_articles = self.fetch_forex_news()
        else:
            raw_articles = self.fetch_financial_news()
        
        for article in raw_articles:
            try:
                normalized = self.normalize_article(article, category)
                articles.append(normalized)
            except Exception as e:
                logger.error(f"Error normalizing article: {str(e)}")
                continue
        
        logger.info(f"Normalized {len(articles)} articles from NewsAPI")
        return articles
