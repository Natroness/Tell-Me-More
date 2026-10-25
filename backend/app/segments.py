"""Sentence-level timing for transcripts, so tapping a story sentence plays the right moment."""

import io
import re
import wave

from app.providers.base import TranscriptSegment

_SENTENCE_END = re.compile(r"(?<=[.!?।。])\s+")
_FINISHED_SENTENCE = re.compile(r"[.!?।。](?=\s|$)")


def wav_duration_ms(audio: bytes) -> int | None:
    try:
        with wave.open(io.BytesIO(audio)) as w:
            return w.getnframes() * 1000 // w.getframerate()
    except (wave.Error, EOFError):
        return None


def sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE_END.split(text.strip()) if s]


def estimate_segments(text: str, duration_ms: int) -> list[TranscriptSegment]:
    """One segment per sentence, timed by length. Tap-to-play then lands within a couple of
    seconds of the right spot."""
    parts = sentences(text)
    total = sum(len(s) for s in parts) or 1
    segments, cursor = [], 0
    for s in parts:
        end = cursor + duration_ms * len(s) // total
        segments.append(TranscriptSegment(start_ms=cursor, end_ms=end, text=s))
        cursor = end
    return segments


def sentence_segments(
    asr_segments: list[TranscriptSegment], text: str, duration_ms: int
) -> list[TranscriptSegment]:
    """The batch ASR times whole speech turns, which can hold several sentences. Split each turn
    into sentences within its real time span; with no turns at all, spread the text over the
    audio."""
    turns = asr_segments or [TranscriptSegment(start_ms=0, end_ms=duration_ms, text=text)]
    return [
        TranscriptSegment(
            start_ms=turn.start_ms + s.start_ms, end_ms=turn.start_ms + s.end_ms, text=s.text
        )
        for turn in turns
        for s in estimate_segments(turn.text, turn.end_ms - turn.start_ms)
    ]


def timed_segments(
    progress: list[tuple[str, int]], text: str, duration_ms: int
) -> list[TranscriptSegment]:
    """Streaming ASR sends cumulative partials, each with how much audio it has processed. The
    first partial that finishes sentence k marks where sentence k ended. Falls back to
    estimate_segments when the partials don't line up with the final text."""
    parts = sentences(text)
    ends = []
    for k in range(1, len(parts)):
        end = next((ms for t, ms in progress if len(_FINISHED_SENTENCE.findall(t)) >= k), None)
        if end is None or end >= duration_ms or (ends and end <= ends[-1]):
            return estimate_segments(text, duration_ms)
        ends.append(end)
    bounds = [0, *ends, duration_ms]
    return [
        TranscriptSegment(start_ms=bounds[i], end_ms=bounds[i + 1], text=s)
        for i, s in enumerate(parts)
    ]
