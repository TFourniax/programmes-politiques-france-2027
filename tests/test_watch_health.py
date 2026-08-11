from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from update_watch_health import build_health  # noqa: E402


def test_health_is_healthy_when_collection_and_provider_are_available():
    health = build_health(
        {"last_run_at": "2026-08-11T10:00:00+00:00", "last_run_error_count": 0},
        {"sources": {}, "last_run_at": "2026-08-11T10:01:00+00:00"},
        {"events": {}, "last_run_at": "2026-08-11T10:02:00+00:00"},
        {},
        True,
        generated_at="2026-08-11T10:03:00+00:00",
    )
    assert health["status"] == "healthy"
    assert health["pending_work"] == 0
    assert health["gemini_available"] is True


def test_provider_outage_degrades_but_does_not_invalidate_collection():
    health = build_health(
        {"last_run_at": "2026-08-11T10:00:00+00:00", "last_run_error_count": 0},
        {"sources": {}},
        {"events": {}},
        {},
        False,
        generated_at="2026-08-11T10:03:00+00:00",
    )
    assert health["status"] == "degraded"
    assert health["last_collection_success_at"] == "2026-08-11T10:00:00+00:00"
    assert health["gemini_unavailable_since"] == "2026-08-11T10:03:00+00:00"


def test_provider_outage_start_is_preserved_across_runs():
    health = build_health(
        {"last_run_at": "2026-08-11T16:00:00+00:00"},
        {"sources": {}},
        {"events": {}},
        {"gemini_available": False, "gemini_unavailable_since": "2026-08-11T10:03:00+00:00"},
        False,
        generated_at="2026-08-11T16:03:00+00:00",
    )
    assert health["gemini_unavailable_since"] == "2026-08-11T10:03:00+00:00"


def test_pending_retries_are_visible_without_stopping_health_updates():
    health = build_health(
        {"last_run_at": "2026-08-11T10:00:00+00:00"},
        {
            "sources": {
                "a": {"status": "technical_error"},
                "b": {"status": "partial"},
                "c": {"status": "deferred"},
            }
        },
        {"events": {"x": {"status": "technical_error"}}},
        {},
        True,
        generated_at="2026-08-11T10:03:00+00:00",
    )
    assert health["status"] == "degraded"
    assert health["pending_work"] == 4
    assert health["promotion_technical_retries_pending"] == 2


def test_persistent_official_source_failure_is_exposed_to_deadman():
    health = build_health(
        {"last_run_at": "2026-08-11T10:00:00+00:00"},
        {"sources": {}},
        {"events": {}},
        {},
        True,
        generated_at="2026-08-11T10:03:00+00:00",
        source_health={
            "persistent_failure_count": 1,
            "persistent_failures": [
                {"owner": "Parti Test", "url": "https://parti.fr/", "consecutive_failures": 4}
            ],
        },
    )
    assert health["status"] == "degraded"
    assert health["persistent_official_source_failures"] == 1
    assert health["persistent_official_source_failure_details"][0]["owner"] == "Parti Test"
