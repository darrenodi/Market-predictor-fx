"""
Example usage of the news scraper

This script demonstrates how to use the scraper to fetch and store news.
"""
from data_engine.scraper import NewsScraper
from data_engine.models import init_db
from data_engine.config import Config
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def example_basic_usage():
    """Example: Basic scraping from all sources"""
    print("\n=== Example 1: Basic Usage ===\n")
    
    # Initialize database
    init_db()
    
    # Create scraper instance
    scraper = NewsScraper()
    
    # Scrape all news
    stats = scraper.scrape_all()
    
    print(f"Scraped {stats['newsapi']['saved']} articles from NewsAPI")
    print(f"Scraped {stats['finnhub']['saved']} articles from Finnhub")
    
    scraper.close()


def example_category_specific():
    """Example: Scraping specific categories"""
    print("\n=== Example 2: Category-Specific Scraping ===\n")
    
    init_db()
    scraper = NewsScraper()
    
    # Scrape only crypto news
    print("Scraping cryptocurrency news...")
    stats = scraper.scrape_crypto()
    print(f"Crypto articles saved: {stats['newsapi']['saved'] + stats['finnhub']['saved']}")
    
    # Scrape only forex news
    print("\nScraping forex news...")
    stats = scraper.scrape_forex()
    print(f"Forex articles saved: {stats['newsapi']['saved'] + stats['finnhub']['saved']}")
    
    scraper.close()


def example_retrieve_articles():
    """Example: Retrieving stored articles"""
    print("\n=== Example 3: Retrieving Articles ===\n")
    
    init_db()
    scraper = NewsScraper()
    
    # Get recent articles
    articles = scraper.get_recent_articles(limit=10)
    
    print(f"Found {len(articles)} recent articles:\n")
    for i, article in enumerate(articles, 1):
        print(f"{i}. [{article.source}] {article.headline[:70]}...")
        print(f"   Published: {article.published_at}")
        print(f"   Category: {article.category}")
        print(f"   URL: {article.url[:60]}...")
        print()
    
    scraper.close()


def example_crypto_only():
    """Example: Get only crypto articles"""
    print("\n=== Example 4: Crypto Articles Only ===\n")
    
    init_db()
    scraper = NewsScraper()
    
    # Get crypto articles
    articles = scraper.get_recent_articles(limit=5, category='crypto')
    
    print(f"Found {len(articles)} crypto articles:\n")
    for article in articles:
        print(f"• {article.headline}")
        print(f"  Source: {article.source} | Published: {article.published_at}")
        if article.symbols:
            print(f"  Symbols: {article.symbols}")
        if article.sentiment is not None:
            print(f"  Sentiment: {article.sentiment:.2f}")
        print()
    
    scraper.close()


def example_cryptopanic_sentiment():
    """Example: CryptoPanic with sentiment analysis"""
    print("\n=== Example 5: CryptoPanic Sentiment Analysis ===\n")
    
    init_db()
    scraper = NewsScraper()
    
    # Scrape crypto news
    print("Scraping crypto news with sentiment...")
    stats = scraper.scrape_crypto()
    print(f"Total crypto articles: {stats['newsapi']['saved'] + stats['finnhub']['saved'] + stats['cryptopanic']['saved']}")
    
    # Get articles with sentiment scores (from CryptoPanic)
    articles = scraper.get_recent_articles(limit=10, category='crypto')
    
    print(f"\nRecent crypto articles with sentiment:\n")
    for article in articles:
        if article.source == 'cryptopanic' and article.sentiment is not None:
            sentiment_str = "Bullish" if article.sentiment > 0 else "Bearish" if article.sentiment < 0 else "Neutral"
            print(f"• {article.headline[:70]}...")
            print(f"  Sentiment: {sentiment_str} ({article.sentiment:.2f})")
            print(f"  Symbols: {article.symbols}")
            print()
    
    scraper.close()


def main():
    """Run all examples"""
    try:
        # Check if API keys are configured
        print("Checking configuration...")
        try:
            Config.validate()
            print("✓ Configuration OK\n")
        except ValueError as e:
            print(f"✗ Configuration Error: {e}")
            print("\nPlease configure your API keys in .env file:")
            print("1. Copy .env.example to .env")
            print("2. Add your NEWS_API_KEY and FINNHUB_KEY")
            return
        
        # Run examples
        print("="*70)
        print("NEWS SCRAPER EXAMPLES")
        print("="*70)
        
        # Note: In a real scenario, you'd run these one at a time
        # For demo, we'll just show how to use each function
        
        print("\n[Choose which example to run]")
        print("1. Basic usage - scrape all news")
        print("2. Category-specific scraping")
        print("3. Retrieve stored articles")
        print("4. Get crypto articles only")
        print("5. CryptoPanic sentiment analysis")
        print("\nFor this demo, we'll run example 3 (retrieve articles)")
        print("To run others, call the corresponding function.\n")
        
        # Example of basic usage (commented out to avoid hitting API limits)
        # example_basic_usage()
        
        # Show retrieval example (safe to run even with empty DB)
        example_retrieve_articles()
        
        print("="*70)
        print("Examples complete!")
        print("="*70)
        
    except Exception as e:
        logger.error(f"Error running examples: {e}", exc_info=True)


if __name__ == '__main__':
    main()
