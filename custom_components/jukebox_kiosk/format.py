"""Turn raw MA dicts into the flat shapes the Jukebox Card already parses.

These match what the card parsed from mass_queue (`media_title`,
`media_content_id`, `media_image`, ...), so the card's views did not need to
change. Written from the MA models, not copied from mass_queue.
"""

from __future__ import annotations

from typing import Any


def _remote_image(img: Any) -> str | None:
    if isinstance(img, dict) and img.get("remotely_accessible") and isinstance(img.get("path"), str):
        path = img["path"]
        if path.startswith(("https://", "http://")):
            return path
    return None


def _first_remote(images: Any) -> str | None:
    if isinstance(images, list):
        for img in images:
            if url := _remote_image(img):
                return url
    return None


def find_image(item: dict[str, Any] | None) -> str:
    """Best remotely reachable image for a media item (or queue item)."""
    if not isinstance(item, dict):
        return ""
    media = item.get("media_item") if isinstance(item.get("media_item"), dict) else item
    candidates = [
        _remote_image(item.get("image")),
        _remote_image(media.get("image")),
        _first_remote((media.get("metadata") or {}).get("images")),
        _first_remote(((media.get("album") or {}).get("metadata") or {}).get("images")),
        _remote_image((media.get("album") or {}).get("image")),
    ]
    for artist in media.get("artists") or []:
        if isinstance(artist, dict):
            candidates.append(_remote_image(artist.get("image")))
    return next((c for c in candidates if c), "")


def artist_names(media: dict[str, Any]) -> str:
    """Comma separated artist names."""
    return ", ".join(
        str(a.get("name")) for a in media.get("artists") or [] if isinstance(a, dict) and a.get("name")
    )


def album_name(media: dict[str, Any]) -> str:
    """Album name or empty string."""
    album = media.get("album")
    return str(album.get("name") or "") if isinstance(album, dict) else ""


def format_queue_item(qi: dict[str, Any]) -> dict[str, Any]:
    """Queue item -> card QueueItem."""
    media = qi.get("media_item") if isinstance(qi.get("media_item"), dict) else {}
    return {
        "queue_item_id": qi.get("queue_item_id"),
        "media_title": media.get("name") or qi.get("name") or "",
        "media_album_name": album_name(media),
        "media_artist": artist_names(media),
        "media_content_id": media.get("uri") or qi.get("uri") or "",
        "media_image": find_image(qi),
        "favorite": bool(media.get("favorite", False)),
        "duration": qi.get("duration") or media.get("duration") or 0,
    }


def format_track(item: dict[str, Any], position: int | None = None) -> dict[str, Any]:
    """Track / podcast episode -> card track row."""
    out: dict[str, Any] = {
        "media_title": item.get("name") or "N/A",
        "media_content_id": item.get("uri") or "",
        "duration": item.get("duration") or 0,
        "media_image": find_image(item),
        "favorite": bool(item.get("favorite", False)),
        "media_album_name": album_name(item),
        "media_artist": artist_names(item),
    }
    if position is not None:
        out["position"] = position
    release = (item.get("metadata") or {}).get("release_date")
    if release:
        out["release_date"] = release
    return out


def parse_uri(uri: str) -> tuple[str, str, str]:
    """`provider://media_type/item_id` -> (provider, media_type, item_id)."""
    if "://" not in uri:
        raise ValueError(f"Not an MA uri: {uri}")
    provider, rest = uri.split("://", 1)
    media_type, _, item_id = rest.partition("/")
    if not provider or not media_type or not item_id:
        raise ValueError(f"Not an MA uri: {uri}")
    return provider, media_type, item_id


def redact_group_config(raw: Any) -> dict[str, Any]:
    """Keep only what the card needs from a player config."""
    if not isinstance(raw, dict):
        return {}
    values = raw.get("values") if isinstance(raw.get("values"), dict) else {}
    keep = {k: values[k] for k in ("group_members", "dynamic_members") if k in values}
    return {"player_id": raw.get("player_id"), "values": keep}
