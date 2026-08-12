#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import auto_promote
import auto_promote_runner as base

SNAPSHOT_BY_PUBLIC: dict[str, dict[str, str]] = {}


def _watch_state(state_path: Path | None = None) -> dict[str, Any]:
    path = state_path or (auto_promote.ROOT / "research" / "veille" / "state.json")
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def structured_snapshot_backlog_events(state_path: Path | None = None) -> list[dict[str, Any]]:
    """Recreate every complete primary snapshot from durable state.

    The daily JSONL is intentionally ephemeral. Canonical enrichment must therefore be
    able to resume from state.json even after later collectors overwrite the day's inbox.
    """
    state = _watch_state(state_path)
    events: list[dict[str, Any]] = []
    for source_id, source in (state.get("structured_primary_health") or {}).items():
        if not isinstance(source, dict) or source.get("status") != 200 or not source.get("complete"):
            continue
        owner = str(source.get("owner") or "").strip()
        if not owner:
            continue
        for item in (source.get("items") or {}).values():
            if not isinstance(item, dict):
                continue
            public_url = str(item.get("link") or "").strip()
            sha256 = str(item.get("sha256") or "").strip()
            snapshot_path = str(item.get("snapshot_path") or "").strip()
            if not public_url or not sha256 or not snapshot_path:
                continue
            event = {
                "event_type": "official_new_url",
                "observed_at": str(source.get("checked_at") or state.get("last_structured_primary_run_at") or ""),
                "owner": owner,
                "priority": "high",
                "published_at": item.get("date"),
                "source_tier": "tier_1_primary_official",
                "title": item.get("title"),
                "url": public_url,
                "fetch_url": str(item.get("fetch_url") or public_url),
                "snapshot_path": snapshot_path,
                "sha256": sha256,
                "verification_state": "needs_review",
                "provenance": "durable_official_html_primary_snapshot",
                "structured_source_id": source_id,
                "structured_item_number": item.get("number"),
                "structured_section_count": item.get("section_count"),
            }
            if base.current_cycle_event(event):
                events.append(event)
    return events


def _register_transport(event: dict[str, Any]) -> None:
    public_url = str(event.get("url") or "")
    if not public_url:
        return
    snapshot_path = str(event.get("snapshot_path") or "").strip()
    if snapshot_path:
        SNAPSHOT_BY_PUBLIC[public_url] = {
            "path": snapshot_path,
            "sha256": str(event.get("sha256") or ""),
            "title": str(event.get("title") or ""),
            "fetch_url": str(event.get("fetch_url") or public_url),
        }
        base.STRUCTURED_FETCH_BY_PUBLIC.pop(public_url, None)
        return
    fetch_url = str(event.get("fetch_url") or "").strip()
    if fetch_url:
        base.STRUCTURED_FETCH_BY_PUBLIC[public_url] = fetch_url


def durable_load_events() -> list[dict[str, Any]]:
    SNAPSHOT_BY_PUBLIC.clear()
    base.STRUCTURED_FETCH_BY_PUBLIC.clear()
    events = [item for item in base.ORIGINAL_LOAD_EVENTS() if base.current_cycle_event(item)]
    existing: set[tuple[str, str]] = set()
    for event in events:
        _register_transport(event)
        existing.add((
            str(event.get("url") or ""),
            str(event.get("sha256") or event.get("published_at") or event.get("observed_at") or ""),
        ))

    for event in [*base.state_backlog_events(), *structured_snapshot_backlog_events(), *base.structured_backlog_events()]:
        key = (
            str(event.get("url") or ""),
            str(event.get("sha256") or event.get("published_at") or event.get("observed_at") or ""),
        )
        _register_transport(event)
        if key in existing:
            continue
        events.append(event)
        existing.add(key)
    return events


def _snapshot_source(public_url: str, metadata: dict[str, str], max_chars: int) -> dict[str, Any]:
    relative = Path(metadata["path"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("unsafe structured snapshot path")
    root = auto_promote.ROOT.resolve()
    allowed = (root / "research" / "veille" / "structured" / "snapshots").resolve()
    path = (root / relative).resolve()
    try:
        path.relative_to(allowed)
    except ValueError as exc:
        raise ValueError("structured snapshot outside approved directory") from exc
    if not path.exists() or not path.is_file():
        raise ValueError(f"structured snapshot missing: {relative.as_posix()}")
    full_text = path.read_text(encoding="utf-8")
    if len(full_text.strip()) < 180:
        raise ValueError("structured snapshot text too short")
    actual_sha = hashlib.sha256(full_text.encode("utf-8")).hexdigest()
    expected_sha = str(metadata.get("sha256") or "")
    if not expected_sha or actual_sha != expected_sha:
        raise ValueError("structured snapshot integrity mismatch")
    return {
        "url": public_url,
        "fetch_url": metadata.get("fetch_url") or public_url,
        "host": auto_promote.host(public_url),
        "title": metadata.get("title") or None,
        "kind": "official_primary_snapshot",
        "text": full_text[:max_chars],
        "text_truncated": len(full_text) > max_chars,
        "sha256": actual_sha,
    }


def safe_fetch_source(session, url: str, max_chars: int):
    public_url = str(url)
    snapshot = SNAPSHOT_BY_PUBLIC.get(public_url)
    if snapshot:
        source = _snapshot_source(public_url, snapshot, max_chars)
    else:
        fetch_url = base.STRUCTURED_FETCH_BY_PUBLIC.get(public_url)
        if fetch_url:
            source = base._wordpress_rest_source(session, public_url, fetch_url, max_chars)
        else:
            source = base.ORIGINAL_FETCH_SOURCE(session, public_url, max_chars)
    if source.get("text_truncated"):
        raise ValueError("source exceeds configured safe extraction limit; refusing partial canonical promotion")
    return source


def main() -> None:
    # Reuse every strict semantic/date/ownership guard from the existing runner. This
    # adapter changes transport only: snapshots are immutable evidence captured from the
    # official public pages and verified by hash before the model sees them.
    base.durable_load_events = durable_load_events
    base.safe_fetch_source = safe_fetch_source
    base.main()


if __name__ == "__main__":
    main()
