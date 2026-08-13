#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def processed_source_versions(promotion: dict[str, Any]) -> set[tuple[str, str]]:
    """Return exact (URL, content hash) pairs already seen by canonical promotion."""
    out: set[tuple[str, str]] = set()
    for record in (promotion.get("source_chunks") or {}).values():
        if not isinstance(record, dict):
            continue
        url = str(record.get("url") or "").strip()
        sha = str(record.get("sha256") or "").strip()
        if url and sha:
            out.add((url, sha))
    for record in (promotion.get("sources") or {}).values():
        if not isinstance(record, dict):
            continue
        url = str(record.get("url") or "").strip()
        sha = str(record.get("source_sha256") or "").strip()
        if url and sha:
            out.add((url, sha))
    return out


def monitored_source_backlog(
    watch_state: dict[str, Any],
    promotion_state: dict[str, Any],
) -> list[dict[str, Any]]:
    """Rebuild missing promotion events from the current official-source snapshot.

    `research/veille/YYYY-MM-DD.jsonl` is a per-run research report and can be rewritten
    later the same day. The authoritative watch state keeps the latest validated content
    hash for each monitored official source. Any current hash absent from promotion state
    is therefore still pending and must remain promotable even if its transient event row
    disappeared from the daily report.
    """
    processed = processed_source_versions(promotion_state)
    out: list[dict[str, Any]] = []
    for requested_url, record in (watch_state.get("sources") or {}).items():
        if not isinstance(record, dict):
            continue
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            continue
        sha = str(record.get("sha256") or "").strip()
        owner = str(record.get("owner") or "").strip()
        resolved = str(record.get("resolved_url") or requested_url or "").strip()
        if status <= 0 or status >= 400 or not sha or not owner or not resolved:
            continue
        if (resolved, sha) in processed or (str(requested_url), sha) in processed:
            continue
        out.append({
            "event_type": "official_source_changed",
            "observed_at": str(record.get("checked_at") or watch_state.get("last_run_at") or ""),
            "owner": owner,
            "priority": "high",
            "source_tier": "tier_1_primary_official",
            "verification_state": "needs_review",
            "url": resolved,
            "sha256": sha,
            "provenance": "durable_monitored_source_snapshot_backlog",
        })
    return out


def load_monitored_source_backlog(root: Path) -> list[dict[str, Any]]:
    base = root / "research" / "veille"
    return monitored_source_backlog(
        load_json(base / "state.json"),
        load_json(base / "promotion-state.json"),
    )
