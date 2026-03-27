import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_KEY_DIR = BASE_DIR / "runtime" / "keys"


def _candidate_paths(user_id: int) -> list[Path]:
    configured_dir = Path(os.getenv("CIPHERPAY_KEY_DIR", DEFAULT_KEY_DIR))
    return [
        configured_dir / f"private_key_{user_id}.pem",
        BASE_DIR / f"private_key_{user_id}.pem",
        BASE_DIR.parent / f"private_key_{user_id}.pem",
    ]


def ensure_key_dir() -> Path:
    key_dir = Path(os.getenv("CIPHERPAY_KEY_DIR", DEFAULT_KEY_DIR))
    key_dir.mkdir(parents=True, exist_ok=True)
    return key_dir


def save_private_key(user_id: int, private_key: str) -> Path:
    key_dir = ensure_key_dir()
    path = key_dir / f"private_key_{user_id}.pem"
    path.write_text(private_key, encoding="utf-8")
    return path


def get_private_key_path(user_id: int) -> Path | None:
    return next((path for path in _candidate_paths(user_id) if path.exists()), None)


def load_private_key(user_id: int) -> str | None:
    path = get_private_key_path(user_id)
    if not path:
        return None
    return path.read_text(encoding="utf-8")
