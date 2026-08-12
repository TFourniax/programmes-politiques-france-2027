import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from auto_promote_runner import (  # noqa: E402
    EXTRACTION_SCHEMA,
    VERIFICATION_SCHEMA,
    _wordpress_rest_source,
    backlog_candidate,
    current_cycle_event,
    date_supported_by_source,
    schema_for_prompt,
    state_backlog_events,
    strict_sanitize,
    structured_backlog_events,
)


def test_schema_selection_is_deterministic():
    assert schema_for_prompt("Tu es un second vérificateur indépendant.") is VERIFICATION_SCHEMA
    assert schema_for_prompt("Tu extrais des données politiques.") is EXTRACTION_SCHEMA


def test_extraction_schema_requires_evidence_quote():
    claim = EXTRACTION_SCHEMA["properties"]["claims"]["items"]
    assert "evidence_quote" in claim["required"]
    assert claim["additionalProperties"] is False


def test_verifier_schema_is_closed_and_conservative():
    verdict = VERIFICATION_SCHEMA["properties"]["verdicts"]["items"]
    assert set(verdict["properties"]["verdict"]["enum"]) == {"CONFIRMED", "REJECTED", "AMBIGUOUS"}
    assert "CONTRADICTS" in verdict["properties"]["relation"]["enum"]
    assert verdict["additionalProperties"] is False


def test_model_date_must_exist_in_source_text():
    text = "Communiqué publié le 11 août 2026. Notre projet sera présenté à la rentrée."
    assert date_supported_by_source("2026-08-11", text)
    assert not date_supported_by_source("2026-08-12", text)
    assert date_supported_by_source("2026-08-11", "Mise à jour : 11/08/2026")


def test_sanitize_drops_hallucinated_dates_but_keeps_supported_claim():
    allowed = [{"id": "parti-x", "type": "party", "name": "Parti X"}]
    raw = {
        "source_title": "Projet",
        "document_type": "party_programme",
        "published_at": "2026-08-12",
        "claims": [{
            "actor_id": "parti-x",
            "actor_type": "party",
            "topic": "retraites",
            "statement": "Le parti propose une réforme explicite du système de retraites par répartition.",
            "evidence_quote": "réforme explicite du système de retraites",
            "certainty": "explicit",
            "relevance": "party_platform",
        }],
        "status_updates": [],
    }
    claims, statuses, doc_type, published = strict_sanitize(
        raw,
        "Publié le 11 août 2026. Nous proposons une réforme explicite du système de retraites.",
        allowed,
        8,
    )
    assert len(claims) == 1
    assert statuses == []
    assert doc_type == "party_programme"
    assert published is None


def test_sanitize_rejects_status_when_effective_date_is_not_in_source():
    allowed = [{"id": "alice", "type": "candidate", "name": "Alice Martin"}]
    raw = {
        "source_title": "Candidature",
        "document_type": "candidacy_declaration",
        "published_at": "2026-08-11",
        "claims": [],
        "status_updates": [{
            "candidate_id": "alice",
            "new_status": "declared_presidential",
            "effective_date": "2026-08-12",
            "evidence_quote": "je suis candidate à l'élection présidentielle",
            "explicit": True,
        }],
    }
    claims, statuses, _, published = strict_sanitize(
        raw,
        "Le 11 août 2026, je suis candidate à l'élection présidentielle.",
        allowed,
        8,
    )
    assert claims == []
    assert statuses == []
    assert published == "2026-08-11"


def test_backlog_keeps_programmatic_or_recent_urls():
    assert backlog_candidate(
        "https://parti.fr/notre-programme/retraites/",
        {"lastmod": "2026-01-01"},
    )
    assert backlog_candidate(
        "https://parti.fr/actualite-generique/",
        {"lastmod": "2026-08-01T10:00:00Z"},
    )
    assert not backlog_candidate(
        "https://parti.fr/ancienne-photo/",
        {"lastmod": "2022-01-01"},
    )


def test_backlog_excludes_explicit_old_election_programmes():
    assert not backlog_candidate(
        "https://parti.fr/programme-europeennes-2024-mesure-9/",
        {"lastmod": "2026-08-01T10:00:00Z"},
    )
    assert not backlog_candidate(
        "https://parti.fr/presidentielle-2022/programme/",
        {"lastmod": "2026-08-01T10:00:00Z"},
    )


def test_generic_precycle_document_is_research_only_when_dated():
    event = {
        "url": "https://parti.fr/document/programme.pdf",
        "title": "Programme",
        "published_at": "2024-08-08T20:06:55+02:00",
    }
    assert not current_cycle_event(event)
    assert not backlog_candidate(event["url"], {"lastmod": event["published_at"]})


