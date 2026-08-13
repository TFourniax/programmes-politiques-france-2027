from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import auto_promote_canonical_runner as canonical  # noqa: E402


def test_canonical_loader_adds_missing_monitored_snapshot(monkeypatch):
    baseline = [{
        "event_type": "official_new_url",
        "url": "https://example.invalid/programme/mesure/",
        "published_at": "2026-08-13",
    }]
    monitored = [{
        "event_type": "official_source_changed",
        "url": "https://example.invalid/programme/",
        "sha256": "a" * 64,
        "observed_at": "2026-08-13T15:00:00+00:00",
    }]
    monkeypatch.setattr(canonical, "ORIGINAL_DURABLE_LOAD_EVENTS", lambda: list(baseline))
    monkeypatch.setattr(canonical, "load_monitored_source_backlog", lambda _root: list(monitored))
    monkeypatch.setattr(canonical.runner, "current_cycle_event", lambda _event: True)

    events = canonical.canonical_durable_load_events()
    assert len(events) == 2
    assert events[1]["sha256"] == "a" * 64


def test_canonical_loader_deduplicates_identical_event(monkeypatch):
    event = {
        "event_type": "official_source_changed",
        "url": "https://example.invalid/programme/",
        "sha256": "a" * 64,
        "observed_at": "2026-08-13T15:00:00+00:00",
    }
    monkeypatch.setattr(canonical, "ORIGINAL_DURABLE_LOAD_EVENTS", lambda: [dict(event)])
    monkeypatch.setattr(canonical, "load_monitored_source_backlog", lambda _root: [dict(event)])
    monkeypatch.setattr(canonical.runner, "current_cycle_event", lambda _event: True)

    assert canonical.canonical_durable_load_events() == [event]
