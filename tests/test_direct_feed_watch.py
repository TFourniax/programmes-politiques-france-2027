from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import direct_feed_watch as dfw  # noqa: E402


def feed_result(items):
    xml = "<rss><channel>" + "".join(
        f"<item><title>{title}</title><link>{url}</link><pubDate>{published}</pubDate></item>"
        for title, url, published in items
    ) + "</channel></rss>"
    return {
        "status": 200,
        "url": "https://www.pcf.fr/actualites.rss",
        "content_type": "application/rss+xml; charset=utf-8",
        "raw": xml.encode("utf-8"),
        "encoding": "utf-8",
    }


def configured():
    return [{
        "id": "pcf-actualites",
        "url": "https://pcf.nationbuilder.com/actualites.rss",
        "owner": "Parti communiste français",
        "public_origin": "https://www.pcf.fr/",
        "source_tier": "tier_1_primary_official",
    }]


def test_feed_item_url_uses_public_https_origin():
    assert dfw.normalize_item_url(
        "http://www.pcf.fr/programme_2027",
        "https://www.pcf.fr/",
    ) == "https://www.pcf.fr/programme_2027"


def test_initial_sync_seeds_seen_urls_without_flooding_events(monkeypatch):
    monkeypatch.setattr(dfw, "fetch", lambda *_args, **_kwargs: feed_result([
        ("Programme 2027 : une nouvelle mesure", "http://www.pcf.fr/programme_2027", "Tue, 11 Aug 2026 10:00:00 +0000"),
    ]))
    state = {"official_seen_urls": {}, "last_run_at": "2026-08-12T08:00:00+00:00"}
    events, warnings = dfw.collect(object(), state, configured())
    assert events == []
    assert warnings == []
    assert "https://www.pcf.fr/programme_2027" in state["official_seen_urls"]
    health = state["direct_feed_health"]["https://pcf.nationbuilder.com/actualites.rss"]
    assert health["status"] == 200
    assert health["item_count"] == 1


def test_new_item_after_initial_sync_creates_discovery_only_event(monkeypatch):
    feed_url = "https://pcf.nationbuilder.com/actualites.rss"
    state = {
        "official_seen_urls": {
            "https://www.pcf.fr/ancien_programme": {
                "owner": "Parti communiste français",
                "first_seen_at": "2026-08-11T08:00:00+00:00",
            }
        },
        "direct_feeds": {
            feed_url: {
                "initialized_at": "2026-08-11T08:00:00+00:00",
                "owner": "Parti communiste français",
            }
        },
        "last_run_at": "2026-08-12T08:00:00+00:00",
    }
    monkeypatch.setattr(dfw, "fetch", lambda *_args, **_kwargs: feed_result([
        ("Nouvelle proposition sur l'emploi", "http://www.pcf.fr/proposition_emploi", "Wed, 12 Aug 2026 10:00:00 +0000"),
    ]))
    events, warnings = dfw.collect(object(), state, configured())
    assert warnings == []
    assert len(events) == 1
    event = events[0]
    assert event["event_type"] == "official_new_feed_item"
    assert event["url"] == "https://www.pcf.fr/proposition_emploi"
    assert event["source_tier"] == "tier_1_primary_official"
    assert event["verification_state"] == "needs_review"
    assert event["provenance"] == "official_direct_feed_discovery_only"


def test_feed_title_alone_never_becomes_canonical_content(monkeypatch):
    state = {
        "official_seen_urls": {},
        "direct_feeds": {
            "https://pcf.nationbuilder.com/actualites.rss": {
                "initialized_at": "2026-08-11T08:00:00+00:00",
            }
        },
        "last_run_at": "2026-08-12T08:00:00+00:00",
    }
    monkeypatch.setattr(dfw, "fetch", lambda *_args, **_kwargs: feed_result([
        ("Programme 2027 : retraite à 60 ans", "http://www.pcf.fr/retraite_60", "Wed, 12 Aug 2026 10:00:00 +0000"),
    ]))
    events, _ = dfw.collect(object(), state, configured())
    assert len(events) == 1
    assert "statement" not in events[0]
    assert "evidence_quote" not in events[0]
    assert events[0]["verification_state"] == "needs_review"
