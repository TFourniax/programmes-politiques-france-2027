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
    assert health["recovered_promotion_technical_failures"] == 0


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
    assert health["recovered_promotion_technical_failures"] == 0


def test_old_technical_error_is_recovered_by_later_verified_canonical_evidence_same_url():
    url = "https://parti.fr/programme-2027/"
    health = build_health(
        {"last_run_at": "2026-08-12T15:00:00+00:00"},
        {
            "sources": {
                "old-event": {
                    "status": "technical_error",
                    "url": url,
                    "processed_at": "2026-08-11T12:14:59+00:00",
                    "error": "Connection reset by peer",
                    "next_retry_at": "2026-08-11T18:14:59+00:00",
                }
            },
            "claim_fingerprints": {
                "verified-later": {
                    "proposal_id": "proposal-live",
                    "source_url": url,
                    "verified_at": "2026-08-12T14:41:26+00:00",
                }
            },
        },
        {"events": {}},
        {},
        True,
        generated_at="2026-08-12T15:03:00+00:00",
    )
    assert health["status"] == "healthy"
    assert health["pending_work"] == 0
    assert health["promotion_technical_retries_pending"] == 0
    assert health["recovered_promotion_technical_failures"] == 1
    assert health["reasons"] == []


def test_technical_error_stays_pending_if_verification_is_not_later():
    url = "https://parti.fr/programme-2027/"
    health = build_health(
        {"last_run_at": "2026-08-12T15:00:00+00:00"},
        {
            "sources": {
                "newer-error": {
                    "status": "technical_error",
                    "url": url,
                    "processed_at": "2026-08-12T15:00:00+00:00",
                }
            },
            "claim_fingerprints": {
                "verified-before-error": {
                    "proposal_id": "proposal-live",
                    "source_url": url,
                    "verified_at": "2026-08-12T14:41:26+00:00",
                }
            },
        },
        {"events": {}},
        {},
        True,
        generated_at="2026-08-12T15:03:00+00:00",
    )
    assert health["status"] == "degraded"
    assert health["pending_work"] == 1
    assert health["promotion_technical_retries_pending"] == 1
    assert health["recovered_promotion_technical_failures"] == 0


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
            "uncovered_failure_count": 1,
            "raw_failure_count": 1,
            "persistent_failures": [
                {"owner": "Parti Test", "url": "https://parti.fr/", "consecutive_failures": 4}
            ],
        },
    )
    assert health["status"] == "degraded"
    assert health["persistent_official_source_failures"] == 1
    assert health["persistent_official_source_failure_details"][0]["owner"] == "Parti Test"


def test_raw_warning_fully_covered_by_official_feed_does_not_create_false_alarm():
    health = build_health(
        {"last_run_at": "2026-08-11T10:00:00+00:00", "last_run_error_count": 1},
        {"sources": {}},
        {"events": {}},
        {},
        True,
        generated_at="2026-08-11T10:03:00+00:00",
        source_health={
            "persistent_failure_count": 0,
            "raw_failure_count": 1,
            "covered_failure_count": 1,
            "uncovered_failure_count": 0,
            "alternate_official_feed_coverage_count": 1,
        },
    )
    assert health["status"] == "healthy"
    assert health["official_source_warnings_last_run"] == 1
    assert health["covered_official_source_warnings_last_run"] == 1
    assert health["uncovered_official_source_warnings_last_run"] == 0
    assert health["alternate_official_feed_coverage_count"] == 1
    assert health["reasons"] == []


def test_raw_warning_covered_by_equivalent_primary_url_stays_healthy():
    health = build_health(
        {
            "last_run_at": "2026-08-11T10:00:00+00:00",
            "last_direct_feed_run_at": "2026-08-11T09:59:00+00:00",
            "last_run_error_count": 1,
        },
        {"sources": {}},
        {"events": {}},
        {},
        True,
        generated_at="2026-08-11T10:03:00+00:00",
        source_health={
            "persistent_failure_count": 0,
            "raw_failure_count": 1,
            "covered_failure_count": 1,
            "uncovered_failure_count": 0,
            "equivalent_primary_coverage_count": 1,
            "alternate_official_feed_coverage_count": 0,
        },
    )
    assert health["status"] == "healthy"
    assert health["equivalent_primary_coverage_count"] == 1
    assert health["alternate_official_feed_coverage_count"] == 0
    assert health["last_direct_feed_run_at"] == "2026-08-11T09:59:00+00:00"
    assert health["reasons"] == []


def test_complete_structured_primary_coverage_is_observable_without_degrading_health():
    health = build_health(
        {
            "last_run_at": "2026-08-12T14:00:00+00:00",
            "last_structured_primary_run_at": "2026-08-12T14:01:00+00:00",
            "last_run_error_count": 2,
        },
        {"sources": {}},
        {"events": {}},
        {},
        True,
        generated_at="2026-08-12T14:03:00+00:00",
        source_health={
            "persistent_failure_count": 0,
            "raw_failure_count": 2,
            "covered_failure_count": 2,
            "uncovered_failure_count": 0,
            "structured_primary_coverage_count": 2,
        },
    )
    assert health["status"] == "healthy"
    assert health["structured_primary_coverage_count"] == 2
    assert health["last_structured_primary_run_at"] == "2026-08-12T14:01:00+00:00"
    assert health["covered_official_source_warnings_last_run"] == 2
    assert health["uncovered_official_source_warnings_last_run"] == 0
    assert health["reasons"] == []


def test_uncovered_transient_warning_still_degrades_health():
    health = build_health(
        {"last_run_at": "2026-08-11T10:00:00+00:00", "last_run_error_count": 1},
        {"sources": {}},
        {"events": {}},
        {},
        True,
        generated_at="2026-08-11T10:03:00+00:00",
        source_health={
            "persistent_failure_count": 0,
            "raw_failure_count": 1,
            "covered_failure_count": 0,
            "uncovered_failure_count": 1,
        },
    )
    assert health["status"] == "degraded"
    assert "1_uncovered_official_source_warning(s)" in health["reasons"]
