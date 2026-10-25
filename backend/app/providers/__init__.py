from dataclasses import dataclass
from functools import lru_cache

from app.config import Provider, Settings, get_settings
from app.providers.base import ASR, LLM, TTS, ImageGen, Search, StockImages, StreamingASR, WorldGen
from app.providers.gemini import GeminiLLM
from app.providers.gemini_tts import GeminiTTS
from app.providers.meta import MetaASR, MetaImage, MetaLLM, MetaStreamingASR
from app.providers.pixabay import Pixabay
from app.providers.serpapi import SerpApi
from app.providers.worldlabs import WorldLabsWorldGen


@dataclass(frozen=True)
class Providers:
    llm: LLM
    # Lower latency, for calls someone is waiting on.
    fast: LLM
    vision: LLM
    asr: ASR
    asr_stream: StreamingASR
    image: ImageGen
    search: Search
    world: WorldGen
    tts: TTS
    stock: StockImages


def _llm(name: Provider, s: Settings, model: str | None = None) -> LLM:
    return MetaLLM(s, model) if name == "meta" else GeminiLLM(s)


@lru_cache
def get_providers() -> Providers:
    s = get_settings()
    return Providers(
        llm=_llm(s.llm_provider, s),
        fast=_llm(s.llm_provider, s, s.meta_fast_model or None),
        vision=_llm(s.vision_provider, s),
        asr=MetaASR(s),
        asr_stream=MetaStreamingASR(s),
        image=MetaImage(s),
        search=SerpApi(s),
        world=WorldLabsWorldGen(s),
        tts=GeminiTTS(s),
        stock=Pixabay(s),
    )
