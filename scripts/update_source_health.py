#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import ROOT
from daily_watch import canonicalize_url, collect_official_targets

PERSISTENT_FAILURE_RUNS = 4
FEED_COVERABLE_TARGET_KINDS = {"party_official"}


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


def healthy_equivalent_primary_coverage(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    sources = state.get("sources") or {}
    healthy_by_resource: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for source_url, record in sources.items():
        if not isinstance(record, dict):
            continue
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            status = 0
        owner = str(record.get("owner") or "").strip()
        resolved = canonicalize_url(str(record.get("resolved_url") or source_url))
        if not owner or not resolved or status <= 0 or status >= 400:
            continue
        healthy_by_resource.setdefault((owner, resolved), []).append({
            "url": canonicalize_url(str(source_url)),
            "resolved_url": resolved,
            "status": status,
            "checked_at": record.get("checked_at"),
        })

    out: dict[str, dict[str, Any]] = {}
    for source_url, record in sources.items():
        if not isinstance(record, dict):
            continue
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            status = 0
        if status < 400:
            continue
        canonical_source = canonicalize_url(str(source_url))
        owner = str(record.get("owner") or "").strip()
        resolved = canonicalize_url(str(record.get("resolved_url") or source_url))
        candidates = [
            item for item in healthy_by_resource.get((owner, resolved), [])
            if item.get("url") != canonical_source
        ]
        if candidates:
            out[canonical_source] = sorted(candidates, key=lambda item: str(item.get("url") or ""))[0]
    return out


def healthy_structured_primary_coverage(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map exact public targets covered by a complete official structured representation."""
    out: dict[str, dict[str, Any]] = {}
    for source_id, record in (state.get("structured_primary_health") or {}).items():
        if not isinstance(record, dict) or not record.get("complete"):
            continue
        try:
            status = int(record.get("status") or 0)
        except (TypeError, ValueError):
            status = 0
        expected = int(record.get("expected_items") or 0)
        count = int(record.get("item_count") or 0)
        full = int(record.get("full_content_items") or 0)
        if status != 200 or expected <= 0 or count != expected or full != expected:
            continue
        for url in record.get("coverage_urls") or []:
            canonical = canonicalize_url(str(url))
            out[canonical] = {
                "source_id": source_id,
                "owner": record.get("owner"),
                "checked_at": record.get("checked_at"),
                "expected_items": expected,
                "item_count": count,
                "full_content_items": full,
                "chapter_numbers": record.get("chapter_numbers") or [],
                "api_endpoint": record.get("api_endpoint"),
            }
    return out


def update_records(
    previous: dict[str, Any],
    targets: list[dict[str, str]],
    errors: set[str],
    stamp: str,
    alternate_coverage: dict[str, dict[str, Any]] | None = None,
    equivalent_coverage: dict[str, dict[str, Any]] | None = None,
    structured_coverage: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    alternate_coverage = alternate_coverage or {}
    equivalent_coverage = equivalent_coverage or {}
    structured_coverage = structured_coverage or {}
    records = dict(previous.get("sources") or {})
    active_urls = set()
    feed_covered_failures: list[dict[str, Any]] = []
    equivalent_covered_failures: list[dict[str, Any]] = []
    structured_covered_failures: list[dict[str, Any]] = []
    uncovered_failures: list[dict[str, Any]] = []

    for target in targets:
        url = canonicalize_url(target["url"])
        active_urls.add(url)
        row = dict(records.get(url) or {})
        row["url"] = url
        row["owner"] = target.get("owner")
        row["kind"] = target.get("kind")
        owner = str(target.get("owner") or "")
        kind = str(target.get("kind") or "")
        equivalent = equivalent_coverage.get(url)
        structured = structured_coverage.get(url)
        alternate = alternate_coverage.get(owner) if kind in FEED_COVERABLE_TARGET_KINDS else None

        if url in errors and equivalent:
            row.update({
                "consecutive_failures": 0, "first_failure_at": None, "last_success_at": stamp,
                "last_failure_at": stamp, "status": "ok_via_equivalent_primary_url",
                "alternate_url": equivalent.get("url"), "alternate_checked_at": equivalent.get("checked_at"),
                "alternate_resolved_url": equivalent.get("resolved_url"), "coverage_type": "full_primary_equivalent",
            })
            equivalent_covered_failures.append({
                "url": url, "owner": owner, "kind": kind, "alternate_url": equivalent.get("url"),
                "resolved_url": equivalent.get("resolved_url"), "coverage_type": "full_primary_equivalent",
            })
        elif url in errors and structured:
            row.update({
                "consecutive_failures": 0, "first_failure_at": None, "last_success_at": stamp,
                "last_failure_at": stamp, "status": "ok_via_official_structured_primary",
                "alternate_url": structured.get("api_endpoint"), "alternate_checked_at": structured.get("checked_at"),
                "coverage_type": "full_primary_structured_equivalent",
                "structured_source_id": structured.get("source_id"),
                "structured_item_count": structured.get("item_count"),
            })
            row.pop("alternate_resolved_url", None)
            structured_covered_failures.append({
                "url": url, "owner": owner, "kind": kind,
                "structured_source_id": structured.get("source_id"),
                "item_count": structured.get("item_count"),
                "coverage_type": "full_primary_structured_equivalent",
            })
        elif url in errors and alternate:
            row.update({
                "consecutive_failures": 0, "first_failure_at": None, "last_success_at": stamp,
                "last_failure_at": stamp, "status": "ok_via_official_feed",
                "alternate_url": alternate.get("url"), "alternate_checked_at": alternate.get("checked_at"),
                "coverage_type": "discovery_only_official_feed",
            })
            row.pop("alternate_resolved_url", None)
            feed_covered_failures.append({
                "url": url, "owner": owner, "kind": kind, "alternate_url": alternate.get("url"),
                "coverage_type": "discovery_only_official_feed",
            })
        elif url in errors:
            failures = int(row.get("consecutive_failures") or 0) + 1
            row.update({
                "consecutive_failures": failures,
                "first_failure_at": row.get("first_failure_at") or stamp,
                "last_failure_at": stamp,
                "status": "persistent_failure" if failures >= PERSISTENT_FAILURE_RUNS else "transient_failure",
            })
            for key in ("alternate_url", "alternate_checked_at", "alternate_resolved_url", "coverage_type", "structured_source_id", "structured_item_count"):
                row.pop(key, None)
            uncovered_failures.append({
                "url": url, "owner": owner, "kind": kind, "status": row["status"], "consecutive_failures": failures,
            })
        else:
            row.update({"consecutive_failures": 0, "first_failure_at": None, "last_success_at": stamp, "status": "ok"})
            for key in ("alternate_url", "alternate_checked_at", "alternate_resolved_url", "coverage_type", "structured_source_id", "structured_item_count"):
                row.pop(key, None)
        records[url] = row

    for url, row in list(records.items()):
        if url not in active_urls:
            copy = dict(row)
            copy["status"] = "retired"
            records[url] = copy

    persistent = [row for row in records.values() if row.get("status") == "persistent_failure"]
    covered_failures = feed_covered_failures + equivalent_covered_failures + structured_covered_failures
    return {
        "version": 6,
        "generated_at": stamp,
        "persistent_failure_threshold_runs": PERSISTENT_FAILURE_RUNS,
        "raw_failure_count": len(covered_failures) + len(uncovered_failures),
        "covered_failure_count": len(covered_failures),
        "uncovered_failure_count": len(uncovered_failures),
        "alternate_official_feed_coverage_count": len(feed_covered_failures),
        "equivalent_primary_coverage_count": len(equivalent_covered_failures),
        "structured_primary_coverage_count": len(structured_covered_failures),
        "covered_failures": sorted(covered_failures, key=lambda row: str(row.get("url") or "")),
        "uncovered_failures": sorted(uncovered_failures, key=lambda row: str(row.get("url") or "")),
        "persistent_failure_count": len(persistent),
        "persistent_failures": sorted([
            {
                "url": row.get("url"), "owner": row.get("owner"), "kind": row.get("kind"),
                "consecutive_failures": row.get("consecutive_failures"),
                "first_failure_at": row.get("first_failure_at"), "last_failure_at": row.get("last_failure_at"),
            }
            for row in persistent
        ], key=lambda row: str(row.get("url") or "")),
        "sources": records,
    }


def main() -> None:
    base = ROOT / "research" / "veille"
    previous = load_json(base / "source-health.json", {})
    watch_state = load_json(base / "state.json", {})
    day = datetime.now(timezone.utc).date().isoformat()
    errors = current_error_urls(base / f"{day}.jsonl") | http_error_urls(watch_state)
    alternates = healthy_direct_feed_coverage(watch_state)
    equivalents = healthy_equivalent_primary_coverage(watch_state)
    structured = healthy_structured_primary_coverage(watch_state)
    payload = update_records(
        previous, collect_official_targets(), errors, iso_now(),
        alternate_coverage=alternates,
        equivalent_coverage=equivalents,
        structured_coverage=structured,
    )
    (base / "source-health.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        f"Official source health: {payload['persistent_failure_count']} persistent failure(s), "
        f"{payload['uncovered_failure_count']} uncovered warning(s), "
        f"{payload['equivalent_primary_coverage_count']} equivalent URL(s), "
        f"{payload['structured_primary_coverage_count']} structured primary coverage(s), "
        f"{payload['alternate_official_feed_coverage_count']} official feed coverage(s)"
    )


if __name__ == "__main__":
    main()
