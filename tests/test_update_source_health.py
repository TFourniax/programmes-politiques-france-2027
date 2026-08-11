from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from update_source_health import http_error_urls, update_records  # noqa: E402


def target(url="https://parti.fr/"):
    return [{"url": url, "owner": "Parti Test", "tier": "tier_1_primary_official", "kind": "party_official"}]


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
