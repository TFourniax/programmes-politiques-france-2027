from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from check_watch_health import health_failures  # noqa: E402

NOW = datetime(2026, 8, 13, 16, 0, tzinfo=timezone.utc)


def base_health(**updates):
    payload = {
        "last_collection_success_at": "2026-08-13T15:00:00+00:00",
        "gemini_available": True,
        "gemini_unavailable_since": None,
        "gemini_unavailable_reason": None,
        "persistent_official_source_failures": 0,
        "persistent_official_source_failure_details": [],
    }
    payload.update(updates)
    return payload


def evaluate(payload):
    return health_failures(
        payload,
        now=NOW,
        max_age_hours=10,
        max_gemini_outage_hours=24,
    )


def test_free_tier_429_is_observable_but_not_deadman_failure():
    failures, details = evaluate(base_health(
        gemini_available=False,
        gemini_unavailable_since="2026-08-11T12:00:00+00:00",
        gemini_unavailable_reason="http_429_rate_limit_or_quota",
    ))
    assert failures == []
    assert details["gemini_quota_only"] is True
    assert details["gemini_outage_hours"] > 24


def test_bad_credentials_still_fail_after_outage_budget():
    failures, details = evaluate(base_health(
        gemini_available=False,
        gemini_unavailable_since="2026-08-11T12:00:00+00:00",
        gemini_unavailable_reason="http_401",
    ))
    assert any("Gemini promotion" in item for item in failures)
    assert details["gemini_quota_only"] is False


def test_stale_primary_collection_is_always_fatal_even_if_quota_only():
    failures, _ = evaluate(base_health(
        last_collection_success_at="2026-08-12T00:00:00+00:00",
        gemini_available=False,
        gemini_unavailable_since="2026-08-11T12:00:00+00:00",
        gemini_unavailable_reason="http_429_rate_limit_or_quota",
    ))
    assert any("last successful collection" in item for item in failures)


def test_persistent_official_source_failure_is_still_fatal():
    failures, _ = evaluate(base_health(
        persistent_official_source_failures=1,
        persistent_official_source_failure_details=[{"owner": "Parti Test"}],
    ))
    assert any("Parti Test" in item for item in failures)
