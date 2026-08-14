from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import auto_promote_canonical_runner as canonical_runner  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]


def reset_trace():
    canonical_runner.TRACE["current_url"] = None
    canonical_runner.TRACE["sources"] = {}
    canonical_runner.TRACE["confirmed"] = {}


def test_canonical_promotion_uses_public_topic_taxonomy():
    compass = json.loads((ROOT / "data" / "compass.json").read_text(encoding="utf-8"))
    expected = {row["id"] for row in compass["questions"]}
    assert canonical_runner.public_topics() == expected
    assert canonical_runner.auto_promote.TOPICS == expected
    assert "defense-international" in expected
    assert "numerique-ia" in expected


def test_extraction_url_and_verification_items_are_strictly_parsed():
    prompt = "URL: https://parti.example/programme ; propriétaire: Parti Test ; portion: 1/1"
    assert canonical_runner.extraction_url(prompt) == "https://parti.example/programme"
    items_prompt = (
        'Éléments: [{"kind":"claim","actor_id":"parti-test","topic":"retraites","statement":"Mesure"}]\n'
        "<<<CURRENT_CANONICAL>>>(vide)<<<END CURRENT_CANONICAL>>>"
    )
    items = canonical_runner.verification_items(items_prompt)
    assert items[0]["kind"] == "claim"
    assert items[0]["actor_id"] == "parti-test"


def test_traced_verifier_requires_duplicate_target_and_records_confirmed_claim(monkeypatch):
    reset_trace()
    seen = []

    def fake_gemini(api_key, prompt, model):
        seen.append(prompt)
        if "second vérificateur indépendant" in prompt:
            return {"verdicts": [{
                "index": 0,
                "verdict": "CONFIRMED",
                "relation": "DUPLICATE",
                "related_proposal_id": "claim-1",
                "reason": "même mesure",
            }]}
        return {"claims": []}

    monkeypatch.setattr(canonical_runner, "ORIGINAL_STRICT_GEMINI", fake_gemini)
    extraction_prompt = "URL: https://parti.example/programme ; propriétaire: Parti Test ; portion: 1/1"
    canonical_runner.traced_gemini("key", extraction_prompt, "model")

    verification_prompt = (
        "Tu es un second vérificateur indépendant.\n"
        'Éléments: [{"kind":"claim","actor_id":"parti-test","actor_type":"party","topic":"retraites",'
        '"statement":"Le parti confirme la même mesure.","evidence_quote":"confirme la même mesure",'
        '"certainty":"explicit","relevance":"party_platform"}]\n'
        "<<<CURRENT_CANONICAL>>>- claim-1<<<END CURRENT_CANONICAL>>>\n"
        "<<<SOURCE>>>Le parti confirme la même mesure.<<<END SOURCE>>>"
    )
    canonical_runner.traced_gemini("key", verification_prompt, "model")

    assert "related_proposal_id est obligatoire" in seen[-1]
    rows = canonical_runner.TRACE["confirmed"]["https://parti.example/programme"]
    assert len(rows) == 1
    assert rows[0]["verdict"]["related_proposal_id"] == "claim-1"
    assert rows[0]["claim"]["actor_id"] == "parti-test"


def test_confirmation_progress_is_idempotent_across_partial_runs():
    state = {"source_chunks": {}}
    source = {"url": "https://parti.example/programme", "sha256": "a" * 64, "title": "Programme", "text_truncated": False}
    row = {
        "claim": {"actor_id": "parti-test", "topic": "retraites", "statement": "Le parti confirme la même mesure."},
        "verdict": {"relation": "DUPLICATE", "related_proposal_id": "claim-1"},
    }
    progress = canonical_runner._persist_confirmations(state, source, [row])
    canonical_runner._persist_confirmations(state, source, [row])
    assert len(progress["canonical_confirmations"]) == 1
