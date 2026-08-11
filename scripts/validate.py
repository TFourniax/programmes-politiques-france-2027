from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
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
    "official_interview", "official_video_transcript", "campaign_website_page", "primary_platform", "primary_result",
    "coalition_agreement", "secondary_summary", "fact_check", "historical_reference", "other"
}
DOCUMENT_STATUSES = {"current", "superseded", "amended", "withdrawn", "draft", "archived", "unknown"}
CERTAINTIES = {
    "explicit", "explicit_but_conditional", "explicit_but_underspecified",
    "inferred_from_multiple_explicit_statements", "attributed_by_secondary_source", "uncertain"
}
RIGHTS = {"open_license", "public_domain", "permission_granted", "quotation_only", "link_only", "unknown", "restricted"}
PROPOSAL_TOPICS = {
    "pouvoir-achat-travail", "retraites", "fiscalite-redistribution", "immigration-integration", "europe-souverainete",
    "ecologie-energie", "institutions-democratie", "services-publics", "securite-justice", "economie-finances"
}
PROPOSAL_STATUSES = {"current", "superseded", "amended", "withdrawn", "archived", "unknown"}
TOPIC_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PRIMARY_TIERS = {"tier_1_primary_official", "tier_2_primary_statement"}
MIN_CANDIDATES = 40
MIN_PARTIES = 25
MIN_DOCUMENTS = 20
MIN_PROPOSALS = 25
MAX_CANONICAL_SNAPSHOT_AGE_DAYS = 120
MAX_WATCH_HEALTH_AGE_HOURS = 36
OLD_ELECTION_RE = re.compile(
    r"(?:europeennes|européennes)[^0-9]{0,8}2024|(?:legislatives|législatives)[^0-9]{0,8}2024|"
    r"(?:presidentielle|présidentielle)[^0-9]{0,8}2022",
    re.I,
)


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


