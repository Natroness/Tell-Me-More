"""Prefer stock whose subject tags match the scene; never substitute an unrelated hit."""

import re
from math import ceil

from app.providers.base import StockPhoto

STOP_WORDS = {"a", "an", "the", "of", "in", "on", "at", "and", "with", "old", "vintage", "photo"}


def words(text: str) -> set[str]:
    return {w.removesuffix("s") for w in re.findall(r"[a-z]{3,}", text.lower())} - STOP_WORDS


def relevant_stock(photos: list[StockPhoto], query: str) -> StockPhoto | None:
    terms = words(query)
    ranked = sorted(photos, key=lambda p: len(terms & words(p.tags)), reverse=True)
    # Missing tags are insufficient evidence of relevance, including cached older results.
    return next(
        (p for p in ranked if len(terms & words(p.tags)) >= max(1, ceil(len(terms) / 2))), None
    )
