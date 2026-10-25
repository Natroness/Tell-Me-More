"""Uploads the six illustrated avatars to the public `avatars` bucket at presets/{key}.png.

The source PNGs are 1254px and about 1.5 MB each; phones only need 512px, so they are shrunk
with macOS `sips` first when it is available. Safe to rerun: uploads overwrite.

    uv run python scripts/upload_avatars.py
"""

import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path

from app import storage
from app.avatars import preset_url

SOURCE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "image" / "avatars"
FILES = {
    "boy": "bro.png",
    "girl": "sis.png",
    "man": "Dad.png",
    "woman": "mom.png",
    "older-man": "grandpa.png",
    "older-woman": "grandma.png",
}
SIZE = 512


def shrink(path: Path, tmp: str) -> bytes:
    if not shutil.which("sips"):
        return path.read_bytes()
    small = Path(tmp) / path.name
    subprocess.run(
        ["sips", "-Z", str(SIZE), str(path), "--out", str(small)], check=True, capture_output=True
    )
    return small.read_bytes()


async def upload(images: dict[str, bytes]) -> None:
    for key, data in images.items():
        await storage.upload("avatars", f"presets/{key}.png", data, "image/png")
        print(f"{key}: {len(data) // 1024} KB -> {preset_url(key)}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        images = {key: shrink(SOURCE / name, tmp) for key, name in FILES.items()}
    asyncio.run(upload(images))


if __name__ == "__main__":
    main()
