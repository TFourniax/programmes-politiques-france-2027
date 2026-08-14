import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from build_coverage_report import build_coverage
from build_evidence_graph import build_graph


def test_active_candidate_topic_coverage_is_above_ten_percent():
    report = build_coverage(ROOT)
    summary = report["summary"]
    assert summary["active_candidate_topic_coverage_ratio"] > 0.10
    assert summary["active_candidate_covered_cells"] >= 33


def test_evidence_graph_separates_attachment_publisher_and_claim_actor():
    graph = build_graph(ROOT)
    relations = {edge["relation"] for edge in graph["edges"]}
    assert {"supports", "attached_to", "attributed_to"}.issubset(relations)
    proposal_nodes = [node for node in graph["nodes"] if node["kind"] == "proposal"]
    support_targets = {edge["object"] for edge in graph["edges"] if edge["relation"] == "supports"}
    assert all(node["id"] in support_targets for node in proposal_nodes)

    attal_document = "doc-gabriel-attal-2026-05-22-candidature"
    assert any(edge["subject"] == attal_document and edge["relation"] == "attached_to" and edge["object"] == "gabriel-attal" for edge in graph["edges"])
    assert not any(edge["subject"] == attal_document and edge["relation"] == "published_by" and edge["object"] == "gabriel-attal" for edge in graph["edges"])


def test_evidence_graph_snapshot_dates_come_from_canonical_registries():
    graph = build_graph(ROOT)
    expected = {}
    for key, filename in (("candidates", "candidates.yaml"), ("parties", "parties.yaml"), ("documents", "documents.yaml")):
        payload = yaml.safe_load((ROOT / "registries" / filename).read_text(encoding="utf-8")) or {}
        expected[key] = str(payload.get("snapshot_date"))[:10]
    assert graph["snapshotDates"] == expected
    assert graph["snapshotDate"] == max(expected.values())


def test_research_schemas_are_valid_json_and_quality_target_is_explicit():
    for name in ["candidate.schema.json", "document.schema.json", "proposal.schema.json", "evidence.schema.json"]:
        payload = json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))
        assert payload["$schema"].startswith("https://json-schema.org/")
    targets = json.loads((ROOT / "research" / "quality-targets.json").read_text(encoding="utf-8"))
    assert targets["active_candidate_topic_coverage_floor"] == 0.10
    assert targets["unsupported_political_claims_target"] == 0
