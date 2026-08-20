from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from normalize_source_health import normalize_source_health, protected_sources  # noqa: E402


def test_protected_http_responses_are_observable_but_not_outages():
    watch_state = {
        "sources": {
            "https://blocked.example/": {
                "status": 403,
                "checked_at": "2026-08-20T08:00:00+00:00",
                "resolved_url": "https://blocked.example/",
            },
            "https://rate.example/": {
                "status": 429,
                "checked_at": "2026-08-20T08:00:00+00:00",
            },
            "https://broken.example/": {"status": 500},
        }
    }
    assert set(protected_sources(watch_state)) == {
        "https://blocked.example/",
        "https://rate.example/",
    }

    source_health = {
        "version": 6,
        "covered_failures": [],
        "uncovered_failures": [
            {
                "url": "https://blocked.example/",
                "owner": "Blocked",
                "kind": "registry_source",
                "status": "persistent_failure",
            },
            {
                "url": "https://broken.example/",
                "owner": "Broken",
                "kind": "registry_source",
                "status": "persistent_failure",
            },
        ],
        "persistent_failures": [
            {
                "url": "https://blocked.example/",
                "owner": "Blocked",
                "kind": "registry_source",
                "consecutive_failures": 8,
            },
            {
                "url": "https://broken.example/",
                "owner": "Broken",
                "kind": "registry_source",
                "consecutive_failures": 8,
            },
        ],
        "sources": {
            "https://blocked.example/": {
                "url": "https://blocked.example/",
                "owner": "Blocked",
                "kind": "registry_source",
                "status": "persistent_failure",
                "consecutive_failures": 8,
                "first_failure_at": "2026-08-18T08:00:00+00:00",
                "last_failure_at": "2026-08-20T08:00:00+00:00",
            },
            "https://broken.example/": {
                "url": "https://broken.example/",
                "owner": "Broken",
                "kind": "registry_source",
                "status": "persistent_failure",
                "consecutive_failures": 8,
            },
        },
    }

    normalized = normalize_source_health(source_health, watch_state)
    protected = normalized["sources"]["https://blocked.example/"]
    assert protected["status"] == "reachable_but_protected"
    assert protected["http_status"] == 403
    assert protected["consecutive_failures"] == 0
    assert normalized["protected_failure_count"] == 1
    assert normalized["uncovered_failure_count"] == 1
    assert normalized["persistent_failure_count"] == 1
    assert normalized["persistent_failures"][0]["url"] == "https://broken.example/"


def test_successful_or_server_error_sources_are_not_reclassified_as_antibot():
    watch_state = {
        "sources": {
            "https://ok.example/": {"status": 200},
            "https://broken.example/": {"status": 503},
        }
    }
    source_health = {
        "covered_failures": [],
        "uncovered_failures": [],
        "sources": {
            "https://ok.example/": {"status": "ok"},
            "https://broken.example/": {
                "url": "https://broken.example/",
                "status": "persistent_failure",
                "consecutive_failures": 4,
            },
        },
    }
    normalized = normalize_source_health(source_health, watch_state)
    assert normalized["protected_failure_count"] == 0
    assert normalized["sources"]["https://broken.example/"]["status"] == "persistent_failure"
    assert normalized["persistent_failure_count"] == 1
