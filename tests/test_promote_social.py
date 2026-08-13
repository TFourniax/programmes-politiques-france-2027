from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import auto_promote  # noqa: E402
import auto_promote_canonical_runner as canonical_runner  # noqa: E402
import promote_social  # noqa: E402


def test_verified_social_promotion_reuses_canonical_duplicate_reconciliation(monkeypatch):
    event = {
        "event_type": "official_social_post",
        "platform": "x",
        "entity_id": "alice",
        "entity_name": "Alice Martin",
        "url": "https://social.example/alice/status/1",
        "published_at": "2026-08-13T08:00:00+00:00",
        "observed_at": "2026-08-13T08:05:00+00:00",
        "excerpt": "Je confirme une mesure politique précise déjà annoncée dans mon programme sur les retraites.",
        "identity_verification_state": "verified",
        "source_tier": "tier_1_primary_official",
    }
    candidates = {"alice": {"name": "Alice Martin"}}
    parties = {}
    captured = {}

    def fake_promote(adapted, session, api_key, config, canonical_state, entities, candidate_store, party_store, registries):
        captured["owner"] = adapted["owner"]
        captured["gemini_is_canonical"] = auto_promote.gemini is canonical_runner.traced_gemini
        source = auto_promote.fetch_source(session, adapted["url"], 4000)
        captured["source"] = source
        captured["allowed"] = auto_promote.allowed_entities("alice", "candidate", candidate_store, party_store)
        return {"url": adapted["url"], "status": "no_canonical_data", "sha256": source["sha256"]}

    def fake_reconcile(adapted, result, canonical_state, candidate_store, party_store):
        captured["reconciled"] = True
        captured["trace_source"] = canonical_runner.TRACE["sources"].get(adapted["url"])
        return {**result, "status": "promoted", "provenance_updates": ["claim-1"]}

    original_gemini = auto_promote.gemini
    original_fetch = auto_promote.fetch_source
    original_allowed = auto_promote.allowed_entities
    monkeypatch.setattr(auto_promote, "promote", fake_promote)
    monkeypatch.setattr(canonical_runner, "reconcile_confirmations", fake_reconcile)

    result = promote_social.promote_event(
        event,
        session=object(),
        api_key="test-key",
        config={"max_source_chars": 4000},
        canonical_state={},
        entities={},
        candidates=candidates,
        parties=parties,
        registries={},
    )

    assert result["status"] == "promoted"
    assert result["provenance_updates"] == ["claim-1"]
    assert captured["owner"] == "Alice Martin"
    assert captured["gemini_is_canonical"] is True
    assert captured["allowed"] == [{"id": "alice", "type": "candidate", "name": "Alice Martin"}]
    assert captured["source"]["text"].startswith("Je confirme une mesure politique précise")
    assert captured["trace_source"]["sha256"] == captured["source"]["sha256"]
    assert auto_promote.gemini is original_gemini
    assert auto_promote.fetch_source is original_fetch
    assert auto_promote.allowed_entities is original_allowed
