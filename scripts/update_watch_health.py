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


def main() -> None:
    base = ROOT / "research" / "veille"
    state = load_json(base / "state.json", {})
    promotion = load_json(base / "promotion-state.json", {})
    social_promotion = load_json(base / "social-promotion-state.json", {})
    previous = load_json(base / "health.json", {})

    source_states = list((promotion.get("sources") or {}).values())
    social_states = list((social_promotion.get("events") or {}).values())
    technical_errors = sum(1 for row in source_states + social_states if row.get("status") == "technical_error")
    partial_sources = sum(1 for row in source_states if row.get("status") == "partial")
    deferred_sources = sum(1 for row in source_states if row.get("status") == "deferred")
    pending_work = partial_sources + deferred_sources + technical_errors

    gemini_available = os.environ.get("GEMINI_AVAILABLE", "true").strip().lower() == "true"
    if gemini_available:
        gemini_unavailable_since = None
    elif previous.get("gemini_available") is False and previous.get("gemini_unavailable_since"):
        gemini_unavailable_since = previous["gemini_unavailable_since"]
    else:
        gemini_unavailable_since = iso_now()

    collection_at = state.get("last_run_at") or iso_now()
    reasons = []
    if not gemini_available:
        reasons.append("gemini_unavailable_promotion_deferred")
    if technical_errors:
        reasons.append(f"{technical_errors}_technical_retry_pending")
    if state.get("last_run_error_count"):
        reasons.append(f"{state.get('last_run_error_count')}_official_source_warning(s)")

    health = {
        "version": 1,
        "generated_at": iso_now(),
        "status": "healthy" if not reasons else "degraded",
        "last_collection_success_at": collection_at,
        "last_gdelt_run_at": state.get("last_gdelt_run_at"),
        "last_social_run_at": state.get("last_social_run_at"),
        "last_promotion_run_at": promotion.get("last_run_at"),
        "last_social_promotion_run_at": social_promotion.get("last_run_at"),
        "gemini_available": gemini_available,
        "gemini_unavailable_since": gemini_unavailable_since,
        "official_source_warnings_last_run": int(state.get("last_run_error_count") or 0),
        "promotion_technical_retries_pending": technical_errors,
        "partial_sources_pending": partial_sources,
        "deferred_sources_pending": deferred_sources,
        "pending_work": pending_work,
        "reasons": reasons,
    }
    base.mkdir(parents=True, exist_ok=True)
    (base / "health.json").write_text(json.dumps(health, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Watch health: {health['status']} | pending={pending_work} | "
        f"Gemini={'ok' if gemini_available else 'deferred'}"
    )


if __name__ == "__main__":
    main()
