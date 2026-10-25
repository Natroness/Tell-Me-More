from functools import cache
from pathlib import Path

_DIR = Path(__file__).parent


@cache
def _read(name: str) -> str:
    return (_DIR / f"{name}.md").read_text()


def prompt(name: str, **values: str) -> str:
    """Loads `prompts/<name>.md`, filling `{placeholders}` from `values`."""
    return _read(name).format(**values) if values else _read(name)
