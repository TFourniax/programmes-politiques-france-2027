#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

import auto_promote
import auto_promote_runner as runner
from canonical_evidence import ensure_support_document, merge_provenance, proposal_records, resolve_target
from common import ROOT, parse_markdown
from monitored_source_backlog import load_monitored_source_backlog


def public_topics() -> set[str]:
    """Load the same public topic taxonomy used by the UI and canonical validator."""
    path = ROOT / "data" / "compass.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    topics = {
        str(row.get("id") or "").strip()
        for row in data.get("questions") or []
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }
    required = {"defense-international", "numerique-ia"}
    if not topics or not required.issubset(topics):
        raise RuntimeError(f"Incomplete public topic taxonomy for canonical promotion: {sorted(topics)}")
    return topics


# auto_promote historically carried its own static list. Override it at import time so
# official-web and social promotion cannot drift from the validator/public compass.
auto_promote.TOPICS = public_topics()

ORIGINAL_STRICT_GEMINI = runner.strict_gemini
ORIGINAL_SAFE_FETCH = runner.safe_fetch_source
ORIGINAL_DURABLE_LOAD_EVENTS = runner.durable_load_events
ORIGINAL_PROMOTE = auto_promote.promote

TRACE: dict[str, Any] = {
    "current_url": None,
    "sources": {},
    "confirmed": {},
}


def extraction_url(prompt: str) -> str | None:
    match = re.search(r"(?:^|\n)URL:\s*(.+?)\s*;\s*propriétaire:", prompt)
    return match.group(1).strip() if match else None


def verification_items(prompt: str) -> list[dict[str, Any]]:
    match = re.search(r"Éléments:\s*(\[.*?\])\s*\n<<<CURRENT_CANONICAL>>>", prompt, flags=re.S)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def traced_gemini(api_key: str, prompt: str, model: str) -> dict[str, Any]:
    is_verification = "second vérificateur indépendant" in prompt
    model_prompt = prompt
    if is_verification:
        model_prompt += (
            "\nRègle de traçabilité supplémentaire : pour relation=DUPLICATE, related_proposal_id est obligatoire "
            "et doit désigner le claim canonique exact dans CURRENT_CANONICAL. Si tu ne peux pas l'identifier, "
            "utilise relation=AMBIGUOUS plutôt que DUPLICATE."
        )
    result = ORIGINAL_STRICT_GEMINI(api_key, model_prompt, model)

    if not is_verification:
        url = extraction_url(prompt)
        if url:
            TRACE["current_url"] = url
        return result

    url = str(TRACE.get("current_url") or "")
    items = verification_items(prompt)
    if not url or not items:
        return result
    bucket = TRACE["confirmed"].setdefault(url, [])
    for verdict in result.get("verdicts") or []:
        try:
            index = int(verdict.get("index"))
        except (TypeError, ValueError):
            continue
        if verdict.get("verdict") != "CONFIRMED" or index < 0 or index >= len(items):
            continue
        item = items[index]
        if item.get("kind") != "claim":
            continue
        claim = {key: value for key, value in item.items() if key != "kind"}
        bucket.append({"claim": claim, "verdict": dict(verdict)})
    return result


def traced_fetch_source(session, url: str, max_chars: int):
    source = ORIGINAL_SAFE_FETCH(session, url, max_chars)
    TRACE["sources"][str(url)] = source
    TRACE["sources"][str(source.get("url") or url)] = source
    return source


def _event_identity(event: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(event.get("event_type") or ""),
        str(event.get("url") or ""),
        str(event.get("sha256") or event.get("published_at") or event.get("observed_at") or ""),
    )


def canonical_durable_load_events() -> list[dict[str, Any]]:
    """Extend the existing durable sitemap/structured backlog with monitored sources.

    The daily watch report can be rewritten later the same day. `state.json` retains the
    latest validated content hash for every directly monitored official source, so any
    current version not yet present in promotion state remains eligible for verification.
    """
    events = ORIGINAL_DURABLE_LOAD_EVENTS()
    existing = {_event_identity(event) for event in events}
    for event in load_monitored_source_backlog(ROOT):
        if not runner.current_cycle_event(event):
            continue
        key = _event_identity(event)
        if key in existing:
            continue
        events.append(event)
        existing.add(key)
    return events


def _record_key(row: dict[str, Any]) -> tuple[str, str, str, str, str]:
    claim = row.get("claim") or {}
    verdict = row.get("verdict") or {}
    return (
        str(claim.get("actor_id") or ""),
        str(claim.get("topic") or ""),
        auto_promote.fold(claim.get("statement")),
        str(verdict.get("relation") or ""),
        str(verdict.get("related_proposal_id") or ""),
    )


