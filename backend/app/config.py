"""Application configuration loaded from environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


def _env_int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    """Parse a bounded integer setting with an actionable startup error."""
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be <= {maximum}")
    return value


class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/orbit_path_painter")
    # Bind to localhost by default; deployments should opt into a public
    # interface explicitly and place the service behind appropriate controls.
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = _env_int("PORT", 8000, minimum=1, maximum=65535)
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:8080")
    # Debug logging is opt-in so a production-like launch is quiet by default.
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # Keep database startup failures bounded when the optional local database
    # is not running and the JSON fallback is used instead.
    DB_CONNECT_TIMEOUT_SECONDS: int = _env_int(
        "DB_CONNECT_TIMEOUT_SECONDS", 3, minimum=1, maximum=30
    )

    # Cache
    CACHE_MAX_SIZE: int = _env_int("CACHE_MAX_SIZE", 256, minimum=1)
    CACHE_TTL_SECONDS: int = _env_int("CACHE_TTL_SECONDS", 3600, minimum=1)

    # Aircraft defaults
    DEFAULT_AIRCRAFT_SPEED_KMH: float = float(os.getenv("DEFAULT_AIRCRAFT_SPEED_KMH", "903.0"))
    MAX_RANGE_KM: float = float(os.getenv("MAX_RANGE_KM", "14140.0"))


settings = Settings()
