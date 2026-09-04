"""SQLAlchemy engine and session factory with PostGIS support."""

from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

engine_options: dict[str, Any] = {
    "pool_size": 10,
    "max_overflow": 20,
    "pool_pre_ping": True,
    "echo": settings.DEBUG,
}

if settings.DATABASE_URL.startswith("postgresql"):
    engine_options["connect_args"] = {
        "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
    }

engine = create_engine(settings.DATABASE_URL, **engine_options)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
