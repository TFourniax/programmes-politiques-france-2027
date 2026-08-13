#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import ROOT


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def parse_timestamp(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def later_verified_sources(promotion: dict[str, Any]) -> dict[str, datetime]:
    """Latest canonical verification timestamp by exact primary-source URL."""
    latest: dict[str, datetime] = {}
    for record in (promotion.get("claim_fingerprints") or {}).values():
        if not isinstance(record, dict):
            continue
        url = str(record.get("source_url") or "").strip()
        verified_at = parse_timestamp(record.get("verified_at"))
        if not url or verified_at is None:
            continue
        if url not in latest or verified_at > latest[url]:
            latest[url] = verified_at
    return latest


def recovered_technical_error(row: dict[str, Any], verified_by_url: dict[str, datetime]) -> bool:
    if row.get("status") != "technical_error":
        return False
    url = str(row.get("url") or "").strip()
    failed_at = parse_timestamp(row.get("processed_at"))
    later_verified = verified_by_url.get(url)
    return bool(url and failed_at is not None and later_verified is not None and later_verified > failed_at)


def build_health(
    state: dict[str, Any],
    promotion: dict[str, Any],
    social_promotion: dict[str, Any],
    previous: dict[str, Any],
    gemini_available: bool,
    generated_at: str | None = None,
    source_health: dict[str, Any] | None = None,
    gemini_reason: str | None = None,
) -> dict[str, Any]:
    stamp = generated_at or iso_now()
    source_health = source_health or {}
    source_states = list((promotion.get("sources") or {}).values())
    social_states = list((social_promotion.get("events") or {}).values())

    verified_by_url = later_verified_sources(promotion)
    recovered_source_errors = sum(
        1 for row in source_states
        if isinstance(row, dict) and recovered_technical_error(row, verified_by_url)
    )
    unresolved_source_errors = sum(
        1 for row in source_states
        if isinstance(row, dict)
        and row.get("status") == "technical_error"
        and not recovered_technical_error(row, verified_by_url)
    )
    social_technical_errors = sum(
        1 for row in social_states
        if isinstance(row, dict) and row.get("status") == "technical_error"
    )
    technical_errors = unresolved_source_errors + social_technical_errors

    partial_sources = sum(1 for row in source_states if isinstance(row, dict) and row.get("status") == "partial")
    deferred_sources = sum(1 for row in source_states if isinstance(row, dict) and row.get("status") == "deferred")
    persistent_source_failures = int(source_health.get("persistent_failure_count") or 0)
    raw_source_warnings = int(source_health.get("raw_failure_count", state.get("last_run_error_count") or 0) or 0)
    covered_source_warnings = int(source_health.get("covered_failure_count") or 0)
    uncovered_source_warnings = int(source_health.get("uncovered_failure_count", state.get("last_run_error_count") or 0) or 0)
    structured_coverage = int(source_health.get("structured_primary_coverage_count") or 0)
    pending_work = partial_sources + deferred_sources + technical_errors

    if gemini_available:
        gemini_unavailable_since = None
    elif previous.get("gemini_available") is False and previous.get("gemini_unavailable_since"):
        gemini_unavailable_since = previous["gemini_unavailable_since"]
    else:
        gemini_unavailable_since = stamp

    collection_at = state.get("last_run_at") or stamp
    reasons: list[str] = []
    warnings: list[str] = []
    if not gemini_available:
        reasons.append("gemini_unavailable_promotion_deferred")
    if technical_errors:
        reasons.append(f"{technical_errors}_technical_retry_pending")
    if persistent_source_failures:
        reasons.append(f"{persistent_source_failures}_persistent_official_source_failure(s)")
    if uncovered_source_warnings and not persistent_source_failures:
        warnings.append(f"{uncovered_source_warnings}_transient_uncovered_official_source_warning(s)")

    return {
        "version": 6,
        "generated_at": stamp,
        "status": "healthy" if not reasons else "degraded",
        "last_collection_success_at": collection_at,
        "last_direct_feed_run_at": state.get("last_direct_feed_run_at"),
        "last_structured_primary_run_at": state.get("last_structured_primary_run_at"),
        "last_gdelt_run_at": state.get("last_gdelt_run_at"),
        "last_social_run_at": state.get("last_social_run_at"),
        "last_promotion_run_at": promotion.get("last_run_at"),
        "last_social_promotion_run_at": social_promotion.get("last_run_at"),
        "gemini_available": gemini_available,
        "gemini_unavailable_since": gemini_unavailable_since,
        "gemini_unavailable_reason": None if gemini_available else (gemini_reason or "unknown"),
        "official_source_warnings_last_run": raw_source_warnings,
        "covered_official_source_warnings_last_run": covered_source_warnings,
        "uncovered_official_source_warnings_last_run": uncovered_source_warnings,
        "alternate_official_feed_coverage_count": int(source_health.get("alternate_official_feed_coverage_count") or 0),
        "official_sitemap_coverage_count": int(source_health.get("official_sitemap_coverage_count") or 0),
        "equivalent_primary_coverage_count": int(source_health.get("equivalent_primary_coverage_count") or 0),
        "structured_primary_coverage_count": structured_coverage,
        "persistent_official_source_failures": persistent_source_failures,
        "persistent_official_source_failure_details": source_health.get("persistent_failures") or [],
        "promotion_technical_retries_pending": technical_errors,
        "recovered_promotion_technical_failures": recovered_source_errors,
        "partial_sources_pending": partial_sources,
        "deferred_sources_pending": deferred_sources,
        "pending_work": pending_work,
        "reasons": reasons,
        "warnings": warnings,
    }


def main() -> None:
    base = ROOT / "research" / "veille"
    state = load_json(base / "state.json", {})
    promotion = load_json(base / "promotion-state.json", {})
    social_promotion = load_json(base / "social-promotion-state.json", {})
    source_health = load_json(base / "source-health.json", {})
    previous = load_json(base / "health.json", {})
    gemini_available = os.environ.get("GEMINI_AVAILABLE", "true").strip().lower() == "true"
    gemini_reason = os.environ.get("GEMINI_REASON", "").strip() or None

    health = build_health(
        state, promotion, social_promotion, previous, gemini_available,
        source_health=source_health, gemini_reason=gemini_reason,
    )
    base.mkdir(parents=True, exist_ok=True)
    (base / "health.json").write_text(json.dumps(health, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Watch health: {health['status']} | pending={health['pending_work']} | "
        f"recovered_technical={health['recovered_promotion_technical_failures']} | "
        f"persistent_sources={health['persistent_official_source_failures']} | "
        f"transient_uncovered={health['uncovered_official_source_warnings_last_run']} | "
        f"structured_coverage={health['structured_primary_coverage_count']} | "
        f"Gemini={'ok' if gemini_available else 'deferred'}"
    )


if __name__ == "__main__":
    main()
