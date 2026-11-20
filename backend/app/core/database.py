from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from app.core.config import settings

# Normalize database URL for asyncpg if raw postgresql:// or postgres:// is passed (e.g. from Supabase / Render)
raw_db_url = settings.DATABASE_URL
if raw_db_url.startswith("postgres://"):
    raw_db_url = raw_db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif raw_db_url.startswith("postgresql://") and not raw_db_url.startswith("postgresql+asyncpg://"):
    raw_db_url = raw_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    raw_db_url,
    echo=(settings.ENVIRONMENT == "development"),
    future=True,
    pool_size=10,
    max_overflow=20
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for obtaining async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
