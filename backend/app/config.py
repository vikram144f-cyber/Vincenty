"""Application configuration loaded from environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/orbit_path_painter")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:8080")
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

    # Cache
    CACHE_MAX_SIZE: int = int(os.getenv("CACHE_MAX_SIZE", "256"))
    CACHE_TTL_SECONDS: int = int(os.getenv("CACHE_TTL_SECONDS", "3600"))

    # Aircraft defaults
    DEFAULT_AIRCRAFT_SPEED_KMH: float = float(os.getenv("DEFAULT_AIRCRAFT_SPEED_KMH", "903.0"))
    MAX_RANGE_KM: float = float(os.getenv("MAX_RANGE_KM", "14140.0"))


settings = Settings()
