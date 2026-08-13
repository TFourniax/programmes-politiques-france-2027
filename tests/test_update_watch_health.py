from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from update_watch_health import build_health  # noqa: E402

STAMP = "2026-08-13T20:00:00+00:00"


def base_state():
    return {"last_run_at": "2026-08-13T19:30:00+00:00"}


def test_quota_only_gemini_is_warning_not_degraded():
    health = build_health(
        base_state(), {}, {}, {}, False,
        generated_at=STAMP,
        source_health={},
        gemini_reason="http_429_rate_limit_or_quota",
    )
    assert health["status"] == "healthy"
    assert health["gemini_quota_only"] is True
    assert "gemini_quota_exhausted_promotion_deferred" in health["warnings"]
    assert health["reasons"] == []


def test_non_quota_gemini_failure_is_degraded():
    health = build_health(
        base_state(), {}, {}, {}, False,
        generated_at=STAMP,
        source_health={},
        gemini_reason="network_or_provider_error",
    )
    assert health["status"] == "degraded"
    assert "gemini_unavailable_promotion_deferred" in health["reasons"]


def test_quota_related_retry_does_not_become_actionable_or_red():
    promotion = {
        "sources": {
            "a": {
                "status": "technical_error",
                "processed_at": "2026-08-01T10:00:00+00:00",
                "attempts": 20,
                "reason": "Gemini HTTP 429 quota exhausted",
            }
        }
    }
    health = build_health(
        base_state(), promotion, {}, {}, False,
        generated_at=STAMP,
        source_health={},
        gemini_reason="http_429_rate_limit_or_quota",
    )
    assert health["status"] == "healthy"
    assert health["promotion_technical_retries_pending"] == 1
    assert health["promotion_quota_retries_pending"] == 1
    assert health["promotion_actionable_retries_pending"] == 0
    assert health["oldest_promotion_retry_age_hours"] == 0


def test_actionable_retry_exposes_age_and_budget():
    promotion = {
        "sources": {
            "a": {
                "status": "technical_error",
                "processed_at": "2026-08-10T10:00:00+00:00",
                "attempts": 7,
                "reason": "network timeout",
            }
        }
    }
    health = build_health(
        base_state(), promotion, {}, {}, True,
        generated_at=STAMP, source_health={},
    )
    assert health["status"] == "degraded"
    assert health["promotion_actionable_retries_pending"] == 1
    assert health["oldest_promotion_retry_age_hours"] > 48
    assert health["promotion_retries_over_budget"] == 1
    assert "promotion_retry_backlog_over_48h" in health["reasons"]
    assert "1_promotion_retry_over_budget" in health["reasons"]


def test_persistent_uncovered_source_remains_degraded_during_quota_outage():
    health = build_health(
        base_state(), {}, {}, {}, False,
        generated_at=STAMP,
        source_health={
            "persistent_failure_count": 1,
            "persistent_failures": [{"owner": "Source Test"}],
        },
        gemini_reason="http_429_rate_limit_or_quota",
    )
    assert health["status"] == "degraded"
    assert "1_persistent_official_source_failure(s)" in health["reasons"]
