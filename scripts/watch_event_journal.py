#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

TRANSIENT_HEALTH_EVENT_TYPES = {"source_fetch_error"}


def event_storage_key(item: dict[str, Any]) -> tuple[str, str, str, str]:
    """Stable daily-journal identity.

    Source changes are versioned by content hash so two genuine changes on the same URL
    during one day are both preserved. Discovery/new-URL events use their source date/hash
    when available and otherwise collapse to one event per URL/entity.
    """
    event_type = str(item.get("event_type") or "")
    url = str(item.get("url") or "")
    entity = str(item.get("entity_id") or item.get("owner") or item.get("entity_name") or "")
    if event_type == "official_source_changed":
        version = str(item.get("sha256") or item.get("observed_at") or "")
    else:
        version = str(item.get("sha256") or item.get("published_at") or "")
    return event_type, url, entity, version


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows


def merge_daily_events(existing: list[dict[str, Any]], current: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep same-day research/promotable events durable without poisoning health state.

    `source_fetch_error` is intentionally current-run-only because source-health uses it
    as a live transport signal. Keeping yesterday/earlier-run transport errors in the same
    day's JSONL would create false failures after a source has recovered.
    """
    combined = [
        item for item in existing
        if str(item.get("event_type") or "") not in TRANSIENT_HEALTH_EVENT_TYPES
    ]
    combined.extend(current)

    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in combined:
        key = event_storage_key(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def merge_daily_jsonl(path: Path, current: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return merge_daily_events(load_jsonl(path), current)
