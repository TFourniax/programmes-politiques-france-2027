import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import auto_promote_primary_runner as runner  # noqa: E402


def test_structured_snapshot_backlog_preserves_snapshot_transport(tmp_path):
    snapshot_text = "Source primaire officielle structurée. " + ("Mesure publique vérifiable. " * 20)
    sha = hashlib.sha256(snapshot_text.encode("utf-8")).hexdigest()
    state = {
        "last_structured_primary_run_at": "2026-08-12T15:00:00+00:00",
        "structured_primary_health": {
            "lfi-programme-chapters": {
                "owner": "La France insoumise",
                "status": 200,
                "complete": True,
                "checked_at": "2026-08-12T15:00:00+00:00",
                "items": {
                    "chapter-01": {
                        "number": 1,
                        "title": "Chapitre 1 : test",
                        "link": "https://melenchon2027.fr/programme2025/livre/chapitre1/",
                        "fetch_url": "https://melenchon2027.fr/programme2025/livre/chapitre1/",
                        "snapshot_path": "research/veille/structured/snapshots/test.txt",
                        "sha256": sha,
                        "date": None,
                        "section_count": 3,
                    }
                },
            }
        },
    }
    path = tmp_path / "state.json"
    path.write_text(json.dumps(state), encoding="utf-8")
    events = runner.structured_snapshot_backlog_events(path)
    assert len(events) == 1
    event = events[0]
    assert event["snapshot_path"].endswith("test.txt")
    assert event["url"].endswith("/chapitre1/")
    assert event["sha256"] == sha
    assert event["structured_section_count"] == 3


def test_snapshot_source_refuses_hash_mismatch(tmp_path, monkeypatch):
    root = tmp_path
    snapshots = root / "research" / "veille" / "structured" / "snapshots"
    snapshots.mkdir(parents=True)
    target = snapshots / "chapter.txt"
    target.write_text("Source primaire officielle. " + ("Mesure. " * 40), encoding="utf-8")
    monkeypatch.setattr(runner.auto_promote, "ROOT", root)
    try:
        runner._snapshot_source(
            "https://parti.fr/programme/",
            {"path": "research/veille/structured/snapshots/chapter.txt", "sha256": "bad", "title": "Programme"},
            10000,
        )
    except ValueError as exc:
        assert "integrity mismatch" in str(exc)
    else:
        raise AssertionError("un snapshot dont le hash diffère doit être refusé")


def test_snapshot_source_returns_exact_verified_primary_text(tmp_path, monkeypatch):
    root = tmp_path
    snapshots = root / "research" / "veille" / "structured" / "snapshots"
    snapshots.mkdir(parents=True)
    target = snapshots / "chapter.txt"
    text = "Source primaire officielle. " + ("Nous proposons une mesure explicite. " * 20)
    target.write_text(text, encoding="utf-8")
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    monkeypatch.setattr(runner.auto_promote, "ROOT", root)
    source = runner._snapshot_source(
        "https://parti.fr/programme/",
        {
            "path": "research/veille/structured/snapshots/chapter.txt",
            "sha256": sha,
            "title": "Programme",
            "fetch_url": "https://parti.fr/programme/",
        },
        10000,
    )
    assert source["url"] == "https://parti.fr/programme/"
    assert source["title"] == "Programme"
    assert source["kind"] == "official_primary_snapshot"
    assert source["text"] == text
    assert source["sha256"] == sha
    assert source["text_truncated"] is False
