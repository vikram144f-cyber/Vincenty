"""
Orbit Path Painter — FastAPI Backend

Main application entry point. Configures CORS, mounts API routes,
and provides a health-check endpoint.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import router as api_router

# Logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s │ %(levelname)-8s │ %(name)s │ %(message)s",
)
logger = logging.getLogger(__name__)


# ─── Lifespan (startup / shutdown) ────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀  Orbit Path Painter backend starting …")
    logger.info(f"   Frontend origin: {settings.FRONTEND_ORIGIN}")
    logger.info(f"   Database URL:    {settings.DATABASE_URL[:40]}…")

    # Attempt DB table creation (best-effort — works even without PostGIS)
    try:
        from app.database import engine, Base
        from app.models import EnvironmentConstraint, SavedRoute  # noqa: F401
        Base.metadata.create_all(bind=engine)
        logger.info("   ✅ Database tables verified / created")
    except Exception as e:
        logger.warning(f"   ⚠  Database init skipped (will use fallback data): {e}")

    yield
    logger.info("🛑  Backend shutting down")


# ─── App Factory ──────────────────────────────────────────────────────

app = FastAPI(
    title="Orbit Path Painter API",
    description="Geodesic pathfinding engine with environmental constraint avoidance",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Vite frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_ORIGIN,
        "http://localhost:8080",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routes
app.include_router(api_router)


@app.get("/", tags=["health"])
async def root():
    return {
        "service": "Orbit Path Painter API",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs",
    }


@app.get("/health", tags=["health"])
async def health_check():
    db_status = "unknown"
    try:
        from app.database import engine
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "disconnected (using fallback data)"

    return {
        "status": "healthy",
        "database": db_status,
    }
