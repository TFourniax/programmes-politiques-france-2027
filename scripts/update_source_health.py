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


def update_records(
    previous: dict[str, Any],
    targets: list[dict[str, str]],
    errors: set[str],
    stamp: str,
) -> dict[str, Any]:
    records = dict(previous.get("sources") or {})
    active_urls = set()
    for target in targets:
        url = canonicalize_url(target["url"])
        active_urls.add(url)
        row = dict(records.get(url) or {})
        row["url"] = url
        row["owner"] = target.get("owner")
        if url in errors:
            failures = int(row.get("consecutive_failures") or 0) + 1
            row["consecutive_failures"] = failures
            row["first_failure_at"] = row.get("first_failure_at") or stamp
            row["last_failure_at"] = stamp
            row["status"] = "persistent_failure" if failures >= PERSISTENT_FAILURE_RUNS else "transient_failure"
        else:
            row["consecutive_failures"] = 0
            row["first_failure_at"] = None
            row["last_success_at"] = stamp
            row["status"] = "ok"
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
        "version": 1,
        "generated_at": stamp,
        "persistent_failure_threshold_runs": PERSISTENT_FAILURE_RUNS,
        "persistent_failure_count": len(persistent),
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
    payload = update_records(previous, collect_official_targets(), errors, iso_now())
    (base / "source-health.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"Official source health: {payload['persistent_failure_count']} persistent failure(s), "
        f"{len(errors)} failure(s) this run"
    )


if __name__ == "__main__":
    main()
