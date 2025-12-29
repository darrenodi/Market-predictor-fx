"""
CryptoPanic API scraper implementation
"""
from datetime import datetime, timezone
from typing import List, Dict, Optional
import logging
import requests
from ratelimit import limits, sleep_and_retry

from .config import Config
from .models import NewsArticle

logger = logging.getLogger(__name__)


class CryptoPanicScraper:
    """Scraper for CryptoPanic API"""
    
    BASE_URL = "https://cryptopanic.com/api/v1"
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize CryptoPanic client
        
        Args:
            api_key: CryptoPanic API key, defaults to Config.CRYPTOPANIC_KEY
        """
        self.api_key = api_key or Config.CRYPTOPANIC_KEY
        if not self.api_key:
            raise ValueError("CryptoPanic API key not provided")
        
        self.rate_limit = Config.CRYPTOPANIC_RATE_LIMIT
        self.session = requests.Session()
    
    @sleep_and_retry
    @limits(calls=60, period=60)  # 60 calls per minute (free tier)
    def _rate_limited_request(self, endpoint: str, params: Dict) -> Dict:
        """Rate-limited API request wrapper
        
        Args:
            endpoint: API endpoint (e.g., 'posts')
            params: Query parameters
            
        Returns:
            JSON response as dictionary
        """
        params['auth_token'] = self.api_key
        url = f"{self.BASE_URL}/{endpoint}/"
        
        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"CryptoPanic API request error: {str(e)}")
            return {'results': []}
        except Exception as e:
            logger.error(f"Unexpected error in CryptoPanic request: {str(e)}")
            return {'results': []}
    
    def fetch_posts(self, 
                   currencies: Optional[str] = None,
                   filter_type: str = 'all',
                   kind: str = 'news') -> List[Dict]:
        """Fetch posts from CryptoPanic
        
        Args:
            currencies: Comma-separated list of currency codes (e.g., 'BTC,ETH')
            filter_type: Filter type ('rising', 'hot', 'bullish', 'bearish', 'important', 'saved', 'lol', 'all')
            kind: Post kind ('news' or 'media' or 'all')
            
        Returns:
            List of post dictionaries
        """
        params = {
            'kind': kind,
            'filter': filter_type,
        }
        
        if currencies:
            params['currencies'] = currencies
        
        try:
            data = self._rate_limited_request('posts', params)
            results = data.get('results', [])
            logger.info(f"Fetched {len(results)} posts from CryptoPanic")
            return results
        except Exception as e:
            logger.error(f"Error fetching CryptoPanic posts: {str(e)}")
            return []
    
    def fetch_crypto_news(self, 
                         currencies: Optional[str] = None) -> List[Dict]:
        """Fetch cryptocurrency news
        
        Args:
            currencies: Optional comma-separated list of currency codes
            
        Returns:
            List of news posts
        """
        return self.fetch_posts(
            currencies=currencies or 'BTC,ETH,USDT,BNB,SOL,XRP,ADA,DOGE',
            filter_type='all',
            kind='news'
        )
    
    def fetch_bullish_news(self) -> List[Dict]:
        """Fetch bullish sentiment news"""
        return self.fetch_posts(filter_type='bullish', kind='news')
    
    def fetch_bearish_news(self) -> List[Dict]:
        """Fetch bearish sentiment news"""
        return self.fetch_posts(filter_type='bearish', kind='news')
    
    def fetch_important_news(self) -> List[Dict]:
        """Fetch important/high-impact news"""
        return self.fetch_posts(filter_type='important', kind='news')
    
    def normalize_article(self, post: Dict, category: str = 'crypto') -> NewsArticle:
        """Convert CryptoPanic post to NewsArticle model
        
        Args:
            post: Raw post from CryptoPanic
            category: Category (always 'crypto' for CryptoPanic)
            
        Returns:
            NewsArticle instance
        """
        # Parse published date
        published_at_str = post.get('published_at', post.get('created_at', ''))
        if published_at_str:
            try:
                # CryptoPanic uses ISO format timestamps
                published_at = datetime.fromisoformat(
                    published_at_str.replace('Z', '+00:00')
                )
            except (ValueError, AttributeError):
                published_at = datetime.now(timezone.utc)
        else:
            published_at = datetime.now(timezone.utc)
        
        # Extract currency symbols
        currencies = post.get('currencies', [])
        symbols = ','.join([c.get('code', '') for c in currencies if c.get('code')])
        
        # Determine sentiment from votes if available
        sentiment = None
        votes = post.get('votes', {})
        if votes:
            positive = votes.get('positive', 0)
            negative = votes.get('negative', 0)
            important = votes.get('important', 0)
            liked = votes.get('liked', 0)
            disliked = votes.get('disliked', 0)
            
            # Calculate sentiment score (-1 to 1)
            total_votes = positive + negative + liked + disliked
            if total_votes > 0:
                sentiment = (positive + liked - negative - disliked) / total_votes
        
        return NewsArticle(
            source='cryptopanic',
            headline=post.get('title', ''),
            description=post.get('source', {}).get('title', ''),
            url=post.get('url', ''),
            published_at=published_at,
            scraped_at=datetime.now(timezone.utc),
            category=category,
            symbols=symbols,
            sentiment=sentiment,
        )
    
    def scrape_and_normalize(self, category: str = 'crypto') -> List[NewsArticle]:
        """Scrape news and return normalized NewsArticle objects
        
        Args:
            category: Category to scrape (always 'crypto' for CryptoPanic)
            
        Returns:
            List of NewsArticle objects
        """
        articles = []
        
        # Fetch different types of news
        logger.info("Fetching general crypto news from CryptoPanic...")
        raw_posts = self.fetch_crypto_news()
        
        # Optionally fetch important news separately
        logger.info("Fetching important crypto news from CryptoPanic...")
        important_posts = self.fetch_important_news()
        
        # Combine and deduplicate by URL
        seen_urls = set()
        all_posts = raw_posts + important_posts
        
        for post in all_posts:
            try:
                url = post.get('url', '')
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                
                normalized = self.normalize_article(post, category)
                articles.append(normalized)
            except Exception as e:
                logger.error(f"Error normalizing CryptoPanic post: {str(e)}")
                continue
        
        logger.info(f"Normalized {len(articles)} articles from CryptoPanic")
        return articles
