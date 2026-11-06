from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from repair_promotion_state import repair_state  # noqa: E402


def test_stale_fingerprint_for_deleted_proposal_is_removed():
    state = {
        "claim_fingerprints": {
            "dead": {
                "proposal_id": "proposal-deleted",
                "source_url": "https://parti.fr/programme-2027/",
            },
            "live": {
                "proposal_id": "proposal-live",
                "source_url": "https://parti.fr/programme-2027/",
            },
        },
        "sources": {},
    }
    repaired, stats = repair_state(state, {"proposal-live"})
    assert "dead" not in repaired["claim_fingerprints"]
    assert "live" in repaired["claim_fingerprints"]
    assert stats["removed_fingerprints"] == 1


def test_old_election_fingerprint_and_source_are_quarantined():
    url = "https://parti.fr/programme-europeennes-2024-mesure-9/"
    state = {
        "claim_fingerprints": {
            "old": {"proposal_id": "proposal-live", "source_url": url},
        },
        "sources": {
            "source-key": {"status": "promoted", "url": url, "reason": None},
        },
    }
    repaired, stats = repair_state(state, {"proposal-live"})
    assert "old" not in repaired["claim_fingerprints"]
    assert repaired["sources"]["source-key"]["status"] == "historical_skipped"
    assert repaired["sources"]["source-key"]["reason"] == "explicit_old_election_context"
    assert stats == {"removed_fingerprints": 1, "historical_sources_reclassified": 1}


from repair_promotion_state import retire_dead_retries  # noqa: E402

STAMP = "2026-11-06T10:00:00+00:00"


def technical(attempts, error, next_retry_at):
    return {
        "url": "https://parti.fr/page/",
        "status": "technical_error",
        "processed_at": "2026-10-17T16:35:13+00:00",
        "error": error,
        "attempts": attempts,
        "next_retry_at": next_retry_at,
    }


def test_permanent_error_over_retry_budget_is_closed():
    records = {"k": technical(7, "ValueError: HTTP 403", "2026-10-31T16:35:13+00:00")}
    repaired, stats = retire_dead_retries(records, last_run_at="2026-10-25T17:11:52+00:00", stamp=STAMP)
    row = repaired["k"]
    assert row["status"] == "retry_abandoned"
    assert row["reason"] == "permanent_error_retry_budget_exhausted"
    assert row["error"] == "ValueError: HTTP 403" and row["attempts"] == 7
    assert "next_retry_at" not in row and row["abandoned_at"] == STAMP
    assert stats == {"exhausted_permanent_retries": 1, "stale_retries": 0}


def test_permanent_error_within_budget_keeps_retrying():
    records = {"k": technical(2, "ValueError: HTTP 404", "2026-10-28T00:00:00+00:00")}
    repaired, stats = retire_dead_retries(records, last_run_at="2026-10-25T17:11:52+00:00", stamp=STAMP)
    assert repaired["k"]["status"] == "technical_error"
    assert stats == {"exhausted_permanent_retries": 0, "stale_retries": 0}


def test_transient_error_over_budget_stays_actionable():
    records = {"k": technical(7, "RuntimeError: Gemini HTTP 503", "2026-10-31T16:35:13+00:00")}
    repaired, _ = retire_dead_retries(records, last_run_at="2026-10-25T17:11:52+00:00", stamp=STAMP)
    assert repaired["k"]["status"] == "technical_error"


def test_retry_never_rescheduled_while_runner_kept_running_is_closed():
    records = {"k": technical(1, "ReadTimeout: read timed out", "2026-08-25T20:22:40+00:00")}
    repaired, stats = retire_dead_retries(records, last_run_at="2026-10-25T17:11:52+00:00", stamp=STAMP)
    assert repaired["k"]["status"] == "retry_abandoned"
    assert repaired["k"]["reason"] == "retry_never_rescheduled"
    assert stats == {"exhausted_permanent_retries": 0, "stale_retries": 1}


def test_runner_outage_does_not_close_overdue_retries():
    # The runner itself has not run since shortly after the retry became due
    # (e.g. Actions outage): the retry must get its chance when runs resume.
    records = {"k": technical(1, "ReadTimeout: read timed out", "2026-10-24T00:00:00+00:00")}
    repaired, _ = retire_dead_retries(records, last_run_at="2026-10-25T17:11:52+00:00", stamp=STAMP)
    assert repaired["k"]["status"] == "technical_error"


def test_abandoned_retries_are_terminal_for_runners():
    import auto_promote

    assert "retry_abandoned" in auto_promote.TERMINAL_SOURCE_STATES
