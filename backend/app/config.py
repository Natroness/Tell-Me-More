from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["meta", "gemini"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    supabase_url: str = ""
    supabase_secret_key: str = ""  # sb_secret_...
    # Only used for legacy HS256 tokens; asymmetric (ES256/RS256) tokens verify via JWKS.
    supabase_jwt_secret: str = ""

    llm_provider: Provider = "meta"
    vision_provider: Provider = "meta"

    meta_api_key: str = ""
    meta_base_url: str = ""
    meta_chat_model: str = "muse-spark-1.1"
    meta_asr_model: str = "muse-voice-transcribe-1.0"
    meta_asr_url: str = "https://api.meta.ai/v1/asr/transcribe"
    meta_image_model: str = "muse-image"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"

    serpapi_key: str = ""

    worker_enabled: bool = True
    worker_concurrency: int = 8


@lru_cache
def get_settings() -> Settings:
    return Settings()
