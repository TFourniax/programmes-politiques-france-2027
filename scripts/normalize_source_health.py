#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from common import ROOT
from daily_watch import canonicalize_url

PROTECTED_OR_RATE_LIMITED = {401, 403, 405, 429}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def protected_sources(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for url, record in (state.get("sources") or {}).items():
        if not isinstance(record, dict):
            continue
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            continue
        if status not in PROTECTED_OR_RATE_LIMITED:
            continue
        canonical = canonicalize_url(str(url))
        out[canonical] = {
            "status": status,
            "checked_at": record.get("checked_at"),
            "resolved_url": record.get("resolved_url"),
        }
    return out


def normalize_source_health(
    source_health: dict[str, Any],
    watch_state: dict[str, Any],
) -> dict[str, Any]:
    payload = dict(source_health)
    sources = {
        str(url): dict(record)
        for url, record in (payload.get("sources") or {}).items()
        if isinstance(record, dict)
    }
    protected = protected_sources(watch_state)
    protected_rows: list[dict[str, Any]] = []

    for url, detail in protected.items():
        row = sources.get(url)
        if not row or row.get("status") not in {"transient_failure", "persistent_failure"}:
            continue
        row.update(
            {
                "status": "reachable_but_protected",
                "consecutive_failures": 0,
                "first_failure_at": None,
                "last_reachable_at": detail.get("checked_at"),
                "http_status": detail["status"],
                "coverage_type": "reachable_but_anti_bot",
            }
        )
        sources[url] = row
        protected_rows.append(
            {
                "url": url,
                "owner": row.get("owner"),
                "kind": row.get("kind"),
                "http_status": detail["status"],
                "resolved_url": detail.get("resolved_url"),
                "coverage_type": "reachable_but_anti_bot",
            }
        )

    protected_urls = {row["url"] for row in protected_rows}
    uncovered = [
        row
        for row in (payload.get("uncovered_failures") or [])
        if isinstance(row, dict) and canonicalize_url(str(row.get("url") or "")) not in protected_urls
    ]
    persistent = [
        {
            "url": row.get("url"),
            "owner": row.get("owner"),
            "kind": row.get("kind"),
            "consecutive_failures": row.get("consecutive_failures"),
            "first_failure_at": row.get("first_failure_at"),
            "last_failure_at": row.get("last_failure_at"),
        }
        for row in sources.values()
        if row.get("status") == "persistent_failure"
    ]
    covered = [row for row in (payload.get("covered_failures") or []) if isinstance(row, dict)]

    payload.update(
        {
            "version": max(int(payload.get("version") or 0), 7),
            "sources": sources,
            "protected_failure_count": len(protected_rows),
            "protected_failures": sorted(protected_rows, key=lambda row: str(row.get("url") or "")),
            "uncovered_failure_count": len(uncovered),
            "uncovered_failures": sorted(uncovered, key=lambda row: str(row.get("url") or "")),
            "persistent_failure_count": len(persistent),
            "persistent_failures": sorted(persistent, key=lambda row: str(row.get("url") or "")),
            "raw_failure_count": len(covered) + len(uncovered) + len(protected_rows),
        }
    )
    return payload


def main() -> None:
    base = ROOT / "research" / "veille"
    source_path = base / "source-health.json"
    source_health = load_json(source_path, {})
    watch_state = load_json(base / "state.json", {})
    payload = normalize_source_health(source_health, watch_state)
    source_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "Normalized official source health: "
        f"persistent={payload.get('persistent_failure_count', 0)}, "
        f"protected={payload.get('protected_failure_count', 0)}, "
        f"uncovered={payload.get('uncovered_failure_count', 0)}"
    )


if __name__ == "__main__":
    main()
