from __future__ import annotations

import json
import re
from datetime import date, datetime
from urllib.parse import urlparse

from common import ROOT, markdown_files, parse_markdown

CANDIDATE_STATUSES = {
    "official_candidate", "declared_presidential", "party_designated", "declared_primary",
    "declared_conditional", "exploratory", "potential", "withdrawn", "not_running", "deceased", "unknown"
}
CONFIDENCE = {"high", "medium", "low", "unknown"}
SOURCE_TIERS = {"tier_1_primary_official", "tier_2_primary_statement", "tier_3_reliable_secondary", "tier_4_discovery_only"}
DOCUMENT_TYPES = {
    "official_presidential_programme", "presidential_preprogramme", "party_programme", "party_platform", "manifesto",
    "thematic_platform", "policy_proposal", "candidacy_declaration", "official_speech", "official_press_release",
    "official_interview", "official_video_transcript", "campaign_website_page", "primary_platform", "coalition_agreement",
    "secondary_summary", "fact_check", "historical_reference", "other"
}
DOCUMENT_STATUSES = {"current", "superseded", "amended", "withdrawn", "draft", "archived", "unknown"}
CERTAINTIES = {
    "explicit", "explicit_but_conditional", "explicit_but_underspecified",
    "inferred_from_multiple_explicit_statements", "attributed_by_secondary_source", "uncertain"
}
RIGHTS = {"open_license", "public_domain", "permission_granted", "quotation_only", "link_only", "unknown", "restricted"}
TOPICS = {
    "pouvoir-achat-travail", "retraites", "fiscalite-redistribution", "immigration-integration", "europe-souverainete",
    "ecologie-energie", "institutions-democratie", "services-publics", "securite-justice", "economie-finances"
}
PRIMARY_TIERS = {"tier_1_primary_official", "tier_2_primary_statement"}
MIN_CANDIDATES = 40
MIN_PARTIES = 25
MIN_DOCUMENTS = 20
MIN_PROPOSALS = 25
MAX_SNAPSHOT_AGE_DAYS = 14


def assert_url(value: str | None, label: str, required: bool = True) -> None:
    if not value:
        if required:
            raise AssertionError(f"Missing URL: {label}")
        return
    parsed = urlparse(str(value))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AssertionError(f"Invalid URL for {label}: {value}")


def parse_iso_day(value: str, label: str) -> date:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError as exc:
        raise AssertionError(f"Invalid ISO date for {label}: {value}") from exc


def load_entities() -> dict:
    path = ROOT / "data" / "entities.json"
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not str(data.get("election") or "").strip():
        raise AssertionError("data/entities.json must declare the election")
    snapshot = parse_iso_day(data.get("snapshot_date"), "snapshot_date")
    if snapshot > date.today():
        raise AssertionError("snapshot_date cannot be in the future")
    age = (date.today() - snapshot).days
    if age > MAX_SNAPSHOT_AGE_DAYS:
        raise AssertionError(f"Political snapshot is stale: {age} days old (max {MAX_SNAPSHOT_AGE_DAYS})")
    return data


def validate_entities(data: dict) -> tuple[set[str], set[str]]:
    candidates = data.get("candidates") or []
    parties = data.get("parties") or []
    if len(candidates) < MIN_CANDIDATES:
        raise AssertionError(f"Need at least {MIN_CANDIDATES} tracked personalities, found {len(candidates)}")
    if len(parties) < MIN_PARTIES:
        raise AssertionError(f"Need at least {MIN_PARTIES} parties/movements, found {len(parties)}")

    candidate_ids = [item.get("id") for item in candidates]
    party_ids = [item.get("id") for item in parties]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise AssertionError("Duplicate candidate ids")
    if len(party_ids) != len(set(party_ids)):
        raise AssertionError("Duplicate party ids")
    party_set = set(party_ids)

    for candidate in candidates:
        cid = candidate.get("id")
        if not cid or not candidate.get("name"):
            raise AssertionError(f"Invalid candidate record: {candidate}")
        status = candidate.get("current_status")
        confidence = candidate.get("status_confidence")
        if status not in CANDIDATE_STATUSES:
            raise AssertionError(f"Invalid candidate status for {cid}: {status}")
        if confidence not in CONFIDENCE:
            raise AssertionError(f"Invalid status_confidence for {cid}: {confidence}")
        if candidate.get("official_candidate") is True and status != "official_candidate":
            raise AssertionError(f"official_candidate=true requires status official_candidate: {cid}")
        if status == "official_candidate" and candidate.get("official_candidate") is not True:
            raise AssertionError(f"official_candidate status requires boolean true: {cid}")
        party_id = candidate.get("primary_party_id")
        if party_id and party_id not in party_set:
            raise AssertionError(f"Unknown primary_party_id for {cid}: {party_id}")
        for affiliation in candidate.get("affiliations") or []:
            if affiliation not in party_set:
                raise AssertionError(f"Unknown affiliation for {cid}: {affiliation}")
        status_day = parse_iso_day(candidate.get("status_as_of"), f"{cid}.status_as_of")
        if status_day > parse_iso_day(data["snapshot_date"], "snapshot_date"):
            raise AssertionError(f"status_as_of after snapshot for {cid}")
        if candidate.get("declared_at"):
            parse_iso_day(candidate["declared_at"], f"{cid}.declared_at")
        tier = candidate.get("source_tier")
        if tier not in SOURCE_TIERS:
            raise AssertionError(f"Invalid source_tier for {cid}: {tier}")
        assert_url(candidate.get("source_url"), f"candidate {cid}")
        if confidence == "high" and tier not in PRIMARY_TIERS:
            raise AssertionError(f"High-confidence candidate status must use primary/direct evidence: {cid} ({tier})")

    for party in parties:
        pid = party.get("id")
        if not pid or not party.get("name"):
            raise AssertionError(f"Invalid party record: {party}")
        assert_url(party.get("official_website"), f"party {pid}", required=False)

    return set(candidate_ids), party_set