def test_explicit_2027_url_can_survive_bad_legacy_lastmod():
    event = {
        "url": "https://parti.fr/presidentielle-2027/programme/",
        "title": "Programme 2027",
        "published_at": "2024-12-31",
    }
    assert current_cycle_event(event)


def test_state_backlog_survives_daily_event_overwrite(tmp_path):
    state = {
        "last_run_at": "2026-08-11T08:00:00+00:00",
        "official_seen_urls": {
            "https://parti.fr/notre-programme/retraites/": {
                "first_seen_at": "2026-08-11T07:00:00+00:00",
                "lastmod": "2026-08-10T12:00:00Z",
                "owner": "Parti Test",
            },
            "https://parti.fr/archive-2019/": {
                "first_seen_at": "2026-08-11T07:00:00+00:00",
                "lastmod": "2019-01-01",
                "owner": "Parti Test",
            },
            "https://parti.fr/programme-europeennes-2024/": {
                "first_seen_at": "2026-08-11T07:00:00+00:00",
                "lastmod": "2026-08-10T12:00:00Z",
                "owner": "Parti Test",
            },
            "https://parti.fr/document/programme.pdf": {
                "first_seen_at": "2026-08-11T07:00:00+00:00",
                "lastmod": "2024-08-08T20:06:55+02:00",
                "owner": "Parti Test",
            },
        },
    }
    path = tmp_path / "state.json"
    path.write_text(json.dumps(state), encoding="utf-8")
    events = state_backlog_events(path)
    assert len(events) == 1
    event = events[0]
    assert event["url"] == "https://parti.fr/notre-programme/retraites/"
    assert event["owner"] == "Parti Test"
    assert event["published_at"] == "2026-08-10T12:00:00Z"
    assert event["provenance"] == "durable_official_sitemap_backlog"


def test_structured_backlog_survives_daily_jsonl_overwrite_and_keeps_transport(tmp_path):
    state = {
        "last_structured_primary_run_at": "2026-08-12T15:00:00+00:00",
        "structured_primary_health": {
            "programme": {
                "owner": "Parti Test",
                "status": 200,
                "complete": True,
                "checked_at": "2026-08-12T15:00:00+00:00",
                "items": {
                    "1": {
                        "number": 1,
                        "title": "Chapitre 1 : Test",
                        "link": "https://parti.fr/2026/08/12/chapitre-1/",
                        "fetch_url": "https://parti.fr/wp-json/wp/v2/posts/101",
                        "sha256": "abc123",
                        "date": "2026-08-12",
                    },
                    "2": {
                        "number": 2,
                        "title": "Chapitre 2 : Test",
                        "link": "https://parti.fr/2026/08/12/chapitre-2/",
                        "fetch_url": "https://parti.fr/wp-json/wp/v2/posts/102",
                        "sha256": "def456",
                        "date": "2026-08-12",
                    },
                },
            }
        },
    }
    path = tmp_path / "state.json"
    path.write_text(json.dumps(state), encoding="utf-8")
    events = structured_backlog_events(path)
    assert len(events) == 2
    assert {item["url"] for item in events} == {
        "https://parti.fr/2026/08/12/chapitre-1/",
        "https://parti.fr/2026/08/12/chapitre-2/",
    }
    assert all(item["fetch_url"].startswith("https://parti.fr/wp-json/") for item in events)
    assert all(item["provenance"] == "durable_official_structured_primary_backlog" for item in events)


class FakeRestResponse:
    status_code = 200
    url = "https://parti.fr/wp-json/wp/v2/posts/101"
    headers = {"content-type": "application/json; charset=UTF-8"}

    def json(self):
        return {
            "id": 101,
            "status": "publish",
            "link": "https://parti.fr/2026/08/12/chapitre-1/",
            "title": {"rendered": "Chapitre 1 : Test"},
            "content": {"rendered": "<h2>Programme</h2><p>" + ("Nous proposons une mesure explicite. " * 20) + "</p>"},
        }


class FakeRestSession:
    def get(self, url, timeout=30, allow_redirects=True):
        assert url == "https://parti.fr/wp-json/wp/v2/posts/101"
        return FakeRestResponse()


def test_structured_rest_transport_returns_full_primary_text_under_public_url():
    source = _wordpress_rest_source(
        FakeRestSession(),
        "https://parti.fr/2026/08/12/chapitre-1/",
        "https://parti.fr/wp-json/wp/v2/posts/101",
        10000,
    )
    assert source["url"] == "https://parti.fr/2026/08/12/chapitre-1/"
    assert source["fetch_url"] == "https://parti.fr/wp-json/wp/v2/posts/101"
    assert source["kind"] == "wordpress_rest_json"
    assert source["title"] == "Chapitre 1 : Test"
    assert "Nous proposons une mesure explicite" in source["text"]
    assert source["text_truncated"] is False
