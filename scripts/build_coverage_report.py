#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from common import ROOT, markdown_files, parse_markdown

TOPICS = (
    "economie-finances",
    "pouvoir-achat-travail",
    "fiscalite-redistribution",
    "retraites",
    "immigration-integration",
    "securite-justice",
    "institutions-democratie",
    "defense-international",
    "europe-souverainete",
    "ecologie-energie",
    "services-publics",
    "numerique-ia",
)
ACTIVE_CANDIDATE_STATUSES = {
    "official_candidate",
    "declared_presidential",
    "party_designated",
    "declared_primary",
    "declared_conditional",
    "exploratory",
}
OUTPUT_JSON = ROOT / "research" / "veille" / "coverage.json"
OUTPUT_MD = ROOT / "research" / "veille" / "coverage.md"


def _first_heading(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _entity_catalog(root: Path) -> dict[str, dict[str, Any]]:
    path = root / "data" / "entities.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    catalog: dict[str, dict[str, Any]] = {}
    for group, kind in (("candidates", "candidate"), ("parties", "party")):
        for row in data.get(group, []):
            if not isinstance(row, dict) or not row.get("id"):
                continue
            catalog[str(row["id"])] = {
                "id": str(row["id"]),
                "name": str(row.get("name") or row["id"]),
                "type": kind,
                "status": row.get("current_status") or row.get("status"),
                "confidence": row.get("status_confidence"),
            }
    return catalog


def _proposal_rows(root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    proposal_root = root / "proposals"
    if not proposal_root.exists():
        return rows
    for path in sorted(proposal_root.rglob("*.md")):
        try:
            meta, body = parse_markdown(path)
        except Exception:
            continue
        status = str(meta.get("proposal_status") or "current")
        if status != "current":
            continue
        entity_id = str(meta.get("entity_id") or "").strip()
        topic = str(meta.get("topic") or "").strip()
        if not entity_id or topic not in TOPICS:
            continue
        rows.append({
            "path": path.relative_to(root).as_posix(),
            "proposal_id": str(meta.get("proposal_id") or path.stem),
            "entity_id": entity_id,
            "topic": topic,
            "title": str(meta.get("title") or _first_heading(body) or path.stem),
            "certainty": str(meta.get("certainty") or ""),
            "source_url": str(meta.get("source_url") or ""),
        })
    return rows


def build_coverage(root: Path = ROOT) -> dict[str, Any]:
    root = root.resolve()
    entities = _entity_catalog(root)
    proposals = _proposal_rows(root)
    by_actor: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_topic: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in proposals:
        by_actor[row["entity_id"]].append(row)
        by_topic[row["topic"]].append(row)
        if row["entity_id"] not in entities:
            entities[row["entity_id"]] = {
                "id": row["entity_id"],
                "name": row["entity_id"],
                "type": "unknown",
                "status": None,
                "confidence": None,
            }
    actor_rows = []
    for entity_id, entity in sorted(entities.items(), key=lambda item: item[1]["name"].casefold()):
        actor_proposals = by_actor.get(entity_id, [])
        covered = sorted({row["topic"] for row in actor_proposals})
        gaps = [topic for topic in TOPICS if topic not in covered]
        ratio = len(covered) / len(TOPICS)
        actor_rows.append({**entity, "current_proposals": len(actor_proposals), "covered_topics": covered, "coverage_ratio": round(ratio, 4), "gaps": gaps})
    topic_rows = []
    actor_count = len(actor_rows)
    for topic in TOPICS:
        actor_ids = sorted({row["entity_id"] for row in by_topic.get(topic, [])})
        topic_rows.append({"id": topic, "current_proposals": len(by_topic.get(topic, [])), "actors_covered": len(actor_ids), "actor_coverage_ratio": round(len(actor_ids) / actor_count, 4) if actor_count else 0})
    declared = [row for row in actor_rows if row["type"] == "candidate" and row.get("status") in ACTIVE_CANDIDATE_STATUSES]
    priority_gaps = sorted(declared, key=lambda row: (row["coverage_ratio"], row["current_proposals"], row["name"].casefold()))
    covered_cells = sum(len(row["covered_topics"]) for row in actor_rows)
    total_cells = actor_count * len(TOPICS)
    certainty_counts = Counter(row["certainty"] or "unspecified" for row in proposals)
    entities_json = json.loads((root / "data" / "entities.json").read_text(encoding="utf-8"))
    return {
        "version": 1,
        "snapshot_date": entities_json.get("snapshot_date"),
        "scope": "current_canonical_proposals",
        "summary": {"actors": actor_count, "declared_or_active_candidates": len(declared), "topics": len(TOPICS), "current_proposals": len(proposals), "covered_actor_topic_cells": covered_cells, "total_actor_topic_cells": total_cells, "actor_topic_coverage_ratio": round(covered_cells / total_cells, 4) if total_cells else 0, "certainty_counts": dict(sorted(certainty_counts.items()))},
        "actors": actor_rows,
        "topics": topic_rows,
        "priority_gaps": [{"id": row["id"], "name": row["name"], "status": row.get("status"), "coverage_ratio": row["coverage_ratio"], "current_proposals": row["current_proposals"], "gaps": row["gaps"]} for row in priority_gaps[:25]],
    }


def render_markdown(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Couverture automatique du corpus", "",
        f"Instantané canonique : **{report.get('snapshot_date') or 'inconnu'}**.", "",
        "Ce rapport est dérivé automatiquement du corpus courant. Il sert à piloter la veille : une case vide signifie « information non encore structurée dans le corpus », jamais « absence de position politique ».", "",
        "## Synthèse", "",
        f"- {summary['actors']} acteurs référencés ;",
        f"- {summary['declared_or_active_candidates']} candidatures actives ou déclarées suivies ;",
        f"- {summary['current_proposals']} propositions atomiques courantes ;",
        f"- {summary['covered_actor_topic_cells']} / {summary['total_actor_topic_cells']} cases acteur × thème couvertes ({summary['actor_topic_coverage_ratio'] * 100:.1f} %).", "",
        "## Priorités documentaires", "",
    ]
    for row in report["priority_gaps"][:15]:
        missing = ", ".join(row["gaps"][:6])
        suffix = "…" if len(row["gaps"]) > 6 else ""
        lines.append(f"- **{row['name']}** — {row['coverage_ratio'] * 100:.0f} % des thèmes ; {row['current_proposals']} proposition(s) ; lacunes prioritaires : {missing}{suffix}")
    lines.extend(["", "## Couverture par thème", ""])
    for row in sorted(report["topics"], key=lambda item: (item["actors_covered"], item["id"])):
        lines.append(f"- `{row['id']}` — {row['actors_covered']} acteur(s), {row['current_proposals']} proposition(s).")
    lines.extend(["", "> Ce rapport est un indicateur de couverture structurée, pas un score de qualité politique ni d'exhaustivité absolue.", ""])
    return "\n".join(lines)


def main() -> None:
    report = build_coverage(ROOT)
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUTPUT_MD.write_text(render_markdown(report), encoding="utf-8")
    print("COVERAGE_REPORT_OK:", f"proposals={report['summary']['current_proposals']},", f"actor_topic_coverage={report['summary']['actor_topic_coverage_ratio']:.3f}")


if __name__ == "__main__":
    main()