def validate_documents(entity_ids: set[str]) -> set[str]:
    files = list(markdown_files("corpus/2027"))
    if len(files) < MIN_DOCUMENTS:
        raise AssertionError(f"Need at least {MIN_DOCUMENTS} corpus documents, found {len(files)}")
    document_ids: set[str] = set()
    for path in files:
        meta, body = parse_markdown(path)
        doc_id = meta.get("document_id")
        if not doc_id or doc_id in document_ids:
            raise AssertionError(f"Missing or duplicate document_id: {path}")
        document_ids.add(doc_id)
        entity_id = meta.get("entity_id")
        if entity_id not in entity_ids:
            raise AssertionError(f"Unknown entity_id in {path}: {entity_id}")
        if meta.get("entity_type") not in {"candidate", "party"}:
            raise AssertionError(f"Invalid entity_type in {path}: {meta.get('entity_type')}")
        if meta.get("document_type") not in DOCUMENT_TYPES:
            raise AssertionError(f"Invalid document_type in {path}: {meta.get('document_type')}")
        if meta.get("document_status") not in DOCUMENT_STATUSES:
            raise AssertionError(f"Invalid document_status in {path}: {meta.get('document_status')}")
        if meta.get("source_tier") not in SOURCE_TIERS:
            raise AssertionError(f"Invalid source_tier in {path}: {meta.get('source_tier')}")
        if meta.get("rights_status") not in RIGHTS:
            raise AssertionError(f"Invalid or missing rights_status in {path}: {meta.get('rights_status')}")
        assert_url(meta.get("source_url"), f"document {doc_id}")
        for topic in meta.get("topics") or []:
            if topic not in TOPICS:
                raise AssertionError(f"Invalid topic in {path}: {topic}")
        if not body.strip() or len(re.sub(r"\s+", " ", body).strip()) < 80:
            raise AssertionError(f"Document body too shallow: {path}")
    return document_ids


def validate_proposals(entity_ids: set[str], document_ids: set[str]) -> int:
    files = list(markdown_files("proposals"))
    if len(files) < MIN_PROPOSALS:
        raise AssertionError(f"Need at least {MIN_PROPOSALS} atomic proposals, found {len(files)}")
    proposal_ids: set[str] = set()
    for path in files:
        meta, body = parse_markdown(path)
        proposal_id = meta.get("proposal_id")
        if not proposal_id or proposal_id in proposal_ids:
            raise AssertionError(f"Missing or duplicate proposal_id: {path}")
        proposal_ids.add(proposal_id)
        if meta.get("entity_id") not in entity_ids:
            raise AssertionError(f"Unknown proposal entity in {path}: {meta.get('entity_id')}")
        if meta.get("topic") not in TOPICS:
            raise AssertionError(f"Invalid proposal topic in {path}: {meta.get('topic')}")
        if meta.get("certainty") not in CERTAINTIES:
            raise AssertionError(f"Invalid certainty in {path}: {meta.get('certainty')}")
        source_ids = meta.get("source_document_ids") or meta.get("source_document_id")
        if isinstance(source_ids, str):
            source_ids = [source_ids]
        if not source_ids or not set(source_ids).issubset(document_ids):
            raise AssertionError(f"Proposal points to missing source document: {path}: {source_ids}")
        assert_url(meta.get("source_url"), f"proposal {proposal_id}", required=False)
        if not body.strip() or len(re.sub(r"\s+", " ", body).strip()) < 40:
            raise AssertionError(f"Proposal body too shallow: {path}")
    return len(files)


def main() -> None:
    data = load_entities()
    candidate_ids, party_ids = validate_entities(data)
    all_entities = candidate_ids | party_ids
    documents = validate_documents(all_entities)
    proposal_count = validate_proposals(all_entities, documents)
    print(
        f"Production validation OK: snapshot {data['snapshot_date']}, "
        f"{len(candidate_ids)} personalities, {len(party_ids)} parties, "
        f"{len(documents)} documents, {proposal_count} proposals"
    )


if __name__ == "__main__":
    main()
