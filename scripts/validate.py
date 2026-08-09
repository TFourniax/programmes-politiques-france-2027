#!/usr/bin/env python3
from collections import Counter
import json
from pathlib import Path
from common import ROOT, load_yaml, markdown_files, parse_markdown

ALLOWED_CANDIDATE_STATUSES = {
    "official_candidate", "declared_presidential", "party_designated",
    "declared_primary", "declared_conditional", "exploratory", "potential",
    "withdrawn", "not_running", "deceased", "unknown",
}
ALLOWED_CONFIDENCE = {"high", "medium", "low", "unverified"}
ALLOWED_CERTAINTY = {
    "explicit", "explicit_but_conditional", "explicit_but_underspecified",
    "inferred_from_multiple_explicit_statements",
    "attributed_by_secondary_source", "uncertain",
}


def require(meta, keys, path):
    missing = [k for k in keys if meta.get(k) in (None, "")]
    if missing:
        raise AssertionError(f"{path}: missing required field(s): {', '.join(missing)}")


def unique(values, label):
    dupes = [v for v, n in Counter(values).items() if n > 1]
    if dupes:
        raise AssertionError(f"Duplicate {label}: {dupes}")


def load_entities():
    path = ROOT / "data" / "entities.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main():
    entities = load_entities()
    if entities.get("snapshot_date") != "2026-08-09":
        raise AssertionError("data/entities.json must use the current V1 snapshot date 2026-08-09")

    candidates = entities.get("candidates", [])
    parties = entities.get("parties", [])
    candidate_ids = [c.get("id") for c in candidates]
    party_ids = [p.get("id") for p in parties]
    unique(candidate_ids, "candidate ids")
    unique(party_ids, "party ids")

    for candidate in candidates:
        require(candidate, ["id", "name", "current_status", "status_as_of", "status_confidence"], "data/entities.json")
        if candidate["current_status"] not in ALLOWED_CANDIDATE_STATUSES:
            raise AssertionError(f"Invalid candidate status: {candidate['current_status']} ({candidate['id']})")
        if candidate["status_confidence"] not in ALLOWED_CONFIDENCE:
            raise AssertionError(f"Invalid candidate confidence: {candidate['status_confidence']} ({candidate['id']})")
        if candidate.get("official_candidate") and candidate["current_status"] != "official_candidate":
            raise AssertionError(f"{candidate['id']}: official_candidate=true requires official_candidate status")
        if candidate["current_status"] == "official_candidate" and not candidate.get("official_candidate"):
            raise AssertionError(f"{candidate['id']}: official_candidate status requires official_candidate=true")

    # YAML registries remain public machine-readable mirrors/registries. They must at least parse.
    load_yaml("registries/candidates.yaml")
    load_yaml("registries/parties.yaml")
    load_yaml("registries/documents.yaml")
    load_yaml("registries/sources.yaml")

    document_ids = []
    for path in markdown_files("corpus/2027"):
        meta, body = parse_markdown(path)
        require(meta, ["document_id", "entity_id", "entity_type", "document_type", "document_status", "source_url"], path)
        if not body:
            raise AssertionError(f"{path}: empty document body")
        document_ids.append(meta["document_id"])
    if not document_ids:
        raise AssertionError("No corpus documents found")
    unique(document_ids, "document ids")
    document_ids = set(document_ids)

    proposal_ids = []
    for path in markdown_files("proposals"):
        meta, body = parse_markdown(path)
        require(meta, ["proposal_id", "entity_id", "topic", "certainty"], path)
        if meta["certainty"] not in ALLOWED_CERTAINTY:
            raise AssertionError(f"{path}: invalid certainty {meta['certainty']}")
        sources = meta.get("source_document_ids") or meta.get("source_document_id")
        if not sources:
            raise AssertionError(f"{path}: missing source_document_id or source_document_ids")
        if isinstance(sources, str):
            sources = [sources]
        for source in sources:
            if source not in document_ids:
                raise AssertionError(f"{path}: unknown source document {source}")
        if not body:
            raise AssertionError(f"{path}: empty proposal body")
        proposal_ids.append(meta["proposal_id"])
    unique(proposal_ids, "proposal ids")

    print(
        f"Validation OK: {len(candidates)} candidates, {len(parties)} parties, "
        f"{len(document_ids)} documents, {len(proposal_ids)} proposals"
    )


if __name__ == "__main__":
    main()
