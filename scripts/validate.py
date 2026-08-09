#!/usr/bin/env python3
from collections import Counter
from common import load_yaml, markdown_files, parse_markdown

ALLOWED_CANDIDATE_STATUSES = {
    "official_candidate", "declared_presidential", "party_designated",
    "declared_primary", "declared_conditional", "exploratory", "potential",
    "withdrawn", "not_running", "deceased", "unknown",
}
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


def main():
    candidates = load_yaml("registries/candidates.yaml").get("candidates", [])
    parties = load_yaml("registries/parties.yaml").get("parties", [])
    load_yaml("registries/documents.yaml")
    load_yaml("registries/sources.yaml")

    candidate_ids = [c.get("id") for c in candidates]
    party_ids = [p.get("id") for p in parties]
    unique(candidate_ids, "candidate ids")
    unique(party_ids, "party ids")
    for candidate in candidates:
        require(candidate, ["id", "name", "current_status", "verification_state"], "registries/candidates.yaml")
        if candidate["current_status"] not in ALLOWED_CANDIDATE_STATUSES:
            raise AssertionError(f"Invalid candidate status: {candidate['current_status']} ({candidate['id']})")

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
        require(meta, ["proposal_id", "entity_id", "topic", "source_document_id", "certainty"], path)
        if meta["certainty"] not in ALLOWED_CERTAINTY:
            raise AssertionError(f"{path}: invalid certainty {meta['certainty']}")
        if meta["source_document_id"] not in document_ids:
            raise AssertionError(f"{path}: unknown source_document_id {meta['source_document_id']}")
        if not body:
            raise AssertionError(f"{path}: empty proposal body")
        proposal_ids.append(meta["proposal_id"])
    unique(proposal_ids, "proposal ids")

    print(f"Validation OK: {len(candidates)} candidates, {len(parties)} parties, {len(document_ids)} documents, {len(proposal_ids)} proposals")


if __name__ == "__main__":
    main()
