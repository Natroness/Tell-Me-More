"""Profile avatars in the public `avatars` bucket.

`presets/{key}.png` holds the six illustrations (uploaded by scripts/upload_avatars.py);
`users/{user_id}/{id}.{ext}` holds photos people upload. A profile shows its photo, else the
preset it picked, else the illustration for its style and age.
"""

from typing import Literal

from app.config import get_settings

Preset = Literal["boy", "girl", "man", "woman", "older-man", "older-woman"]
Style = Literal["male", "female"]

PRESETS: tuple[Preset, ...] = ("boy", "girl", "man", "woman", "older-man", "older-woman")

# Spliced into queries that join `profile pr`; read back by avatar_url().
AVATAR_COLUMNS = "pr.avatar_preset, pr.avatar_style, pr.age as avatar_age, pr.avatar_path"

_CHILD_MAX = 17
_ADULT_MAX = 50


def public_url(path: str) -> str:
    return f"{get_settings().supabase_url}/storage/v1/object/public/avatars/{path}"


def preset_url(key: Preset) -> str:
    return public_url(f"presets/{key}.png")


def preset_for(style: Style, age: int | None) -> Preset:
    """Same bands as the frontend: child 5-17, adult 18-50, older 51+."""
    age = 24 if age is None else age
    if age <= _CHILD_MAX:
        return "boy" if style == "male" else "girl"
    if age <= _ADULT_MAX:
        return "man" if style == "male" else "woman"
    return "older-man" if style == "male" else "older-woman"


def avatar_url(row) -> str | None:
    """What relatives see for a person row that carries AVATAR_COLUMNS."""
    if row["avatar_path"]:
        return public_url(row["avatar_path"])
    if row["avatar_preset"]:
        return preset_url(row["avatar_preset"])
    if row["avatar_style"]:
        return preset_url(preset_for(row["avatar_style"], row["avatar_age"]))
    return None
