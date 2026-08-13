from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_coverage_report import TOPICS, build_coverage, render_markdown  # noqa: E402


def write_proposal(root: Path, name: str, *, entity: str, topic: str, status: str = "current") -> None:
    target = root / "proposals" / topic / f"{name}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    status_line = "" if status == "current" else f"proposal_status: {status}\n"
    target.write_text(
        "---\n"
        f"proposal_id: {name}\n"
        f"entity_id: {entity}\n"
        f"topic: {topic}\n"
        f"{status_line}"
        "certainty: explicit\n"
        "source_url: https://example.org/source\n"
        "---\n"
        f"# Mesure {name}\n\nTexte de test.\n",
        encoding="utf-8",
    )


def test_coverage_report_tracks_real_gaps_without_inferring_absence(tmp_path: Path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "entities.json").write_text(json.dumps({
        "snapshot_date": "2026-08-13",
        "candidates": [
            {"id": "alice", "name": "Alice", "current_status": "declared_presidential", "status_confidence": "high"},
            {"id": "bob", "name": "Bob", "current_status": "potential", "status_confidence": "medium"},
        ],
        "parties": [{"id": "parti-a", "name": "Parti A"}],
    }), encoding="utf-8")

    write_proposal(tmp_path, "alice-retraites", entity="alice", topic="retraites")
    write_proposal(tmp_path, "parti-energie", entity="parti-a", topic="ecologie-energie")
    write_proposal(tmp_path, "old-alice", entity="alice", topic="services-publics", status="superseded")

    report = build_coverage(tmp_path)
    alice = next(row for row in report["actors"] if row["id"] == "alice")
    assert alice["current_proposals"] == 1
    assert alice["covered_topics"] == ["retraites"]
    assert "services-publics" in alice["gaps"]
    assert alice["coverage_ratio"] == round(1 / len(TOPICS), 4)
    assert report["summary"]["current_proposals"] == 2
    assert report["priority_gaps"][0]["id"] == "alice"

    rendered = render_markdown(report)
    assert "jamais « absence de position politique »" in rendered
    assert "Alice" in rendered
