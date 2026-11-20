from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Union


class Settings(BaseSettings):
    PROJECT_NAME: str = "JalDurbin Coastal Water Access API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://jaldurbin:jaldurbin_secret@localhost:5432/jaldurbin_gis"
    
    # Environment & CORS (Supports comma-separated strings or list of domains)
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://*.vercel.app",
        "https://*.onrender.com",
    ]
    
    # Routing Constraints Defaults
    DEFAULT_MAX_SAFE_SLOPE: float = 0.06  # 6% gradient threshold for maternal safety
    DEFAULT_CARRIED_LOAD_KG: float = 15.0  # Standard coastal water pot weight
    
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="allow")


settings = Settings()
