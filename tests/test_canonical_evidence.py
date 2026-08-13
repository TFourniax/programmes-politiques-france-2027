from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from canonical_evidence import (  # noqa: E402
    content_matches_target,
    ensure_support_document,
    merge_provenance,
    proposal_records,
    resolve_target,
    valid_target,
    write_md,
)
from common import parse_markdown  # noqa: E402


def make_proposal(root: Path, proposal_id="claim-1", entity_id="alice", topic="retraites") -> Path:
    path = root / "proposals" / topic / f"{proposal_id}.md"
    write_md(path, {
        "proposal_id": proposal_id,
        "title": "Fixer l’âge légal de départ à 64 ans",
        "entity_id": entity_id,
        "topic": topic,
        "certainty": "explicit",
        "proposal_status": "current",
        "source_document_ids": ["doc-1"],
        "source_url": "https://alice.example/source-1",
        "evidence_sha256": "a" * 64,
    }, "# Fixer l’âge légal de départ à 64 ans\n\nLa candidate propose de fixer l’âge légal de départ à la retraite à 64 ans.")
    return path


def matching_claim():
    return {
        "actor_id": "alice",
        "topic": "retraites",
        "statement": "Alice Martin veut fixer l’âge légal de départ à la retraite à 64 ans.",
        "evidence_quote": "fixer l’âge légal de départ à 64 ans",
    }


def test_duplicate_target_must_keep_actor_topic_and_content(tmp_path):
    make_proposal(tmp_path)
    records = proposal_records(tmp_path)
    claim = matching_claim()
    assert valid_target(claim, "claim-1", records) == "claim-1"
    assert valid_target({**claim, "actor_id": "bob"}, "claim-1", records) is None
    assert valid_target({**claim, "topic": "fiscalite-redistribution"}, "claim-1", records) is None


def test_same_actor_and_topic_do_not_allow_unrelated_measure_merge(tmp_path):
    make_proposal(tmp_path)
    records = proposal_records(tmp_path)
    unrelated = {
        "actor_id": "alice",
        "topic": "retraites",
        "statement": "Alice Martin veut porter la pension minimale à 1 500 euros par mois.",
        "evidence_quote": "pension minimale à 1 500 euros",
    }
    assert valid_target(unrelated, "claim-1", records) is None


def test_conflicting_policy_number_blocks_merge_even_with_shared_vocabulary(tmp_path):
    make_proposal(tmp_path)
    records = proposal_records(tmp_path)
    conflicting = {
        "actor_id": "alice",
        "topic": "retraites",
        "statement": "Alice Martin veut fixer l’âge légal de départ à la retraite à 65 ans.",
        "evidence_quote": "âge légal de départ à 65 ans",
    }
    assert valid_target(conflicting, "claim-1", records) is None


def test_content_guard_accepts_a_close_verified_paraphrase(tmp_path):
    path = make_proposal(tmp_path)
    meta, body = parse_markdown(path)
    assert content_matches_target(matching_claim(), meta, body)


def test_resolve_target_can_use_exact_persisted_fingerprint(tmp_path):
    make_proposal(tmp_path)
    records = proposal_records(tmp_path)
    claim = matching_claim()
    from canonical_evidence import claim_fingerprint
    state = {"claim_fingerprints": {claim_fingerprint(claim): {"proposal_id": "claim-1"}}}
    assert resolve_target(claim, {"relation": "NEW", "related_proposal_id": None}, state, records) == "claim-1"


def test_merge_provenance_is_idempotent_and_never_creates_a_second_claim(tmp_path):
    path = make_proposal(tmp_path)
    claim = matching_claim()
    assert merge_provenance(
        "claim-1", claim, "doc-2", "https://alice.example/source-2", "b" * 64, "2026-08-13", tmp_path
    )
    meta, _ = parse_markdown(path)
    assert meta["source_document_ids"] == ["doc-1", "doc-2"]
    assert meta["source_urls"] == ["https://alice.example/source-1", "https://alice.example/source-2"]
    assert meta["confirmation_count"] == 2
    assert meta["last_confirmed_at"] == "2026-08-13"
    assert len(proposal_records(tmp_path)) == 1

    assert not merge_provenance(
        "claim-1", claim, "doc-2", "https://alice.example/source-2", "b" * 64, "2026-08-13", tmp_path
    )
    meta_after, _ = parse_markdown(path)
    assert meta_after["source_document_ids"] == ["doc-1", "doc-2"]
    assert len(proposal_records(tmp_path)) == 1


def test_duplicate_only_source_becomes_support_document_not_new_proposal(tmp_path):
    source = {
        "url": "https://alice.example/programme/retraites",
        "title": "Programme retraites",
        "sha256": "c" * 64,
        "text_truncated": False,
    }
    document_id, relative, changed = ensure_support_document(
        source=source,
        owner_id="alice",
        owner_type="candidate",
        owner_name="Alice Martin",
        published_at="2026-08-13",
        date_basis="source_or_feed_date",
        document_type="campaign_website_page",
        claims=[{
            "actor_id": "alice",
            "topic": "retraites",
            "statement": "La candidate confirme une mesure déjà présente dans le corpus.",
            "evidence_quote": "confirme une mesure déjà présente",
        }],
        root=tmp_path,
    )
    assert changed
    assert document_id.startswith("auto-alice-2026-08-13-")
    path = tmp_path / relative
    meta, body = parse_markdown(path)
    assert meta["verification_state"] == "verified"
    assert meta["verification_scope"] == "statement_attribution_not_feasibility"
    assert meta["source_complete"] is True
    assert meta["topics"] == ["retraites"]
    assert "sans dupliquer les propositions" in body
    assert "confirme une mesure déjà présente" in body
    assert "pas sur la faisabilité" in body
    assert proposal_records(tmp_path) == {}
