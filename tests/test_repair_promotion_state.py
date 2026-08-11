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
