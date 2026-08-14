#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from common import ROOT, markdown_files, parse_markdown

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


def _topic_catalog(root: Path = ROOT) -> list[dict[str, str]]:
    preferred = root / "data" / "compass.json"
    path = preferred if preferred.exists() else ROOT / "data" / "compass.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    seen = set()
    for raw in data.get("questions") or []:
        if not isinstance(raw, dict):
            continue
        topic_id = str(raw.get("id") or "").strip()
        if not topic_id or topic_id in seen:
            continue
        seen.add(topic_id)
        rows.append({
            "id": topic_id,
            "label": str(raw.get("label") or topic_id),
            "description": str(raw.get("description") or ""),
        })
    if not rows:
        raise RuntimeError("No public topics found in data/compass.json")
    return rows


TOPIC_CATALOG = _topic_catalog(ROOT)
TOPICS = tuple(row["id"] for row in TOPIC_CATALOG)
TOPIC_LABELS = {row["id"]: row["label"] for row in TOPIC_CATALOG}


def _first_heading(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _compact_day(value: Any) -> str | None:
    raw = str(value or "").strip()
    match = re.match(r"^(\d{4}(?:-\d{2}(?:-\d{2})?)?)", raw)
    return match.group(1) if match else None


def _proposal_evidence_day(meta: dict[str, Any]) -> str | None:
    for field in ("last_confirmed_at", "source_published_at", "first_documented_at"):
        parsed = _compact_day(meta.get(field))
        if parsed:
            return parsed
    return None


def _source_count(meta: dict[str, Any]) -> int:
    explicit = meta.get("confirmation_count")
    if isinstance(explicit, int) and explicit > 0:
        return explicit
    source_ids = meta.get("source_document_ids") or meta.get("source_document_id") or []
    if isinstance(source_ids, str):
        source_ids = [source_ids]
    return len({str(item) for item in source_ids if str(item).strip()})


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


def _proposal_rows(root: Path, topics: tuple[str, ...] = TOPICS) -> list[dict[str, Any]]:
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
        if not entity_id or topic not in topics:
            continue
        rows.append({
            "path": path.relative_to(root).as_posix(),
            "proposal_id": str(meta.get("proposal_id") or path.stem),
            "entity_id": entity_id,
            "topic": topic,
            "title": str(meta.get("title") or _first_heading(body) or path.stem),
            "certainty": str(meta.get("certainty") or ""),
            "source_url": str(meta.get("source_url") or ""),
            "verification_state": str(meta.get("verification_state") or ""),
            "evidence_date": _proposal_evidence_day(meta),
            "source_count": _source_count(meta),
        })
    return rows


def _latest_day(rows: list[dict[str, Any]]) -> str | None:
    values = [row.get("evidence_date") for row in rows if row.get("evidence_date")]
    return max(values) if values else None


def _topic_matrix_row(entity: dict[str, Any], actor_proposals: list[dict[str, Any]], topic_catalog: list[dict[str, str]]) -> dict[str, Any]:
    by_topic: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for proposal in actor_proposals:
        by_topic[proposal["topic"]].append(proposal)
    topics = []
    for topic in topic_catalog:
        rows = by_topic.get(topic["id"], [])
        topics.append({
            "id": topic["id"],
            "label": topic["label"],
            "covered": bool(rows),
            "current_proposals": len(rows),
            "latest_evidence_at": _latest_day(rows),
            "verified_proposals": sum(row.get("verification_state") == "verified" for row in rows),
            "multi_source_proposals": sum((row.get("source_count") or 0) >= 2 for row in rows),
        })
    return {
        "id": entity["id"],
        "name": entity["name"],
        "status": entity.get("status"),
        "coverage_ratio": round(sum(row["covered"] for row in topics) / len(topics), 4) if topics else 0,
        "current_proposals": len(actor_proposals),
        "latest_evidence_at": _latest_day(actor_proposals),
        "topics": topics,
    }


def build_coverage(root: Path = ROOT) -> dict[str, Any]:
    root = root.resolve()
    topic_catalog = _topic_catalog(root)
    topics = tuple(row["id"] for row in topic_catalog)
    labels = {row["id"]: row["label"] for row in topic_catalog}
    entities = _entity_catalog(root)
    proposals = _proposal_rows(root, topics)
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
        gaps = [topic for topic in topics if topic not in covered]
        ratio = len(covered) / len(topics)
        actor_rows.append({
            **entity,
            "current_proposals": len(actor_proposals),
            "covered_topics": covered,
            "coverage_ratio": round(ratio, 4),
            "gaps": gaps,
            "latest_evidence_at": _latest_day(actor_proposals),
            "verified_proposals": sum(row.get("verification_state") == "verified" for row in actor_proposals),
            "multi_source_proposals": sum((row.get("source_count") or 0) >= 2 for row in actor_proposals),
        })

    topic_rows = []
    actor_count = len(actor_rows)
    for topic in topics:
        topic_proposals = by_topic.get(topic, [])
        actor_ids = sorted({row["entity_id"] for row in topic_proposals})
        topic_rows.append({
            "id": topic,
            "label": labels.get(topic, topic),
            "current_proposals": len(topic_proposals),
            "actors_covered": len(actor_ids),
            "actor_coverage_ratio": round(len(actor_ids) / actor_count, 4) if actor_count else 0,
            "latest_evidence_at": _latest_day(topic_proposals),
            "verified_proposals": sum(row.get("verification_state") == "verified" for row in topic_proposals),
            "multi_source_proposals": sum((row.get("source_count") or 0) >= 2 for row in topic_proposals),
        })

    declared = [row for row in actor_rows if row["type"] == "candidate" and row.get("status") in ACTIVE_CANDIDATE_STATUSES]
    declared_by_id = {row["id"]: row for row in declared}
    active_matrix = [
        _topic_matrix_row(row, by_actor.get(row["id"], []), topic_catalog)
        for row in sorted(declared, key=lambda item: item["name"].casefold())
    ]
    priority_gaps = sorted(declared, key=lambda row: (row["coverage_ratio"], row["current_proposals"], row["name"].casefold()))
    covered_cells = sum(len(row["covered_topics"]) for row in actor_rows)
    total_cells = actor_count * len(topics)
    active_covered_cells = sum(len(declared_by_id[row["id"]]["covered_topics"]) for row in active_matrix)
    active_total_cells = len(active_matrix) * len(topics)
    certainty_counts = Counter(row["certainty"] or "unspecified" for row in proposals)
    entities_json = json.loads((root / "data" / "entities.json").read_text(encoding="utf-8"))

    return {
        "version": 2,
        "snapshot_date": entities_json.get("snapshot_date"),
        "scope": "current_canonical_proposals",
        "summary": {
            "actors": actor_count,
            "declared_or_active_candidates": len(declared),
            "topics": len(topics),
            "current_proposals": len(proposals),
            "covered_actor_topic_cells": covered_cells,
            "total_actor_topic_cells": total_cells,
            "actor_topic_coverage_ratio": round(covered_cells / total_cells, 4) if total_cells else 0,
            "active_candidate_covered_cells": active_covered_cells,
            "active_candidate_total_cells": active_total_cells,
            "active_candidate_topic_coverage_ratio": round(active_covered_cells / active_total_cells, 4) if active_total_cells else 0,
            "verified_proposals": sum(row.get("verification_state") == "verified" for row in proposals),
            "multi_source_proposals": sum((row.get("source_count") or 0) >= 2 for row in proposals),
            "latest_evidence_at": _latest_day(proposals),
            "certainty_counts": dict(sorted(certainty_counts.items())),
        },
        "topic_catalog": topic_catalog,
        "actors": actor_rows,
        "topics": topic_rows,
        "active_candidate_matrix": active_matrix,
        "priority_gaps": [{
            "id": row["id"],
            "name": row["name"],
            "status": row.get("status"),
            "coverage_ratio": row["coverage_ratio"],
            "current_proposals": row["current_proposals"],
            "latest_evidence_at": row.get("latest_evidence_at"),
            "gaps": row["gaps"],
        } for row in priority_gaps[:25]],
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
        f"- {summary['covered_actor_topic_cells']} / {summary['total_actor_topic_cells']} cases acteur × thème couvertes ({summary['actor_topic_coverage_ratio'] * 100:.1f} %) ;",
        f"- {summary['active_candidate_covered_cells']} / {summary['active_candidate_total_cells']} cases candidat actif × thème couvertes ({summary['active_candidate_topic_coverage_ratio'] * 100:.1f} %) ;",
        f"- {summary['verified_proposals']} propositions marquées vérifiées ; {summary['multi_source_proposals']} appuyées par au moins deux documents de preuve.", "",
        "## Priorités documentaires", "",
    ]
    for row in report["priority_gaps"][:15]:
        missing = ", ".join(row["gaps"][:6])
        suffix = "…" if len(row["gaps"]) > 6 else ""
        freshness = f" ; dernière preuve {row['latest_evidence_at']}" if row.get("latest_evidence_at") else ""
        lines.append(f"- **{row['name']}** — {row['coverage_ratio'] * 100:.0f} % des thèmes ; {row['current_proposals']} proposition(s){freshness} ; lacunes prioritaires : {missing}{suffix}")
    lines.extend(["", "## Couverture par thème", ""])
    for row in sorted(report["topics"], key=lambda item: (item["actors_covered"], item["id"])):
        freshness = f", dernière preuve {row['latest_evidence_at']}" if row.get("latest_evidence_at") else ""
        lines.append(f"- **{row.get('label') or row['id']}** (`{row['id']}`) — {row['actors_covered']} acteur(s), {row['current_proposals']} proposition(s){freshness}.")
    lines.extend(["", "> Ce rapport est un indicateur de couverture structurée, de fraîcheur et de profondeur de preuve, pas un score de qualité politique ni d'exhaustivité absolue.", ""])
    return "\n".join(lines)


def main() -> None:
    report = build_coverage(ROOT)
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUTPUT_MD.write_text(render_markdown(report), encoding="utf-8")
    print(
        "COVERAGE_REPORT_OK:",
        f"proposals={report['summary']['current_proposals']},",
        f"actor_topic_coverage={report['summary']['actor_topic_coverage_ratio']:.3f},",
        f"active_candidate_coverage={report['summary']['active_candidate_topic_coverage_ratio']:.3f}",
    )


if __name__ == "__main__":
    main()
