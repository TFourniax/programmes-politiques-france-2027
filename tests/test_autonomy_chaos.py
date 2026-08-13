from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from check_watch_health import health_failures  # noqa: E402
from update_watch_health import build_health  # noqa: E402

NOW = datetime(2026, 8, 13, 20, 0, tzinfo=timezone.utc)


def deadman(payload):
    return health_failures(
        payload,
        now=NOW,
        max_age_hours=10,
        max_gemini_outage_hours=24,
        max_retry_backlog_age_hours=48,
    )[0]


def test_chaos_quota_exhaustion_keeps_collection_nominal():
    health = build_health(
        {"last_run_at": (NOW - timedelta(hours=1)).isoformat()},
        {}, {}, {}, False,
        generated_at=NOW.isoformat(),
        source_health={},
        gemini_reason="http_429_rate_limit_or_quota",
    )
    assert health["status"] == "healthy"
    assert deadman(health) == []


def test_chaos_provider_failure_eventually_pages():
    health = build_health(
        {"last_run_at": (NOW - timedelta(hours=1)).isoformat()},
        {}, {}, {
            "gemini_available": False,
            "gemini_unavailable_since": (NOW - timedelta(hours=30)).isoformat(),
        }, False,
        generated_at=NOW.isoformat(),
        source_health={},
        gemini_reason="network_or_provider_error",
    )
    assert health["status"] == "degraded"
    assert any("Gemini promotion" in item for item in deadman(health))


def test_chaos_old_retry_and_uncovered_source_are_actionable():
    promotion = {
        "sources": {
            "retry": {
                "status": "technical_error",
                "processed_at": (NOW - timedelta(hours=60)).isoformat(),
                "attempts": 8,
                "reason": "network timeout",
            }
        }
    }
    health = build_health(
        {"last_run_at": (NOW - timedelta(hours=1)).isoformat()},
        promotion, {}, {}, True,
        generated_at=NOW.isoformat(),
        source_health={
            "persistent_failure_count": 1,
            "persistent_failures": [{"owner": "Source Test"}],
        },
    )
    failures = deadman(health)
    assert any("oldest actionable promotion retry" in item for item in failures)
    assert any("official source" in item for item in failures)
    assert any("exhausted retry budget" in item for item in failures)
