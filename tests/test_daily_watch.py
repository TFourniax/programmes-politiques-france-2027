from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import daily_watch as dw  # noqa: E402
from daily_watch import (  # noqa: E402
    canonicalize_url,
    domain_matches,
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
    assert not title_relevant("Résultats du championnat de football", "Gabriel Attal")


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
