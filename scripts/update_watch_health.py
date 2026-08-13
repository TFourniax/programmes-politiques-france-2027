#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import ROOT

QUOTA_ONLY_REASONS = {"http_429_rate_limit_or_quota"}
QUOTA_RETRY_TOKENS = ("429", "quota", "rate_limit", "rate limit", "resource_exhausted")
RETRY_BACKLOG_SLO_HOURS = 48.0
RETRY_ATTEMPT_BUDGET = 6


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


def quota_related_retry(row: dict[str, Any]) -> bool:
    reason = str(row.get("reason") or row.get("error") or "").lower()
    return any(token in reason for token in QUOTA_RETRY_TOKENS)


def retry_metrics(rows: list[dict[str, Any]], *, now: datetime) -> dict[str, float | int]:
    technical = [row for row in rows if row.get("status") == "technical_error"]
    quota_rows = [row for row in technical if quota_related_retry(row)]
    actionable = [row for row in technical if not quota_related_retry(row)]
    ages: list[float] = []
    attempts: list[int] = []
    for row in actionable:
        failed_at = parse_timestamp(row.get("processed_at") or row.get("last_error_at"))
        if failed_at is not None:
            ages.append(max(0.0, (now - failed_at).total_seconds() / 3600))
        attempts.append(int(row.get("attempts") or 0))
    return {
        "total": len(technical),
        "quota": len(quota_rows),
        "actionable": len(actionable),
        "oldest_actionable_age_hours": max(ages) if ages else 0.0,
        "max_actionable_attempts": max(attempts) if attempts else 0,
        "over_attempt_budget": sum(1 for value in attempts if value >= RETRY_ATTEMPT_BUDGET),
    }


