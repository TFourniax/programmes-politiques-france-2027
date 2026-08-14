#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from build_coverage_report import build_coverage
from build_evidence_graph import build_graph
from common import ROOT

REQUIRED_FILES = [
    "CITATION.cff",
    "GOVERNANCE.md",
    "CORRECTIONS_POLICY.md",
    "CONFLICTS_OF_INTEREST.md",
    "SECURITY.md",
    "DATA_DICTIONARY.md",
    "docs/EVIDENCE_MODEL.md",
    "docs/RESEARCH_RELEASES.md",
    "docs/EXTERNAL_REVIEW_PROTOCOL.md",
]
SCHEMAS = ["candidate.schema.json", "document.schema.json", "proposal.schema.json", "evidence.schema.json"]


def main() -> None:
    targets = json.loads((ROOT / "research" / "quality-targets.json").read_text(encoding="utf-8"))
    missing = [path for path in REQUIRED_FILES if not (ROOT / path).exists()]
    if missing:
        raise SystemExit(f"Research governance files missing: {missing}")
    for name in SCHEMAS:
        json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))

    coverage = build_coverage(ROOT)
    summary = coverage["summary"]
    ratio = float(summary.get("active_candidate_topic_coverage_ratio") or 0)
    floor = float(targets["active_candidate_topic_coverage_floor"])
    if ratio < floor:
        raise SystemExit(f"Active candidate-topic coverage {ratio:.2%} is below research floor {floor:.2%}")

    graph = build_graph(ROOT)
    if graph["counts"]["supportEdges"] < graph["counts"]["proposals"]:
        raise SystemExit("Evidence graph has fewer support edges than proposal nodes")

    print(
        "Research quality OK: "
        f"active coverage {summary['active_candidate_covered_cells']}/{summary['active_candidate_total_cells']} "
        f"({ratio:.2%}), {summary['verified_proposals']} verified proposals, "
        f"{graph['counts']['supportEdges']} support edges"
    )


if __name__ == "__main__":
    main()
