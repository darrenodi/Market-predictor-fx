"""
Main scraper orchestrator
Coordinates NewsAPI and Finnhub scrapers with database storage
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .models import NewsArticle, get_session, init_db
from .newsapi_scraper import NewsAPIScraper
from .finnhub_scraper import FinnhubScraper
from .cryptopanic_scraper import CryptoPanicScraper
from .config import Config

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class NewsScraper:
    """Main news scraper orchestrator"""
    
    def __init__(self, newsapi_key: Optional[str] = None, 
                 finnhub_key: Optional[str] = None,
                 cryptopanic_key: Optional[str] = None,
                 db_session: Optional[Session] = None):
        """Initialize scrapers
        
        Args:
            newsapi_key: NewsAPI key (optional, uses Config if not provided)
            finnhub_key: Finnhub key (optional, uses Config if not provided)
            cryptopanic_key: CryptoPanic key (optional, uses Config if not provided)
            db_session: Database session (optional, creates new if not provided)
        """
        self.newsapi_scraper = NewsAPIScraper(api_key=newsapi_key)
        self.finnhub_scraper = FinnhubScraper(api_key=finnhub_key)
        self.cryptopanic_scraper = CryptoPanicScraper(api_key=cryptopanic_key)
        self.session = db_session or get_session()
        
    def save_articles(self, articles: List[NewsArticle]) -> int:
        """Save articles to database with batched commits
        
        Args:
            articles: List of NewsArticle objects
            
        Returns:
            Number of articles successfully saved
        """
        saved_count = 0
        batch_size = 100  # Commit every 100 articles for better performance
        
        for i, article in enumerate(articles):
            try:
                # Check if article already exists (by URL and published date)
                existing = self.session.query(NewsArticle).filter_by(
                    url=article.url,
                    published_at=article.published_at
                ).first()
                
                if existing:
                    logger.debug(f"Article already exists: {article.headline[:50]}...")
                    continue
                
                self.session.add(article)
                saved_count += 1
                
                # Commit in batches for better performance
                if (i + 1) % batch_size == 0:
                    self.session.commit()
                    
            except IntegrityError as e:
                self.session.rollback()
                logger.warning(f"Integrity error saving article: {str(e)}")
            except Exception as e:
                self.session.rollback()
                logger.error(f"Error saving article: {str(e)}")
        
        # Final commit for remaining articles
        try:
            self.session.commit()
        except Exception as e:
            self.session.rollback()
            logger.error(f"Error in final commit: {str(e)}")
        
        logger.info(f"Saved {saved_count} new articles to database")
        return saved_count
    
    def scrape_all(self, categories: Optional[List[str]] = None) -> dict:
        """Scrape news from all sources and categories
        
        Args:
            categories: List of categories to scrape (stocks, crypto, forex, general)
                       Defaults to all categories
                       
        Returns:
            Dictionary with scraping statistics
        """
        if categories is None:
            categories = ['general', 'stocks', 'crypto', 'forex']
        
        stats = {
            'newsapi': {'total': 0, 'saved': 0},
            'finnhub': {'total': 0, 'saved': 0},
            'cryptopanic': {'total': 0, 'saved': 0},
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        logger.info("=== Starting news scraping cycle ===")
        
        # Scrape from NewsAPI
        for category in ['general', 'crypto', 'forex']:
            if category in categories:
                try:
                    articles = self.newsapi_scraper.scrape_and_normalize(category)
                    stats['newsapi']['total'] += len(articles)
                    saved = self.save_articles(articles)
                    stats['newsapi']['saved'] += saved
                except Exception as e:
                    logger.error(f"Error scraping NewsAPI ({category}): {str(e)}")
        
        # Scrape from Finnhub
        for category in categories:
            try:
                articles = self.finnhub_scraper.scrape_and_normalize(category)
                stats['finnhub']['total'] += len(articles)
                saved = self.save_articles(articles)
                stats['finnhub']['saved'] += saved
            except Exception as e:
                logger.error(f"Error scraping Finnhub ({category}): {str(e)}")
        
        # Scrape from CryptoPanic (crypto only)
        if 'crypto' in categories:
            try:
                articles = self.cryptopanic_scraper.scrape_and_normalize('crypto')
                stats['cryptopanic']['total'] += len(articles)
                saved = self.save_articles(articles)
                stats['cryptopanic']['saved'] += saved
            except Exception as e:
                logger.error(f"Error scraping CryptoPanic: {str(e)}")
        
        logger.info(f"=== Scraping cycle complete ===")
        logger.info(f"NewsAPI: {stats['newsapi']['saved']}/{stats['newsapi']['total']} saved")
        logger.info(f"Finnhub: {stats['finnhub']['saved']}/{stats['finnhub']['total']} saved")
        logger.info(f"CryptoPanic: {stats['cryptopanic']['saved']}/{stats['cryptopanic']['total']} saved")
        
        return stats
    
    def scrape_stocks(self) -> dict:
        """Scrape stock-related news only"""
        return self.scrape_all(categories=['stocks', 'general'])
    
    def scrape_crypto(self) -> dict:
        """Scrape cryptocurrency news only"""
        return self.scrape_all(categories=['crypto'])
    
    def scrape_forex(self) -> dict:
        """Scrape forex news only"""
        return self.scrape_all(categories=['forex'])
    
    def get_recent_articles(self, limit: int = 100, 
                          category: Optional[str] = None) -> List[NewsArticle]:
        """Retrieve recent articles from database
        
        Args:
            limit: Maximum number of articles to return
            category: Optional category filter
            
        Returns:
            List of NewsArticle objects
        """
        query = self.session.query(NewsArticle).order_by(
            NewsArticle.published_at.desc()
        )
        
        if category:
            query = query.filter_by(category=category)
        
        return query.limit(limit).all()
    
    def close(self):
        """Close database session"""
        if self.session:
            self.session.close()


def main():
    """Main entry point for scraper"""
    try:
        # Validate configuration
        Config.validate()
        
        # Initialize database
        logger.info("Initializing database...")
        init_db()
        
        # Create scraper and run
        logger.info("Starting news scraper...")
        scraper = NewsScraper()
        
        # Scrape all categories
        stats = scraper.scrape_all()
        
        # Print summary
        print("\n" + "="*60)
        print("SCRAPING SUMMARY")
        print("="*60)
        print(f"Timestamp: {stats['timestamp']}")
        print(f"\nNewsAPI:")
        print(f"  Total fetched: {stats['newsapi']['total']}")
        print(f"  Saved to DB: {stats['newsapi']['saved']}")
        print(f"\nFinnhub:")
        print(f"  Total fetched: {stats['finnhub']['total']}")
        print(f"  Saved to DB: {stats['finnhub']['saved']}")
        print(f"\nCryptoPanic:")
        print(f"  Total fetched: {stats['cryptopanic']['total']}")
        print(f"  Saved to DB: {stats['cryptopanic']['saved']}")
        print("="*60)
        
        # Close scraper
        scraper.close()
        
    except ValueError as e:
        logger.error(f"Configuration error: {str(e)}")
        logger.error("Please set NEWS_API_KEY, FINNHUB_KEY, and CRYPTOPANIC_KEY in your .env file")
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)


if __name__ == '__main__':
    main()
