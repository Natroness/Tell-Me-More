from dataclasses import dataclass
from functools import lru_cache

from app.config import Provider, Settings, get_settings
from app.providers.base import ASR, LLM, ImageGen, Search
from app.providers.gemini import GeminiLLM
from app.providers.meta import MetaASR, MetaImage, MetaLLM
from app.providers.serpapi import SerpApi


@dataclass(frozen=True)
class Providers:
    llm: LLM
    vision: LLM
    asr: ASR
    image: ImageGen
    search: Search


def _llm(name: Provider, s: Settings) -> LLM:
    return MetaLLM(s) if name == "meta" else GeminiLLM(s)


@lru_cache
def get_providers() -> Providers:
    s = get_settings()
    return Providers(
        llm=_llm(s.llm_provider, s),
        vision=_llm(s.vision_provider, s),
        asr=MetaASR(s),
        image=MetaImage(s),
        search=SerpApi(s),
    )
