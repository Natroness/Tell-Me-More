from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
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
    # For calls someone is waiting on (interview questions, object matching); empty uses the chat
    # model. Muse Spark 1.3 at minimal effort writes a question in ~1.3 s, 1.1 in ~2.5 s.
    meta_fast_model: str = ""
    meta_asr_model: str = "muse-voice-transcribe-1.0"
    meta_asr_url: str = "https://api.meta.ai/v1/asr/transcribe"
    meta_asr_stream_url: str = "wss://api.meta.ai/v1/asr/realtime"
    meta_image_model: str = "muse-image"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"

    serpapi_key: str = ""

    # Storytime is English-only and never enqueued by the interview pipeline.
    storytime_enabled: bool = False
    storytime_daily_limit_per_family: int = Field(5, ge=0)
    storytime_min_seconds: float = Field(30, ge=1)  # Script target; never pad short memories.
    storytime_max_seconds: float = Field(75, ge=1)
    tts_provider: Literal["gemini"] = "gemini"
    tts_model: str = "gemini-3.8-flash-tts"
    tts_voice: str = "Sulafat"
    pixabay_api_key: str = ""
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"

    # Immersive memories (docs/IMMERSIVE.md). The World API v1 key comes from platform.worldlabs.ai.
    worldlabs_api_key: str = Field(
        "", validation_alias=AliasChoices("worldlabs_api_key", "wlt_api_key")
    )
    worldlabs_base_url: str = "https://api.worldlabs.ai"
    worldlabs_model: str = "marble-1.1"  # marble-1.0-draft (about $0.18 a world) in dev
    immersive_enabled: bool = False  # off: every immersive route answers 404
    immersive_concurrency: int = 2
    immersive_daily_limit_per_family: int = 5
    immersive_poll_seconds: float = 10.0
    immersive_timeout_seconds: int = 900

    worker_enabled: bool = True
    worker_concurrency: int = 8
    db_pool_size: int = 5

    # Testing only: email-only instant login with no password or email link.
    # The frontend shows a dev button when VITE_DEV_PASSWORDLESS_LOGIN=true and the
    # backend accepts dev tokens only when this is true. Keep false in production.
    dev_passwordless_login: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
