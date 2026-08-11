from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from auto_promote import (  # noqa: E402
    can_supersede,
    explicit_old_election,
    priority,
    quote_ok,
    resolve_owner,
    retry_due,
    same_host,
    sanitize,
    source_scope,
    split_chunks,
)


def test_quote_requires_exact_short_span():
    source = "Nous proposons de fixer l'âge légal de départ à 64 ans et de développer la capitalisation."
    assert quote_ok("fixer l'âge légal de départ à 64 ans", source)
    assert not quote_ok("fixer l'âge légal de départ à 62 ans", source)
    assert not quote_ok(" ".join(["mot"] * 19), source)


def test_redirect_must_stay_on_official_host_family():
    assert same_host("https://www.example.fr/a", "https://example.fr/b")
    assert same_host("https://docs.example.fr/a", "https://example.fr/b")
    assert not same_host("https://example.fr/a", "https://evil.example.com/b")


def test_programme_pages_are_processed_first():
    programme = {"url": "https://parti.fr/notre-programme/retraites/", "event_type": "official_new_url"}
    generic = {"url": "https://parti.fr/actualites/fete-locale/", "event_type": "official_new_url"}
    assert priority(programme)[0] > priority(generic)[0]


def test_old_election_url_is_never_prioritised_as_current_cycle():
    old = {"url": "https://parti.fr/programme-europeennes-2024-mesure-9/", "event_type": "official_new_url"}
    assert explicit_old_election(old["url"])
    assert priority(old)[0] < 0
    assert source_scope({"url": old["url"], "title": "", "text": "Programme"}) == "historical_election"


def test_source_scope_accepts_current_2027_material():
    source = {
        "url": "https://parti.fr/presidentielle-2027/programme/",
        "title": "Programme 2027",
        "text": "Nos propositions pour la présidentielle 2027.",
    }
    assert source_scope(source, "2026-08-11") == "current_cycle_or_party_platform"


def test_long_source_is_split_into_persistent_chunks():
    chunks = split_chunks("Une proposition politique complète. " * 1200, chunk_chars=5000, overlap_chars=200)
    assert len(chunks) > 2
    assert all(chunks)


def test_older_source_cannot_supersede_newer_proposal():
    old = {"first_documented_at": "2026-06-01"}
    assert not can_supersede("2024-06-03", "source_or_feed_date", old)
    assert can_supersede("2027-01-15", "source_or_feed_date", old)
    assert not can_supersede("2027-01-15", "capture_fallback", old)


def test_technical_errors_are_retried_after_backoff_instead_of_abandoned():
    due = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    assert retry_due({"status": "technical_error", "attempts": 12, "next_retry_at": due})
    assert not retry_due({"status": "technical_error", "attempts": 12, "next_retry_at": future})


def test_owner_resolution_keeps_party_candidate_separation():
    candidates = {"alice": {"name": "Alice Martin"}}
    parties = {"parti-x": {"name": "Parti X"}}
    assert resolve_owner("Parti X", candidates, parties) == ("parti-x", "party")
    assert resolve_owner("Alice Martin", candidates, parties) == ("alice", "candidate")


def test_sanitize_rejects_wrong_actor_and_fake_quote():
    allowed = [{"id": "parti-x", "type": "party", "name": "Parti X"}]
    raw = {
        "document_type": "party_programme",
        "claims": [
            {
                "actor_id": "parti-x",
                "actor_type": "party",
                "topic": "retraites",
                "statement": "Le parti propose de créer un étage obligatoire de retraite par capitalisation.",
                "evidence_quote": "créer un étage obligatoire de retraite par capitalisation",
                "certainty": "explicit",
                "relevance": "party_platform",
            },
            {
                "actor_id": "candidat-inconnu",
                "actor_type": "candidate",
                "topic": "retraites",
                "statement": "Cette phrase ne doit pas être attribuée à un candidat inconnu.",
                "evidence_quote": "créer un étage obligatoire de retraite par capitalisation",
                "certainty": "explicit",
                "relevance": "direct",
            },
            {
                "actor_id": "parti-x",
                "actor_type": "party",
                "topic": "retraites",
                "statement": "Cette phrase doit être rejetée car sa preuve n'existe pas dans la source.",
                "evidence_quote": "citation absente de la source",
                "certainty": "explicit",
                "relevance": "party_platform",
            },
        ],
        "status_updates": [],
    }
    claims, statuses, doc_type, published = sanitize(
        raw,
        "Notre programme veut créer un étage obligatoire de retraite par capitalisation pour les actifs.",
        allowed,
        10,
    )
    assert len(claims) == 1
    assert statuses == []
    assert doc_type == "party_programme"
    assert published is None