def flexible_day(value) -> date | None:
    raw = str(value or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None
    if re.fullmatch(r"\d{4}", raw):
        return date(int(raw), 1, 1)
    return None


def parse_instant(value: str, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise AssertionError(f"Invalid ISO datetime for {label}: {value}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_watch_health() -> None:
    path = ROOT / "research" / "veille" / "health.json"
    if not path.exists():
        return
    with path.open(encoding="utf-8") as handle:
        health = json.load(handle)
    checked = parse_instant(health.get("last_collection_success_at"), "watch health last_collection_success_at")
    age_hours = (datetime.now(timezone.utc) - checked).total_seconds() / 3600
    if age_hours > MAX_WATCH_HEALTH_AGE_HOURS:
        raise AssertionError(f"Political watch is stale: {age_hours:.1f}h old (max {MAX_WATCH_HEALTH_AGE_HOURS}h)")
    if health.get("status") == "stale":
        raise AssertionError("Political watch health explicitly reports stale")


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
    if age > MAX_CANONICAL_SNAPSHOT_AGE_DAYS:
        raise AssertionError(
            f"Canonical political snapshot is abnormally old: {age} days (max {MAX_CANONICAL_SNAPSHOT_AGE_DAYS}); "
            "watch freshness is validated independently."
        )
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
        if status_day > date.today():
            raise AssertionError(f"status_as_of is in the future for {cid}")
        if candidate.get("declared_at"):
            parse_iso_day(candidate["declared_at"], f"{cid}.declared_at")
        tier = candidate.get("source_tier")
        if tier not in SOURCE_TIERS:
            raise AssertionError(f"Invalid source_tier for {cid}: {tier}")
        assert_url(candidate.get("source_url"), f"candidate {cid}")
        if confidence == "high" and tier not in PRIMARY_TIERS:
            raise AssertionError(f"High-confidence candidate status must use primary/direct evidence: {cid} ({tier})")
        history = candidate.get("status_history") or []
        previous_days = [flexible_day(row.get("status_as_of")) for row in history if isinstance(row, dict)]
        previous_days = [day for day in previous_days if day]
        if previous_days and max(previous_days) > status_day:
            raise AssertionError(f"Candidate status history is newer than current status for {cid}")

    for party in parties:
        pid = party.get("id")
        if not pid or not party.get("name"):
            raise AssertionError(f"Invalid party record: {party}")
        assert_url(party.get("official_website"), f"party {pid}", required=False)

    return set(candidate_ids), party_set


def validate_documents(entity_ids: set[str]) -> tuple[set[str], dict[str, dict]]:
    files = list(markdown_files("corpus/2027"))
    if len(files) < MIN_DOCUMENTS:
        raise AssertionError(f"Need at least {MIN_DOCUMENTS} corpus documents, found {len(files)}")
    document_ids: set[str] = set()
    metadata: dict[str, dict] = {}
    for path in files:
        meta, body = parse_markdown(path)
        doc_id = meta.get("document_id")
        if not doc_id or doc_id in document_ids:
            raise AssertionError(f"Missing or duplicate document_id: {path}")
        document_ids.add(doc_id)
        metadata[str(doc_id)] = meta
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
        document_topics = meta.get("topics") or []
        if not isinstance(document_topics, list):
            raise AssertionError(f"Document topics must be a list in {path}")
        for topic in document_topics:
            if not isinstance(topic, str) or not TOPIC_SLUG.fullmatch(topic):
                raise AssertionError(f"Invalid document topic slug in {path}: {topic}")
        if not body.strip() or len(re.sub(r"\s+", " ", body).strip()) < 80:
            raise AssertionError(f"Document body too shallow: {path}")

        if meta.get("generated_by") == "scripts/auto_promote.py":
            context = f"{meta.get('source_url', '')} {meta.get('title', '')}"
            if meta.get("document_status") == "current" and OLD_ELECTION_RE.search(context):
                raise AssertionError(f"Old-election auto document cannot be current 2027 canon: {path}")
            if meta.get("source_complete") is False:
                raise AssertionError(f"Truncated auto source cannot be promoted as canonical: {path}")
    return document_ids, metadata


def proposal_effective_day(meta: dict, documents: dict[str, dict]) -> date | None:
    for field in ("source_published_at", "first_documented_at"):
        parsed = flexible_day(meta.get(field))
        if parsed:
            return parsed
    source_ids = meta.get("source_document_ids") or meta.get("source_document_id")
    if isinstance(source_ids, str):
        source_ids = [source_ids]
    for doc_id in source_ids or []:
        parsed = flexible_day((documents.get(str(doc_id)) or {}).get("published_at"))
        if parsed:
            return parsed
    return None


def validate_proposals(entity_ids: set[str], document_ids: set[str], documents: dict[str, dict]) -> int:
    files = list(markdown_files("proposals"))
    if len(files) < MIN_PROPOSALS:
        raise AssertionError(f"Need at least {MIN_PROPOSALS} atomic proposals, found {len(files)}")
    records: dict[str, tuple[object, dict, str]] = {}
    for path in files:
        meta, body = parse_markdown(path)
        proposal_id = meta.get("proposal_id")
        if not proposal_id or proposal_id in records:
            raise AssertionError(f"Missing or duplicate proposal_id: {path}")
        records[str(proposal_id)] = (path, meta, body)
        if meta.get("entity_id") not in entity_ids:
            raise AssertionError(f"Unknown proposal entity in {path}: {meta.get('entity_id')}")
        if meta.get("topic") not in PROPOSAL_TOPICS:
            raise AssertionError(f"Invalid proposal topic in {path}: {meta.get('topic')}")
        if meta.get("certainty") not in CERTAINTIES:
            raise AssertionError(f"Invalid certainty in {path}: {meta.get('certainty')}")
        status = meta.get("proposal_status", "current")
        if status not in PROPOSAL_STATUSES:
            raise AssertionError(f"Invalid proposal_status in {path}: {status}")
        source_ids = meta.get("source_document_ids") or meta.get("source_document_id")
        if isinstance(source_ids, str):
            source_ids = [source_ids]
        if not source_ids or not set(source_ids).issubset(document_ids):
            raise AssertionError(f"Proposal points to missing source document: {path}: {source_ids}")
        assert_url(meta.get("source_url"), f"proposal {proposal_id}", required=False)
        if not body.strip() or len(re.sub(r"\s+", " ", body).strip()) < 40:
            raise AssertionError(f"Proposal body too shallow: {path}")

    for proposal_id, (path, meta, _) in records.items():
        status = meta.get("proposal_status", "current")
        supersedes = meta.get("supersedes")
        superseded_by = meta.get("superseded_by")
        if status == "superseded" and not superseded_by:
            raise AssertionError(f"Superseded proposal must declare superseded_by: {path}")
        if supersedes:
            if supersedes not in records:
                raise AssertionError(f"Proposal supersedes missing proposal {supersedes}: {path}")
            _, old_meta, _ = records[supersedes]
            if old_meta.get("entity_id") != meta.get("entity_id"):
                raise AssertionError(f"Cross-entity supersession is forbidden: {proposal_id} -> {supersedes}")
            if old_meta.get("topic") != meta.get("topic"):
                raise AssertionError(f"Cross-topic supersession is forbidden: {proposal_id} -> {supersedes}")
            if old_meta.get("superseded_by") != proposal_id:
                raise AssertionError(f"Supersession must be reciprocal: {proposal_id} -> {supersedes}")
            new_day = proposal_effective_day(meta, documents)
            old_day = proposal_effective_day(old_meta, documents)
            if new_day and old_day and new_day < old_day:
                raise AssertionError(f"Older proposal cannot supersede newer proposal: {proposal_id} ({new_day}) < {supersedes} ({old_day})")
        if superseded_by:
            if superseded_by not in records:
                raise AssertionError(f"Proposal superseded_by missing proposal {superseded_by}: {path}")
            _, new_meta, _ = records[superseded_by]
            if new_meta.get("supersedes") != proposal_id:
                raise AssertionError(f"superseded_by must be reciprocal: {proposal_id} -> {superseded_by}")

    for origin in records:
        seen = set()
        cursor = origin
        while cursor:
            if cursor in seen:
                raise AssertionError(f"Proposal supersession cycle detected from {origin}")
            seen.add(cursor)
            cursor = str(records[cursor][1].get("supersedes") or "") if cursor in records else ""
    return len(files)


def main() -> None:
    validate_watch_health()
    data = load_entities()
    candidate_ids, party_ids = validate_entities(data)
    all_entities = candidate_ids | party_ids
    document_ids, documents = validate_documents(all_entities)
    proposal_count = validate_proposals(all_entities, document_ids, documents)
    print(
        f"Production validation OK: canonical snapshot {data['snapshot_date']}, watch health fresh, "
        f"{len(candidate_ids)} personalities, {len(party_ids)} parties, "
        f"{len(document_ids)} documents, {proposal_count} proposals"
    )


if __name__ == "__main__":
    main()
