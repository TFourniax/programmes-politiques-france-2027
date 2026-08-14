#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from common import ROOT, parse_markdown


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _list(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return []


def _markdown_files(root: Path, relative: str) -> list[Path]:
    base = root / relative
    if not base.exists():
        return []
    return sorted(path for path in base.rglob("*.md") if path.is_file())


def build_graph(root: Path = ROOT) -> dict[str, Any]:
    root = root.resolve()
    entities = json.loads((root / "data" / "entities.json").read_text(encoding="utf-8"))
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    document_meta: dict[str, dict[str, Any]] = {}

    for group, kind in (("candidates", "candidate"), ("parties", "party")):
        for row in entities.get(group, []):
            entity_id = str(row.get("id") or "").strip()
            if entity_id:
                nodes.append({"id": entity_id, "kind": "entity", "entity_type": kind, "name": row.get("name")})

    for path in _markdown_files(root, "corpus/2027"):
        meta, _ = parse_markdown(path)
        document_id = str(meta.get("document_id") or "").strip()
        if not document_id:
            continue
        document_meta[document_id] = meta
        nodes.append({
            "id": document_id,
            "kind": "document",
            "entity_id": meta.get("entity_id"),
            "document_status": meta.get("document_status"),
            "source_tier": meta.get("source_tier"),
            "source_url": meta.get("source_url"),
            "published_at": _json_value(meta.get("published_at")),
            "retrieved_at": _json_value(meta.get("retrieved_at")),
            "canonical_path": path.relative_to(root).as_posix(),
            "canonical_sha256": _hash(path),
        })
        if meta.get("entity_id"):
            edges.append({"subject": document_id, "relation": "published_by", "object": str(meta["entity_id"])})

    for path in _markdown_files(root, "proposals"):
        meta, _ = parse_markdown(path)
        proposal_id = str(meta.get("proposal_id") or "").strip()
        if not proposal_id:
            continue
        nodes.append({
            "id": proposal_id,
            "kind": "proposal",
            "entity_id": meta.get("entity_id"),
            "topic": meta.get("topic"),
            "certainty": meta.get("certainty"),
            "proposal_status": meta.get("proposal_status", "current"),
            "source_published_at": _json_value(meta.get("source_published_at")),
            "last_confirmed_at": _json_value(meta.get("last_confirmed_at")),
            "canonical_path": path.relative_to(root).as_posix(),
            "canonical_sha256": _hash(path),
        })
        if meta.get("entity_id"):
            edges.append({"subject": proposal_id, "relation": "attributed_to", "object": str(meta["entity_id"])})
        for document_id in _list(meta.get("source_document_ids") or meta.get("source_document_id")):
            edge = {"subject": document_id, "relation": "supports", "object": proposal_id}
            source_url = (document_meta.get(document_id) or {}).get("source_url") or meta.get("source_url")
            if source_url:
                edge["source_url"] = source_url
            edges.append(edge)
        if meta.get("supersedes"):
            edges.append({"subject": proposal_id, "relation": "supersedes", "object": str(meta["supersedes"])})
        for relation in meta.get("evidence_relations") or []:
            if not isinstance(relation, dict):
                continue
            rel = str(relation.get("relation") or "").strip()
            subject = str(relation.get("subject") or "").strip()
            obj = str(relation.get("object") or proposal_id).strip()
            if rel and subject and obj:
                edge = {"subject": subject, "relation": rel, "object": obj}
                if relation.get("source_url"):
                    edge["source_url"] = relation["source_url"]
                if relation.get("note"):
                    edge["note"] = relation["note"]
                edges.append(edge)

    deduped = []
    seen = set()
    for edge in edges:
        key = (edge["subject"], edge["relation"], edge["object"], edge.get("source_url"), edge.get("note"))
        if key not in seen:
            seen.add(key)
            deduped.append(edge)

    return {
        "version": 1,
        "sourceOfTruth": "versioned_markdown_yaml",
        "snapshotDate": entities.get("snapshot_date"),
        "derived": True,
        "counts": {
            "nodes": len(nodes),
            "edges": len(deduped),
            "entities": sum(node["kind"] == "entity" for node in nodes),
            "documents": sum(node["kind"] == "document" for node in nodes),
            "proposals": sum(node["kind"] == "proposal" for node in nodes),
            "supportEdges": sum(edge["relation"] == "supports" for edge in deduped),
        },
        "nodes": nodes,
        "edges": deduped,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the derived evidence/provenance graph")
    parser.add_argument("--output", default="generated/evidence-graph.json")
    args = parser.parse_args()
    graph = build_graph(ROOT)
    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        display = output.relative_to(ROOT)
    except ValueError:
        display = output
    print(f"Evidence graph OK: {graph['counts']['nodes']} nodes, {graph['counts']['edges']} edges -> {display}")


if __name__ == "__main__":
    main()
