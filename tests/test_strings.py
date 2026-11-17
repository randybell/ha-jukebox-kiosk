"""#133: repair notices point to the Marketplace, not HACS (HA 2026.11+ has no HACS)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "jukebox_kiosk"


def _texts(path: Path) -> list[str]:
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, str):
            out.append(node)

    walk(json.loads(path.read_text(encoding="utf-8")))
    return out


def test_no_hacs_in_user_text():
    for name in ("strings.json", "translations/en.json"):
        for text in _texts(ROOT / name):
            # the old resource path /hacsfiles/... is a real URL and stays
            assert not re.search(r"\bHACS\b", text), f"{name}: {text}"


def test_strings_and_english_match():
    assert json.loads((ROOT / "strings.json").read_text(encoding="utf-8")) == json.loads(
        (ROOT / "translations" / "en.json").read_text(encoding="utf-8")
    )
