"""
Configuration management for the scraper
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Configuration class for API keys and settings"""
    
    # API Keys
    NEWS_API_KEY = os.getenv('NEWS_API_KEY', '')
    FINNHUB_KEY = os.getenv('FINNHUB_KEY', '')
    
    # Database
    DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./market_predictor.db')
    
    # Rate Limits (requests per minute)
    NEWSAPI_RATE_LIMIT = int(os.getenv('NEWSAPI_RATE_LIMIT', '100'))
    FINNHUB_RATE_LIMIT = int(os.getenv('FINNHUB_RATE_LIMIT', '60'))
    
    # Scraper settings
    SCRAPER_INTERVAL_MINUTES = int(os.getenv('SCRAPER_INTERVAL_MINUTES', '15'))
    
    # Asset categories
    STOCK_SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'SPY', 'QQQ']
    CRYPTO_SYMBOLS = ['BTC', 'ETH', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT']
    FOREX_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']
    
    @classmethod
    def validate(cls):
        """Validate configuration"""
        errors = []
        if not cls.NEWS_API_KEY:
            errors.append("NEWS_API_KEY not set")
        if not cls.FINNHUB_KEY:
            errors.append("FINNHUB_KEY not set")
        
        if errors:
            raise ValueError(f"Configuration errors: {', '.join(errors)}")
        
        return True
