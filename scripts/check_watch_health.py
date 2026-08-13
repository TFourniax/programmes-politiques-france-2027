#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from typing import Any

from common import ROOT

QUOTA_ONLY_REASONS = {"http_429_rate_limit_or_quota"}


def parse_instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def health_failures(
    health: dict[str, Any],
    *,
    now: datetime,
    max_age_hours: float,
    max_gemini_outage_hours: float,
    max_retry_backlog_age_hours: float = 48.0,
) -> tuple[list[str], dict[str, float | int | str | bool | None]]:
    failures: list[str] = []

    try:
        collection = parse_instant(health.get("last_collection_success_at"))
        age_hours = (now - collection).total_seconds() / 3600
    except (TypeError, ValueError):
        age_hours = float("inf")
    if age_hours > max_age_hours:
        failures.append(f"last successful collection is {age_hours:.1f}h old")

    outage_hours = 0.0
    gemini_reason = str(health.get("gemini_unavailable_reason") or "unknown")
    quota_only = health.get("gemini_available") is False and (
        gemini_reason in QUOTA_ONLY_REASONS or health.get("gemini_quota_only") is True
    )
    if health.get("gemini_available") is False and health.get("gemini_unavailable_since"):
        since = parse_instant(health["gemini_unavailable_since"])
        outage_hours = (now - since).total_seconds() / 3600
        if outage_hours > max_gemini_outage_hours and not quota_only:
            failures.append(
                f"Gemini promotion has been unavailable for {outage_hours:.1f}h ({gemini_reason})"
            )

    persistent = int(health.get("persistent_official_source_failures") or 0)
    if persistent:
        owners = [
            str(row.get("owner") or row.get("url") or "source inconnue")
            for row in (health.get("persistent_official_source_failure_details") or [])[:5]
        ]
        failures.append(
            f"{persistent} official source(s) failed for multiple consecutive runs"
            + (f" ({', '.join(owners)})" if owners else "")
        )

    retry_count = int(
        health.get("promotion_actionable_retries_pending")
        if health.get("promotion_actionable_retries_pending") is not None
        else health.get("promotion_technical_retries_pending") or 0
    )
    retry_age = float(health.get("oldest_promotion_retry_age_hours") or 0.0)
    retries_over_budget = int(health.get("promotion_retries_over_budget") or 0)
    if retry_count and retry_age > max_retry_backlog_age_hours:
        failures.append(
            f"oldest actionable promotion retry is {retry_age:.1f}h old "
            f"(limit {max_retry_backlog_age_hours:.1f}h)"
        )
    if retries_over_budget:
        failures.append(f"{retries_over_budget} promotion retry item(s) exhausted retry budget")

    details: dict[str, float | int | str | bool | None] = {
        "collection_age_hours": age_hours,
        "gemini_outage_hours": outage_hours,
        "gemini_reason": gemini_reason,
        "gemini_quota_only": quota_only,
        "persistent_sources": persistent,
        "retry_backlog_count": retry_count,
        "retry_backlog_age_hours": retry_age,
        "retries_over_budget": retries_over_budget,
    }
    return failures, details


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-age-hours", type=float, default=10.0)
    parser.add_argument("--max-gemini-outage-hours", type=float, default=24.0)
    parser.add_argument("--max-retry-backlog-age-hours", type=float, default=48.0)
    args = parser.parse_args()

    path = ROOT / "research" / "veille" / "health.json"
    if not path.exists():
        raise SystemExit("WATCH_HEALTH_FAILURE: health.json is missing")
    try:
        health = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"WATCH_HEALTH_FAILURE: invalid health.json: {exc}") from exc

    failures, details = health_failures(
        health,
        now=datetime.now(timezone.utc),
        max_age_hours=args.max_age_hours,
        max_gemini_outage_hours=args.max_gemini_outage_hours,
        max_retry_backlog_age_hours=args.max_retry_backlog_age_hours,
    )
    if failures:
        raise SystemExit("WATCH_HEALTH_FAILURE: " + "; ".join(failures))

    print(
        "WATCH_HEALTH_OK: "
        f"collection_age={details['collection_age_hours']:.1f}h, status={health.get('status')}, "
        f"pending={health.get('pending_work', 0)}, actionable_retries={details['retry_backlog_count']}, "
        f"oldest_retry={details['retry_backlog_age_hours']:.1f}h, "
        f"persistent_sources={details['persistent_sources']}, "
        f"gemini={health.get('gemini_available')}, reason={details['gemini_reason']}, "
        f"quota_only={details['gemini_quota_only']}"
    )


if __name__ == "__main__":
    main()
