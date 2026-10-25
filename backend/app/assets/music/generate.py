"""Reproduce the original ambient beds. No samples or external recordings are used."""

import math
import struct
import wave
from pathlib import Path

RATE = 24000
SECONDS = 24
CHORDS = {
    "tender": (130, 164, 196),
    "nostalgic": (110, 130, 164),
    "joyful": (146, 184, 220),
    "bittersweet": (130, 155, 196),
}

for name, notes in CHORDS.items():
    frames = bytearray()
    for i in range(RATE * SECONDS):
        t = i / RATE
        envelope = min(1, t / 2, (SECONDS - t) / 2)
        value = sum(math.sin(2 * math.pi * f * t) for f in notes) / len(notes)
        value *= 0.5 + 0.15 * math.sin(2 * math.pi * t / 8)
        frames.extend(struct.pack("<h", round(12000 * value * envelope)))
    with wave.open(str(Path(__file__).parent / f"{name}.wav"), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames)
