from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import daily_watch as dw  # noqa: E402
from daily_watch import (  # noqa: E402
    canonicalize_url,
    domain_matches,
    is_relevant_official_url,
    load_coverage_priorities,
    monitor_sources,
    normalize_html,
    parse_feed,
    parse_sitemap,
    title_relevant,
    trusted_press,
)


def test_canonicalize_url_removes_tracking_and_fragment():
    url = "https://Example.com/article?utm_source=x&b=2&a=1#section"
    assert canonicalize_url(url) == "https://example.com/article?a=1&b=2"


def test_normalize_html_ignores_script_and_style():
    raw = b"<html><style>.x{color:red}</style><body>Hello <b>world</b><script>bad()</script></body></html>"
    assert normalize_html(raw) == "Hello world"


def test_parse_sitemap_urlset():
    raw = b'''<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.fr/programme-2027</loc><lastmod>2026-08-10</lastmod></url></urlset>'''
    child_maps, urls = parse_sitemap(raw)
    assert child_maps == []
    assert urls == [("https://example.fr/programme-2027", "2026-08-10")]


def test_parse_atom_feed():
    raw = b'''<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Programme 2027</title><link href="https://example.fr/programme"/><updated>2026-08-10T08:00:00Z</updated></entry></feed>'''
    items = parse_feed(raw)
    assert items[0]["title"] == "Programme 2027"
    assert items[0]["url"] == "https://example.fr/programme"


def test_domain_matching_does_not_accept_lookalikes():
    assert domain_matches("politique.lemonde.fr", "lemonde.fr")
    assert not domain_matches("lemonde.fr.example.org", "lemonde.fr")


def test_trusted_press_uses_allowlist():
    config = {"gdelt": {"trusted_press_domains": ["lemonde.fr", "reuters.com"]}}
    assert trusted_press("https://www.lemonde.fr/politique/", config)
    assert not trusted_press("https://example.net/article", config)


def test_title_relevance_accepts_entity_or_political_keyword():
    assert title_relevant("Gabriel Attal présente ses priorités", "Gabriel Attal")
    assert title_relevant("Présidentielle 2027 : les dernières annonces", "Gabriel Attal")
    assert title_relevant("Défense : renforcer l'armée et la dissuasion", "Gabriel Attal")
    assert title_relevant("Intelligence artificielle et souveraineté numérique", "Gabriel Attal")
    assert not title_relevant("Résultats du championnat de football", "Gabriel Attal")


def test_official_discovery_recognizes_defense_and_digital_policy_urls():
    assert is_relevant_official_url("https://parti.fr/programme/defense-armee-otan")
    assert is_relevant_official_url("https://parti.fr/propositions/intelligence-artificielle-cybersecurite")
    assert is_relevant_official_url("https://parti.fr/actualites", "Souveraineté numérique et IA")
    assert not is_relevant_official_url("https://parti.fr/boutique/t-shirt")


def test_coverage_priorities_reuse_previous_report_without_network(monkeypatch, tmp_path: Path):
    (tmp_path / "research" / "veille").mkdir(parents=True)
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "compass.json").write_text(json.dumps({
        "questions": [
            {"id": "defense-international", "label": "Défense & international"},
            {"id": "numerique-ia", "label": "Numérique & IA"},
        ]
    }), encoding="utf-8")
    (tmp_path / "research" / "veille" / "coverage.json").write_text(json.dumps({
        "priority_gaps": [{
            "id": "alice",
            "coverage_ratio": 0.25,
            "gaps": ["defense-international", "numerique-ia"],
        }]
    }), encoding="utf-8")
    monkeypatch.setattr(dw, "ROOT", tmp_path)
    priorities = load_coverage_priorities()
    assert priorities["alice"]["coverage_ratio"] == 0.25
    assert priorities["alice"]["gap_labels"] == ["Défense & international", "Numérique & IA"]


def test_http_error_page_is_never_hashed_as_political_change(monkeypatch):
    url = "https://parti.fr/programme/"
    old_sha = "a" * 64
    state = {
        "sources": {
            url: {
                "sha256": old_sha,
                "status": 200,
                "excerpt": "Programme politique valide",
                "checked_at": "2026-08-11T10:00:00+00:00",
            }
        }
    }
    target = [{
        "url": url,
        "owner": "Parti Test",
        "tier": "tier_1_primary_official",
        "kind": "party_programme",
    }]
    monkeypatch.setattr(dw, "fetch", lambda *_args, **_kwargs: {
        "status": 403,
        "url": url,
        "raw": b"<html><body>Just a moment... challenge id changed</body></html>",
        "content_type": "text/html; charset=UTF-8",
        "encoding": "utf-8",
        "etag": None,
        "last_modified": None,
        "headers": {},
    })
    errors = []
    events, fetched = monitor_sources(object(), state, target, errors)
    assert fetched == {}
    assert errors == [f"{url}: HTTP 403"]
    assert [event["event_type"] for event in events] == ["source_fetch_error"]
    assert not any(event["event_type"] == "official_source_changed" for event in events)
    assert state["sources"][url]["sha256"] == old_sha
    assert state["sources"][url]["excerpt"] == "Programme politique valide"
    assert state["sources"][url]["status"] == 403


def test_recovery_after_waf_compares_against_last_valid_content(monkeypatch):
    url = "https://parti.fr/programme/"
    state = {
        "sources": {
            url: {
                "sha256": "a" * 64,
                "status": 403,
                "excerpt": "Dernier programme valide",
            }
        }
    }
    target = [{
        "url": url,
        "owner": "Parti Test",
        "tier": "tier_1_primary_official",
        "kind": "party_programme",
    }]
    monkeypatch.setattr(dw, "fetch", lambda *_args, **_kwargs: {
        "status": 200,
        "url": url,
        "raw": b"<html><body>Nouveau programme politique valide</body></html>",
        "content_type": "text/html; charset=UTF-8",
        "encoding": "utf-8",
        "etag": None,
        "last_modified": None,
        "headers": {},
    })
    errors = []
    events, fetched = monitor_sources(object(), state, target, errors)
    assert errors == []
    assert url in fetched
    assert [event["event_type"] for event in events] == ["official_source_changed"]
    assert events[0]["previous_sha256"] == "a" * 64
    assert state["sources"][url]["status"] == 200