def _persist_confirmations(state: dict[str, Any], source: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    version_key = auto_promote.digest(source["url"] + "|" + source["sha256"], 24)
    progress = state.setdefault("source_chunks", {}).setdefault(version_key, {
        "url": source["url"], "sha256": source["sha256"], "total": 0, "done": [],
        "claims": [], "statuses": [], "published_candidates": [], "document_types": [],
        "source_title": source.get("title"), "created_at": auto_promote.now(),
        "text_truncated": source.get("text_truncated", False),
    })
    existing = list(progress.get("canonical_confirmations") or [])
    seen = {_record_key(row) for row in existing}
    for row in rows:
        key = _record_key(row)
        if key not in seen:
            existing.append(row)
            seen.add(key)
    progress["canonical_confirmations"] = existing
    progress["updated_at"] = auto_promote.now()
    return progress


def _document_from_result(result: dict[str, Any]) -> tuple[str | None, str | None]:
    relative = result.get("document")
    if not relative:
        return None, None
    path = ROOT / str(relative)
    if not path.exists():
        return None, None
    try:
        meta, _ = parse_markdown(path)
    except Exception:
        return None, None
    return str(meta.get("document_id") or "") or None, str(relative)


def reconcile_confirmations(
    event: dict[str, Any],
    result: dict[str, Any],
    state: dict[str, Any],
    candidates: dict[str, Any],
    parties: dict[str, Any],
) -> dict[str, Any]:
    result_url = str(result.get("url") or event.get("url") or "")
    source = TRACE["sources"].get(result_url) or TRACE["sources"].get(str(event.get("url") or ""))
    if not source:
        return result

    rows = list(TRACE["confirmed"].pop(result_url, []))
    if result_url != str(event.get("url") or ""):
        rows += TRACE["confirmed"].pop(str(event.get("url") or ""), [])
    progress = _persist_confirmations(state, source, rows)
    if result.get("status") == "partial":
        return result
    if result.get("status") in {"historical_skipped", "deferred"}:
        return result

    confirmations = list(progress.get("canonical_confirmations") or [])
    if not confirmations:
        return result

    records = proposal_records()
    resolved: list[tuple[str, dict[str, Any]]] = []
    for row in confirmations:
        claim = row.get("claim") or {}
        verdict = row.get("verdict") or {}
        target = resolve_target(claim, verdict, state, records)
        if target:
            resolved.append((target, claim))
    if not resolved:
        return result

    owner = auto_promote.resolve_owner(str(event.get("owner") or ""), candidates, parties)
    if not owner:
        return result
    owner_id, owner_type = owner
    owner_name = (parties if owner_type == "party" else candidates)[owner_id]["name"]
    published_at, date_basis = auto_promote.resolve_publication_date(list(progress.get("published_candidates") or []), event)
    document_type = Counter(progress.get("document_types") or ["campaign_website_page"]).most_common(1)[0][0]

    document_id, document_path = _document_from_result(result)
    source_doc_changed = False
    if not document_id:
        document_id, document_path, source_doc_changed = ensure_support_document(
            source=source,
            owner_id=owner_id,
            owner_type=owner_type,
            owner_name=owner_name,
            published_at=published_at,
            date_basis=date_basis,
            document_type=document_type,
            claims=[claim for _, claim in resolved],
        )
    else:
        _, document_path, source_doc_changed = ensure_support_document(
            source=source,
            owner_id=owner_id,
            owner_type=owner_type,
            owner_name=owner_name,
            published_at=published_at,
            date_basis=date_basis,
            document_type=document_type,
            claims=[claim for _, claim in resolved],
        )

    updated: list[str] = []
    for target, claim in resolved:
        if merge_provenance(
            target,
            claim,
            document_id,
            source["url"],
            source["sha256"],
            published_at,
        ):
            updated.append(target)

    if not updated and not source_doc_changed:
        return result

    progress["final_status"] = "promoted"
    progress["completed_at"] = auto_promote.now()
    enriched = dict(result)
    enriched["status"] = "promoted"
    enriched["document"] = document_path
    enriched["provenance_updates"] = sorted(set(updated))
    enriched["verified_at"] = auto_promote.now()
    if result.get("status") != "promoted":
        enriched["reason"] = "canonical_duplicate_evidence"
    return enriched


def canonical_promote(event, session, api_key, config, state, entities, candidates, parties, registries):
    TRACE["current_url"] = str(event.get("url") or "")
    result = ORIGINAL_PROMOTE(event, session, api_key, config, state, entities, candidates, parties, registries)
    return reconcile_confirmations(event, result, state, candidates, parties)


def install() -> None:
    # Re-read in case tests or a long-running worker changed the compass after import.
    auto_promote.TOPICS = public_topics()
    runner.strict_gemini = traced_gemini
    runner.safe_fetch_source = traced_fetch_source
    runner.durable_load_events = canonical_durable_load_events
    auto_promote.promote = canonical_promote


def main() -> None:
    install()
    runner.main()


if __name__ == "__main__":
    main()
