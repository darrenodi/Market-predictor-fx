"""
Database models for storing news articles
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Text, Float, create_engine, Index, UniqueConstraint
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

Base = declarative_base()


class NewsArticle(Base):
    """Model for storing news articles from various sources"""
    __tablename__ = 'news_articles'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(50), nullable=False, index=True)  # 'newsapi' or 'finnhub'
    headline = Column(Text, nullable=False)
    description = Column(Text)
    url = Column(String(500))
    published_at = Column(DateTime, nullable=False, index=True)
    scraped_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    category = Column(String(50))  # stocks, crypto, forex
    symbols = Column(String(500))  # comma-separated list of related symbols
    sentiment = Column(Float)  # optional sentiment score
    
    # Add unique constraint to prevent duplicates at database level
    __table_args__ = (
        UniqueConstraint('url', 'published_at', name='uix_url_published'),
        Index('idx_source_category', 'source', 'category'),
    )
    
    def __repr__(self):
        return f"<NewsArticle(id={self.id}, source={self.source}, headline={self.headline[:50]}...)>"


def get_engine(database_url=None):
    """Create database engine"""
    if database_url is None:
        database_url = os.getenv('DATABASE_URL', 'sqlite:///./market_predictor.db')
    return create_engine(database_url, echo=False)


def get_session(engine=None):
    """Create database session"""
    if engine is None:
        engine = get_engine()
    Session = sessionmaker(bind=engine)
    return Session()


def init_db(database_url=None):
    """Initialize database schema"""
    engine = get_engine(database_url)
    Base.metadata.create_all(engine)
    return engine
