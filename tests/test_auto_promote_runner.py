import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from auto_promote_runner import (  # noqa: E402
    EXTRACTION_SCHEMA,
    VERIFICATION_SCHEMA,
    backlog_candidate,
    current_cycle_event,
    schema_for_prompt,
    state_backlog_events,
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
