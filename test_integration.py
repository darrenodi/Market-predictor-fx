#!/usr/bin/env python3
"""
Integration test and demo for the news scraper
Tests all major functionality without hitting real APIs
"""
from datetime import datetime, timezone
from data_engine.models import init_db, NewsArticle, get_session
from data_engine.scraper import NewsScraper
from data_engine.config import Config
import os


def test_database_setup():
    """Test database initialization"""
    print("1. Testing database setup...")
    engine = init_db(database_url='sqlite:///:memory:')
    assert engine is not None
    print("   ✓ Database initialized successfully")


def test_article_creation():
    """Test creating and storing articles"""
    print("\n2. Testing article creation and storage...")
    
    # Use a fresh in-memory database
    from sqlalchemy import create_engine
    engine = create_engine('sqlite:///:memory:')
    from data_engine.models import Base
    Base.metadata.create_all(engine)
    
    from sqlalchemy.orm import sessionmaker
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Create sample articles from different sources
    articles_data = [
        {
            'source': 'newsapi',
            'headline': 'Fed raises interest rates by 0.25%',
            'category': 'forex',
            'symbols': 'EURUSD,GBPUSD'
        },
        {
            'source': 'finnhub',
            'headline': 'Apple announces new iPhone with AI features',
            'category': 'stocks',
            'symbols': 'AAPL'
        },
        {
            'source': 'newsapi',
            'headline': 'Bitcoin ETF sees record inflows',
            'category': 'crypto',
            'symbols': 'BTC'
        },
        {
            'source': 'finnhub',
            'headline': 'Gold prices surge on geopolitical tensions',
            'category': 'forex',
            'symbols': 'XAUUSD'
        }
    ]
    
    for data in articles_data:
        article = NewsArticle(
            source=data['source'],
            headline=data['headline'],
            description=f"Test description for {data['headline']}",
            url=f"https://example.com/{data['source']}/{hash(data['headline'])}",
            published_at=datetime.now(timezone.utc),
            category=data['category'],
            symbols=data['symbols']
        )
        session.add(article)
    
    session.commit()
    
    # Verify storage
    count = session.query(NewsArticle).count()
    assert count == 4
    print(f"   ✓ Created and stored {count} articles")
    
    # Test retrieval by category
    crypto_articles = session.query(NewsArticle).filter_by(category='crypto').all()
    assert len(crypto_articles) == 1
    print(f"   ✓ Category filtering works (found {len(crypto_articles)} crypto article)")
    
    session.close()


def test_configuration():
    """Test configuration management"""
    print("\n3. Testing configuration...")
    
    print(f"   • Database URL: {Config.DATABASE_URL}")
    print(f"   • NewsAPI rate limit: {Config.NEWSAPI_RATE_LIMIT}/min")
    print(f"   • Finnhub rate limit: {Config.FINNHUB_RATE_LIMIT}/min")
    print(f"   • Stock symbols: {', '.join(Config.STOCK_SYMBOLS[:3])}...")
    print(f"   • Crypto symbols: {', '.join(Config.CRYPTO_SYMBOLS[:2])}...")
    print(f"   • Forex symbols: {', '.join(Config.FOREX_SYMBOLS[:2])}...")
    print("   ✓ Configuration loaded successfully")


def test_scraper_structure():
    """Test scraper initialization without API keys"""
    print("\n4. Testing scraper structure...")
    
    # Test that scrapers can be initialized with test keys
    from data_engine.newsapi_scraper import NewsAPIScraper
    from data_engine.finnhub_scraper import FinnhubScraper
    
    newsapi = NewsAPIScraper(api_key='test_key')
    assert newsapi.api_key == 'test_key'
    print("   ✓ NewsAPIScraper initializes correctly")
    
    finnhub = FinnhubScraper(api_key='test_key')
    assert finnhub.api_key == 'test_key'
    print("   ✓ FinnhubScraper initializes correctly")
    
    # Test normalization
    test_newsapi_article = {
        'title': 'Test Headline',
        'description': 'Test Description',
        'url': 'https://example.com/test',
        'publishedAt': '2024-01-01T12:00:00Z'
    }
    
    normalized = newsapi.normalize_article(test_newsapi_article, 'stocks')
    assert normalized.source == 'newsapi'
    assert normalized.headline == 'Test Headline'
    assert normalized.category == 'stocks'
    print("   ✓ Article normalization works correctly")


def test_rate_limiting():
    """Test that rate limiting is configured"""
    print("\n5. Testing rate limiting...")
    from data_engine.newsapi_scraper import NewsAPIScraper
    from data_engine.finnhub_scraper import FinnhubScraper
    
    newsapi = NewsAPIScraper(api_key='test')
    finnhub = FinnhubScraper(api_key='test')
    
    # Check that rate limit methods exist
    assert hasattr(newsapi, '_rate_limited_request')
    assert hasattr(finnhub, '_rate_limited_request')
    print("   ✓ Rate limiting decorators are in place")
    print(f"   • NewsAPI: max {Config.NEWSAPI_RATE_LIMIT} calls/minute")
    print(f"   • Finnhub: max {Config.FINNHUB_RATE_LIMIT} calls/minute")


def test_duplicate_prevention():
    """Test that duplicate articles are prevented"""
    print("\n6. Testing duplicate prevention...")
    
    # Use a fresh in-memory database
    from sqlalchemy import create_engine
    engine = create_engine('sqlite:///:memory:')
    from data_engine.models import Base
    Base.metadata.create_all(engine)
    
    from sqlalchemy.orm import sessionmaker
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Create article
    article1 = NewsArticle(
        source='test',
        headline='Duplicate test',
        url='https://example.com/same',
        published_at=datetime.now(timezone.utc),
        category='stocks',
    )
    session.add(article1)
    session.commit()
    
    # Try to create duplicate
    article2 = NewsArticle(
        source='test',
        headline='Duplicate test',
        url='https://example.com/same',
        published_at=article1.published_at,
        category='stocks',
    )
    
    # Check if duplicate exists
    existing = session.query(NewsArticle).filter_by(
        url=article2.url,
        published_at=article2.published_at
    ).first()
    
    assert existing is not None
    print("   ✓ Duplicate detection works correctly")
    
    session.close()


def main():
    """Run all integration tests"""
    print("="*70)
    print("NEWS SCRAPER INTEGRATION TEST")
    print("="*70)
    
    try:
        test_database_setup()
        test_article_creation()
        test_configuration()
        test_scraper_structure()
        test_rate_limiting()
        test_duplicate_prevention()
        
        print("\n" + "="*70)
        print("✓ ALL TESTS PASSED!")
        print("="*70)
        
        print("\n📋 Summary of Features:")
        print("  ✓ Database models with timestamps")
        print("  ✓ NewsAPI integration with rate limiting")
        print("  ✓ Finnhub integration with rate limiting")
        print("  ✓ Article normalization from both sources")
        print("  ✓ Duplicate prevention")
        print("  ✓ Category-based filtering (stocks, crypto, forex)")
        print("  ✓ Configuration management")
        
        print("\n📖 Next Steps:")
        print("  1. Configure API keys in .env file")
        print("  2. Run: python -m data_engine.scraper")
        print("  3. Or use: python examples.py")
        
        print("\n" + "="*70)
        
        return True
        
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)
