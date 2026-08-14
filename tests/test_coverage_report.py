from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_coverage_report import TOPICS, build_coverage, render_markdown  # noqa: E402
import validate as validate_module  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]


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
        "verification_state: verified\n"
        "first_documented_at: 2026-08-13\n"
        "source_document_ids: [doc-a, doc-b]\n"
        "source_url: https://example.org/source\n"
        "---\n"
        f"# Mesure {name}\n\nTexte de test.\n",
        encoding="utf-8",
    )


def test_public_topic_taxonomy_is_shared_by_ui_validator_and_coverage():
    compass = json.loads((ROOT / "data" / "compass.json").read_text(encoding="utf-8"))
    ids = tuple(row["id"] for row in compass["questions"])
    assert ids == TOPICS
    assert set(ids) == validate_module.PROPOSAL_TOPICS
    assert "defense-international" in ids
    assert "numerique-ia" in ids
    assert len(ids) >= 12


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
    assert alice["latest_evidence_at"] == "2026-08-13"
    assert alice["verified_proposals"] == 1
    assert alice["multi_source_proposals"] == 1

    assert report["summary"]["current_proposals"] == 2
    assert report["summary"]["declared_or_active_candidates"] == 1
    assert report["summary"]["active_candidate_covered_cells"] == 1
    assert report["summary"]["active_candidate_total_cells"] == len(TOPICS)
    assert report["summary"]["active_candidate_topic_coverage_ratio"] == round(1 / len(TOPICS), 4)
    assert report["priority_gaps"][0]["id"] == "alice"

    matrix = report["active_candidate_matrix"]
    assert len(matrix) == 1
    assert matrix[0]["id"] == "alice"
    assert len(matrix[0]["topics"]) == len(TOPICS)
    retirement = next(row for row in matrix[0]["topics"] if row["id"] == "retraites")
    assert retirement["covered"] is True
    assert retirement["multi_source_proposals"] == 1
    defense = next(row for row in matrix[0]["topics"] if row["id"] == "defense-international")
    assert defense["covered"] is False

    rendered = render_markdown(report)
    assert "jamais « absence de position politique »" in rendered
    assert "candidat actif × thème" in rendered
    assert "Alice" in rendered
