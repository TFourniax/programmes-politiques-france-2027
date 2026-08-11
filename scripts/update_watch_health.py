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


def build_health(
    state: dict[str, Any],
    promotion: dict[str, Any],
    social_promotion: dict[str, Any],
    previous: dict[str, Any],
    gemini_available: bool,
    generated_at: str | None = None,
    source_health: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stamp = generated_at or iso_now()
    source_health = source_health or {}
    source_states = list((promotion.get("sources") or {}).values())
    social_states = list((social_promotion.get("events") or {}).values())
    technical_errors = sum(1 for row in source_states + social_states if row.get("status") == "technical_error")
    partial_sources = sum(1 for row in source_states if row.get("status") == "partial")
    deferred_sources = sum(1 for row in source_states if row.get("status") == "deferred")
    persistent_source_failures = int(source_health.get("persistent_failure_count") or 0)
    pending_work = partial_sources + deferred_sources + technical_errors

    if gemini_available:
        gemini_unavailable_since = None
    elif previous.get("gemini_available") is False and previous.get("gemini_unavailable_since"):
        gemini_unavailable_since = previous["gemini_unavailable_since"]
    else:
        gemini_unavailable_since = stamp

    collection_at = state.get("last_run_at") or stamp
    reasons = []
    if not gemini_available:
        reasons.append("gemini_unavailable_promotion_deferred")
    if technical_errors:
        reasons.append(f"{technical_errors}_technical_retry_pending")
    if persistent_source_failures:
        reasons.append(f"{persistent_source_failures}_persistent_official_source_failure(s)")
    if state.get("last_run_error_count"):
        reasons.append(f"{state.get('last_run_error_count')}_official_source_warning(s)")

    return {
        "version": 1,
        "generated_at": stamp,
        "status": "healthy" if not reasons else "degraded",
        "last_collection_success_at": collection_at,
        "last_gdelt_run_at": state.get("last_gdelt_run_at"),
        "last_social_run_at": state.get("last_social_run_at"),
        "last_promotion_run_at": promotion.get("last_run_at"),
        "last_social_promotion_run_at": social_promotion.get("last_run_at"),
        "gemini_available": gemini_available,
        "gemini_unavailable_since": gemini_unavailable_since,
        "official_source_warnings_last_run": int(state.get("last_run_error_count") or 0),
        "persistent_official_source_failures": persistent_source_failures,
        "persistent_official_source_failure_details": source_health.get("persistent_failures") or [],
        "promotion_technical_retries_pending": technical_errors,
        "partial_sources_pending": partial_sources,
        "deferred_sources_pending": deferred_sources,
        "pending_work": pending_work,
        "reasons": reasons,
    }


def main() -> None:
    base = ROOT / "research" / "veille"
    state = load_json(base / "state.json", {})
    promotion = load_json(base / "promotion-state.json", {})
    social_promotion = load_json(base / "social-promotion-state.json", {})
    source_health = load_json(base / "source-health.json", {})
    previous = load_json(base / "health.json", {})
    gemini_available = os.environ.get("GEMINI_AVAILABLE", "true").strip().lower() == "true"

    health = build_health(
        state, promotion, social_promotion, previous, gemini_available,
        source_health=source_health,
    )
    base.mkdir(parents=True, exist_ok=True)
    (base / "health.json").write_text(json.dumps(health, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Watch health: {health['status']} | pending={health['pending_work']} | "
        f"persistent_sources={health['persistent_official_source_failures']} | "
        f"Gemini={'ok' if gemini_available else 'deferred'}"
    )


if __name__ == "__main__":
    main()
