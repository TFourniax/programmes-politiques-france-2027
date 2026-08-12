#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import ROOT
from daily_watch import canonicalize_url, collect_official_targets

PERSISTENT_FAILURE_RUNS = 4


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def current_error_urls(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if item.get("event_type") == "source_fetch_error" and item.get("url"):
            out.add(canonicalize_url(str(item["url"])))
    return out


def http_error_urls(state: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for url, record in (state.get("sources") or {}).items():
        if not isinstance(record, dict):
            continue
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            continue
        if status >= 400:
            out.add(canonicalize_url(str(url)))
    return out


def healthy_direct_feed_coverage(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return owners whose official HTML is backed by a healthy official direct feed.

    This is a coverage fallback, not a factual shortcut: the direct feed only discovers
    URLs. Canonical promotion still requires the complete primary content and the normal
    verification pipeline.
    """
    out: dict[str, dict[str, Any]] = {}
    for url, record in (state.get("direct_feed_health") or {}).items():
        if not isinstance(record, dict):
            continue
        owner = str(record.get("owner") or "").strip()
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            status = 0
        if not owner or status <= 0 or status >= 400:
            continue
        out[owner] = {
            "url": canonicalize_url(str(url)),
            "status": status,
            "checked_at": record.get("checked_at"),
            "resolved_url": record.get("resolved_url"),
        }
    return out


def update_records(
    previous: dict[str, Any],
    targets: list[dict[str, str]],
    errors: set[str],
    stamp: str,
    alternate_coverage: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    alternate_coverage = alternate_coverage or {}
    records = dict(previous.get("sources") or {})
    active_urls = set()
    alternate_count = 0
    for target in targets:
        url = canonicalize_url(target["url"])
        active_urls.add(url)
        row = dict(records.get(url) or {})
        row["url"] = url
        row["owner"] = target.get("owner")
        alternate = alternate_coverage.get(str(target.get("owner") or ""))

        if url in errors and alternate:
            # The public HTML endpoint can be protected by anti-bot middleware while an
            # official RSS/Atom endpoint remains available. Treat monitoring coverage as
            # healthy, but keep the alternate explicit for observability.
            row["consecutive_failures"] = 0
            row["first_failure_at"] = None
            row["last_success_at"] = stamp
            row["last_failure_at"] = stamp
            row["status"] = "ok_via_official_feed"
            row["alternate_url"] = alternate.get("url")
            row["alternate_checked_at"] = alternate.get("checked_at")
            alternate_count += 1
        elif url in errors:
            failures = int(row.get("consecutive_failures") or 0) + 1
            row["consecutive_failures"] = failures
            row["first_failure_at"] = row.get("first_failure_at") or stamp
            row["last_failure_at"] = stamp
            row["status"] = "persistent_failure" if failures >= PERSISTENT_FAILURE_RUNS else "transient_failure"
            row.pop("alternate_url", None)
            row.pop("alternate_checked_at", None)
        else:
            row["consecutive_failures"] = 0
            row["first_failure_at"] = None
            row["last_success_at"] = stamp
            row["status"] = "ok"
            row.pop("alternate_url", None)
            row.pop("alternate_checked_at", None)
        records[url] = row

    # Preserve retired targets for auditability, but never alert on them.
    for url, row in list(records.items()):
        if url not in active_urls:
            copy = dict(row)
            copy["status"] = "retired"
            records[url] = copy

    persistent = [
        row for row in records.values()
        if row.get("status") == "persistent_failure"
    ]
    return {
        "version": 2,
        "generated_at": stamp,
        "persistent_failure_threshold_runs": PERSISTENT_FAILURE_RUNS,
        "persistent_failure_count": len(persistent),
        "alternate_official_feed_coverage_count": alternate_count,
        "persistent_failures": sorted(
            [
                {
                    "url": row.get("url"),
                    "owner": row.get("owner"),
                    "consecutive_failures": row.get("consecutive_failures"),
                    "first_failure_at": row.get("first_failure_at"),
                    "last_failure_at": row.get("last_failure_at"),
                }
                for row in persistent
            ],
            key=lambda row: str(row.get("url") or ""),
        ),
        "sources": records,
    }


def main() -> None:
    base = ROOT / "research" / "veille"
    previous = load_json(base / "source-health.json", {})
    watch_state = load_json(base / "state.json", {})
    day = datetime.now(timezone.utc).date().isoformat()
    errors = current_error_urls(base / f"{day}.jsonl") | http_error_urls(watch_state)
    alternates = healthy_direct_feed_coverage(watch_state)
    payload = update_records(
        previous,
        collect_official_targets(),
        errors,
        iso_now(),
        alternate_coverage=alternates,
    )
    (base / "source-health.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"Official source health: {payload['persistent_failure_count']} persistent failure(s), "
        f"{len(errors)} raw failure(s), "
        f"{payload['alternate_official_feed_coverage_count']} alternate official feed coverage(s)"
    )


if __name__ == "__main__":
    main()