def build_health(state: dict[str, Any], promotion: dict[str, Any], social_promotion: dict[str, Any], previous: dict[str, Any], gemini_available: bool, generated_at: str | None = None, source_health: dict[str, Any] | None = None, gemini_reason: str | None = None) -> dict[str, Any]:
    stamp = generated_at or iso_now()
    now = parse_timestamp(stamp) or datetime.now(timezone.utc)
    source_health = source_health or {}
    source_states = [row for row in (promotion.get("sources") or {}).values() if isinstance(row, dict)]
    social_states = [row for row in (social_promotion.get("events") or {}).values() if isinstance(row, dict)]
    verified_by_url = later_verified_sources(promotion)
    recovered_source_errors = sum(1 for row in source_states if recovered_technical_error(row, verified_by_url))
    unresolved_source_rows = [row for row in source_states if row.get("status") == "technical_error" and not recovered_technical_error(row, verified_by_url)]
    social_technical_rows = [row for row in social_states if row.get("status") == "technical_error"]
    retry = retry_metrics(unresolved_source_rows + social_technical_rows, now=now)
    partial_sources = sum(1 for row in source_states if row.get("status") == "partial")
    deferred_sources = sum(1 for row in source_states if row.get("status") == "deferred")
    persistent_source_failures = int(source_health.get("persistent_failure_count") or 0)
    raw_source_warnings = int(source_health.get("raw_failure_count", state.get("last_run_error_count") or 0) or 0)
    covered_source_warnings = int(source_health.get("covered_failure_count") or 0)
    uncovered_source_warnings = int(source_health.get("uncovered_failure_count", state.get("last_run_error_count") or 0) or 0)
    structured_coverage = int(source_health.get("structured_primary_coverage_count") or 0)
    pending_work = partial_sources + deferred_sources + int(retry["total"])
    actionable_pending = partial_sources + deferred_sources + int(retry["actionable"])
    if gemini_available:
        gemini_unavailable_since = None
    elif previous.get("gemini_available") is False and previous.get("gemini_unavailable_since"):
        gemini_unavailable_since = previous["gemini_unavailable_since"]
    else:
        gemini_unavailable_since = stamp
    collection_at = state.get("last_run_at") or stamp
    normalized_gemini_reason = None if gemini_available else (gemini_reason or "unknown")
    gemini_quota_only = bool(not gemini_available and normalized_gemini_reason in QUOTA_ONLY_REASONS)
    reasons: list[str] = []
    warnings: list[str] = []
    if not gemini_available:
        if gemini_quota_only:
            warnings.append("gemini_quota_exhausted_promotion_deferred")
        else:
            reasons.append("gemini_unavailable_promotion_deferred")
    if retry["quota"]:
        warnings.append(f"{retry['quota']}_quota_retry_pending")
    if retry["actionable"]:
        reasons.append(f"{retry['actionable']}_technical_retry_pending")
        if float(retry["oldest_actionable_age_hours"]) > RETRY_BACKLOG_SLO_HOURS:
            reasons.append("promotion_retry_backlog_over_48h")
        if int(retry["over_attempt_budget"]) > 0:
            reasons.append(f"{retry['over_attempt_budget']}_promotion_retry_over_budget")
    if persistent_source_failures:
        reasons.append(f"{persistent_source_failures}_persistent_official_source_failure(s)")
    if uncovered_source_warnings and not persistent_source_failures:
        warnings.append(f"{uncovered_source_warnings}_transient_uncovered_official_source_warning(s)")
    return {
        "version": 7,
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
        "gemini_unavailable_reason": normalized_gemini_reason,
        "gemini_quota_only": gemini_quota_only,
        "official_source_warnings_last_run": raw_source_warnings,
        "covered_official_source_warnings_last_run": covered_source_warnings,
        "uncovered_official_source_warnings_last_run": uncovered_source_warnings,
        "alternate_official_feed_coverage_count": int(source_health.get("alternate_official_feed_coverage_count") or 0),
        "official_sitemap_coverage_count": int(source_health.get("official_sitemap_coverage_count") or 0),
        "equivalent_primary_coverage_count": int(source_health.get("equivalent_primary_coverage_count") or 0),
        "structured_primary_coverage_count": structured_coverage,
        "persistent_official_source_failures": persistent_source_failures,
        "persistent_official_source_failure_details": source_health.get("persistent_failures") or [],
        "promotion_technical_retries_pending": int(retry["total"]),
        "promotion_quota_retries_pending": int(retry["quota"]),
        "promotion_actionable_retries_pending": int(retry["actionable"]),
        "oldest_promotion_retry_age_hours": round(float(retry["oldest_actionable_age_hours"]), 3),
        "max_promotion_retry_attempts": int(retry["max_actionable_attempts"]),
        "promotion_retries_over_budget": int(retry["over_attempt_budget"]),
        "promotion_retry_slo_hours": RETRY_BACKLOG_SLO_HOURS,
        "promotion_retry_attempt_budget": RETRY_ATTEMPT_BUDGET,
        "recovered_promotion_technical_failures": recovered_source_errors,
        "partial_sources_pending": partial_sources,
        "deferred_sources_pending": deferred_sources,
        "pending_work": pending_work,
        "actionable_pending_work": actionable_pending,
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
    health = build_health(state, promotion, social_promotion, previous, gemini_available, source_health=source_health, gemini_reason=gemini_reason)
    base.mkdir(parents=True, exist_ok=True)
    (base / "health.json").write_text(json.dumps(health, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Watch health: {health['status']} | pending={health['pending_work']} | "
        f"actionable={health['actionable_pending_work']} | oldest_retry={health['oldest_promotion_retry_age_hours']:.1f}h | "
        f"recovered_technical={health['recovered_promotion_technical_failures']} | persistent_sources={health['persistent_official_source_failures']} | "
        f"transient_uncovered={health['uncovered_official_source_warnings_last_run']} | structured_coverage={health['structured_primary_coverage_count']} | "
        f"Gemini={'ok' if gemini_available else ('quota-only' if health['gemini_quota_only'] else 'deferred')}"
    )


if __name__ == "__main__":
    main()
