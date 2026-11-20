import json
from typing import List, Union
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.api import api_router


def parse_cors_origins(raw: Union[List[str], str]) -> List[str]:
    """Parse CORS origins from list, comma-separated string, or JSON array."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except (json.JSONDecodeError, TypeError):
            pass
        return [item.strip() for item in raw.split(",") if item.strip()]
    elif isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return ["http://localhost:3000"]


parsed_origins = parse_cors_origins(settings.CORS_ORIGINS)
allow_all = "*" in parsed_origins

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Geospatial Routing Engine tailored for coastal water access and maternal-safe transport."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else parsed_origins,
    allow_origin_regex=None if allow_all else r"https://.*\.vercel\.app|https://.*\.onrender\.com|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?",
    allow_credentials=not allow_all,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION
    }
