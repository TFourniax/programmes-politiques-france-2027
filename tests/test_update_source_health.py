from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from update_source_health import (  # noqa: E402
    healthy_direct_feed_coverage,
    http_error_urls,
    update_records,
)


def target(url="https://parti.fr/", owner="Parti Test", kind="party_official"):
    return [{"url": url, "owner": owner, "tier": "tier_1_primary_official", "kind": kind}]


def test_transient_failure_increments_without_becoming_persistent():
    payload = update_records({}, target(), {"https://parti.fr/"}, "2026-08-11T10:00:00+00:00")
    row = payload["sources"]["https://parti.fr/"]
    assert row["consecutive_failures"] == 1
    assert row["status"] == "transient_failure"
    assert payload["persistent_failure_count"] == 0


def test_four_consecutive_failures_become_persistent():
    previous = {}
    for hour in range(4):
        previous = update_records(previous, target(), {"https://parti.fr/"}, f"2026-08-11T1{hour}:00:00+00:00")
    row = previous["sources"]["https://parti.fr/"]
    assert row["consecutive_failures"] == 4
    assert row["status"] == "persistent_failure"
    assert previous["persistent_failure_count"] == 1


def test_success_resets_failure_counter():
    previous = {}
    for hour in range(4):
        previous = update_records(previous, target(), {"https://parti.fr/"}, f"2026-08-11T1{hour}:00:00+00:00")
    recovered = update_records(previous, target(), set(), "2026-08-11T14:00:00+00:00")
    row = recovered["sources"]["https://parti.fr/"]
    assert row["consecutive_failures"] == 0
    assert row["status"] == "ok"
    assert recovered["persistent_failure_count"] == 0


def test_http_403_429_and_500_are_unavailable_sources():
    state = {
        "sources": {
            "https://a.fr/": {"status": 200},
            "https://b.fr/": {"status": 403},
            "https://c.fr/": {"status": 429},
            "https://d.fr/": {"status": 500},
        }
    }
    assert http_error_urls(state) == {"https://b.fr/", "https://c.fr/", "https://d.fr/"}


def test_healthy_direct_feed_is_explicit_discovery_coverage_for_party_homepage():
    state = {
        "direct_feed_health": {
            "https://feeds.parti.fr/actualites.rss": {
                "owner": "Parti Test",
                "status": 200,
                "checked_at": "2026-08-12T10:00:00+00:00",
                "resolved_url": "https://parti.fr/actualites.rss",
            }
        }
    }
    alternates = healthy_direct_feed_coverage(state)
    payload = update_records(
        {},
        target(),
        {"https://parti.fr/"},
        "2026-08-12T10:01:00+00:00",
        alternate_coverage=alternates,
    )
    row = payload["sources"]["https://parti.fr/"]
    assert row["status"] == "ok_via_official_feed"
    assert row["kind"] == "party_official"
    assert row["consecutive_failures"] == 0
    assert row["alternate_url"] == "https://feeds.parti.fr/actualites.rss"
    assert payload["persistent_failure_count"] == 0
    assert payload["alternate_official_feed_coverage_count"] == 1


def test_official_feed_never_masks_failure_of_specific_programme_page():
    state = {
        "direct_feed_health": {
            "https://feeds.parti.fr/actualites.rss": {
                "owner": "Parti Test",
                "status": 200,
                "checked_at": "2026-08-12T10:00:00+00:00",
            }
        }
    }
    alternates = healthy_direct_feed_coverage(state)
    payload = update_records(
        {},
        target("https://parti.fr/programme/", kind="party_programme"),
        {"https://parti.fr/programme/"},
        "2026-08-12T10:01:00+00:00",
        alternate_coverage=alternates,
    )
    row = payload["sources"]["https://parti.fr/programme/"]
    assert row["status"] == "transient_failure"
    assert row["kind"] == "party_programme"
    assert "alternate_url" not in row
    assert payload["covered_failure_count"] == 0
    assert payload["uncovered_failure_count"] == 1


def test_failed_direct_feed_does_not_hide_html_failure():
    state = {
        "direct_feed_health": {
            "https://feeds.parti.fr/actualites.rss": {
                "owner": "Parti Test",
                "status": 503,
            }
        }
    }
    alternates = healthy_direct_feed_coverage(state)
    payload = update_records(
        {},
        target(),
        {"https://parti.fr/"},
        "2026-08-12T10:01:00+00:00",
        alternate_coverage=alternates,
    )
    assert payload["sources"]["https://parti.fr/"]["status"] == "transient_failure"
