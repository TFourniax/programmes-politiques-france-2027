#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import yaml

import auto_promote
import auto_promote_runner as runner
from common import ROOT


MAX_STATUS_SOURCES_PER_RUN = 12
DETERMINISTIC_STATUSES = {"party_designated", "declared_presidential"}
ALLOWED_TRANSITIONS = {
    "unknown": DETERMINISTIC_STATUSES,
    "potential": DETERMINISTIC_STATUSES,
    "exploratory": DETERMINISTIC_STATUSES,
    "declared_primary": DETERMINISTIC_STATUSES,
    "declared_conditional": DETERMINISTIC_STATUSES,
    "party_designated": {"declared_presidential"},
}


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalized(value: Any) -> str:
    folded = auto_promote.fold(value)
    return re.sub(r"[^a-z0-9]+", " ", folded).strip()


def contains_presidential_context(value: Any) -> bool:
    text = normalized(value)
    return "presidentielle" in text or ("president" in text and "2027" in text)


def candidate_pool(
    owner_id: str,
    owner_type: str,
    candidates: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if owner_type == "candidate":
        candidate = candidates.get(owner_id)
        return [candidate] if candidate else []
    return [
        candidate
        for candidate in candidates.values()
        if candidate.get("primary_party_id") == owner_id
    ]


def mentioned_candidates(source: dict[str, Any], pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    haystack = normalized(
        " ".join(
            str(value or "")
            for value in (source.get("url"), source.get("title"), source.get("text"))
        )
    )
    matches = []
    for candidate in pool:
        name = normalized(candidate.get("name"))
        if name and re.search(rf"(?:^|\s){re.escape(name)}(?:\s|$)", haystack):
            matches.append(candidate)
    return matches


def detect_status_transition(
    source: dict[str, Any],
    candidate: dict[str, Any],
    owner_type: str,
) -> str | None:
    """Return only transitions that can be established lexically with very high confidence.

    Withdrawals, conditional candidacies and legal statuses deliberately remain in the
    two-pass verifier. This lane exists only for explicit presidential declarations and
    official party designations, so it can run at zero inference cost when Gemini is down.
    """
    combined = normalized(
        " ".join(
            str(value or "")
            for value in (source.get("url"), source.get("title"), source.get("text"))
        )
    )
    if not contains_presidential_context(combined):
        return None

    name = normalized(candidate.get("name"))
    if not name:
        return None

    designation_patterns = (
        rf"{re.escape(name)}.{{0,100}}\b(?:designe|investi|choisi|elu)\b.{{0,45}}\bcandidat\b",
        rf"\bcandidature\b.{{0,35}}\bde\b.{{0,20}}{re.escape(name)}.{{0,100}}\b(?:approuvee|adoptee|validee)\b",
    )
    if owner_type == "party" and any(re.search(pattern, combined) for pattern in designation_patterns):
        return "party_designated"

    declaration_patterns = (
        rf"{re.escape(name)}.{{0,100}}\b(?:est|sera|se declare)\b.{{0,35}}\bcandidat\b.{{0,70}}\bpresident",
        rf"{re.escape(name)}.{{0,100}}\bcandidat\b.{{0,70}}\belection presidentielle\b",
    )
    if any(re.search(pattern, combined) for pattern in declaration_patterns):
        return "declared_presidential"

    if owner_type == "candidate" and re.search(
        r"\bje suis candidat(?:e)?\b.{0,70}\belection presidentielle\b",
        combined,
    ):
        return "declared_presidential"
    return None


def supported_effective_date(event: dict[str, Any], source: dict[str, Any]) -> str | None:
    raw = str(event.get("published_at") or "").strip()
    candidate = raw[:10]
    if not auto_promote.parse_day(candidate):
        return None
    evidence = " ".join(str(value or "") for value in (source.get("title"), source.get("text")))
    if not runner.date_supported_by_source(candidate, evidence):
        return None
    return candidate


def transition_allowed(current_status: Any, new_status: str) -> bool:
    current = str(current_status or "unknown")
    return new_status in ALLOWED_TRANSITIONS.get(current, set())


def evidence_excerpt(source: dict[str, Any], candidate_name: str, new_status: str) -> str | None:
    text = auto_promote.compact(source.get("text"))
    if not text:
        return None
    name = normalized(candidate_name)
    markers = ("designe", "investi", "candidat") if new_status == "party_designated" else ("candidat", "president")
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        folded = normalized(sentence)
        if name in folded and any(marker in folded for marker in markers):
            return sentence[:280]
    return None


def load_lane_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "events": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "events": {}}
    if not isinstance(data, dict):
        return {"version": 1, "events": {}}
    data.setdefault("version", 1)
    data.setdefault("events", {})
    return data


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def eligible_events(state: dict[str, Any]) -> list[dict[str, Any]]:
    events = runner.collapse_latest_events(runner.durable_load_events())
    pending = []
    for event in events:
        if event.get("source_tier") != "tier_1_primary_official":
            continue
        if not runner.is_status_critical_event(event):
            continue
        key = auto_promote.event_key(event)
        previous = (state.get("events") or {}).get(key) or {}
        if previous.get("status") in {"updated", "already_current", "not_applicable", "ambiguous", "date_unverified"}:
            continue
        pending.append(event)
    pending.sort(key=runner.status_aware_priority, reverse=True)
    return pending[:MAX_STATUS_SOURCES_PER_RUN]


def run() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    state_path = ROOT / "research" / "veille" / "status-fast-lane-state.json"
    state = load_lane_state(state_path)
    entities, candidates, parties, registries = auto_promote.entity_context()
    session = requests.Session()
    session.headers.update({"User-Agent": auto_promote.USER_AGENT, "Accept": "text/html,*/*;q=0.8"})

    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    changed = False

    for event in eligible_events(state):
        key = auto_promote.event_key(event)
        try:
            resolved = auto_promote.resolve_owner(str(event.get("owner") or ""), candidates, parties)
            if not resolved:
                result = {"status": "not_applicable", "reason": "owner_not_resolved"}
            else:
                owner_id, owner_type = resolved
                source = auto_promote.fetch_source(session, str(event["url"]), 400000)
                pool = candidate_pool(owner_id, owner_type, candidates)
                matches = mentioned_candidates(source, pool)
                if len(matches) != 1:
                    result = {
                        "status": "ambiguous",
                        "reason": "candidate_match_not_unique",
                        "candidate_matches": [candidate.get("id") for candidate in matches],
                    }
                else:
                    candidate = matches[0]
                    new_status = detect_status_transition(source, candidate, owner_type)
                    if not new_status or new_status not in DETERMINISTIC_STATUSES:
                        result = {"status": "not_applicable", "reason": "no_deterministic_transition"}
                    elif candidate.get("current_status") == new_status:
                        result = {
                            "status": "already_current",
                            "candidate_id": candidate["id"],
                            "new_status": new_status,
                        }
                    elif not transition_allowed(candidate.get("current_status"), new_status):
                        result = {
                            "status": "not_applicable",
                            "reason": "transition_not_monotonic",
                            "candidate_id": candidate["id"],
                            "current_status": candidate.get("current_status"),
                            "new_status": new_status,
                        }
                    else:
                        effective_date = supported_effective_date(event, source)
                        if not effective_date:
                            result = {
                                "status": "date_unverified",
                                "reason": "event_date_not_explicit_in_source",
                                "candidate_id": candidate["id"],
                                "new_status": new_status,
                            }
                        else:
                            status_item = {
                                "candidate_id": candidate["id"],
                                "new_status": new_status,
                                "effective_date": effective_date,
                            }
                            applied = auto_promote.apply_status(
                                status_item,
                                source,
                                entities,
                                candidates,
                                registries["candidates"],
                            )
                            if not applied:
                                result = {
                                    "status": "not_applicable",
                                    "reason": "apply_status_guard_rejected",
                                    "candidate_id": candidate["id"],
                                    "new_status": new_status,
                                }
                            else:
                                changed = True
                                result = {
                                    "status": "updated",
                                    "candidate_id": candidate["id"],
                                    "new_status": new_status,
                                    "effective_date": effective_date,
                                    "source_url": source["url"],
                                    "source_sha256": source["sha256"],
                                    "evidence_excerpt": evidence_excerpt(source, candidate["name"], new_status),
                                    "verification_method": "tier1_primary_deterministic_status_phrase_plus_explicit_source_date",
                                }
            result = {
                **result,
                "event_url": event.get("url"),
                "owner": event.get("owner"),
                "processed_at": iso_now(),
            }
            results.append(result)
            state["events"][key] = result
        except Exception as exc:
            error = {
                "event_url": event.get("url"),
                "owner": event.get("owner"),
                "error": f"{type(exc).__name__}: {exc}",
                "processed_at": iso_now(),
            }
            errors.append(error)
            state["events"][key] = {"status": "technical_error", **error}

    if changed:
        auto_promote.save_json(ROOT / "data" / "entities.json", entities)
        (ROOT / "registries" / "candidates.yaml").write_text(
            yaml.safe_dump(registries["candidates"], allow_unicode=True, sort_keys=False, width=120),
            encoding="utf-8",
        )

    state["last_run_at"] = iso_now()
    state["last_updated_count"] = sum(item.get("status") == "updated" for item in results)
    state["last_error_count"] = len(errors)
    save_json(state_path, state)

    report_dir = ROOT / "research" / "veille" / "status-fast-lane"
    report_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": iso_now(),
        "processed": len(results),
        "updated": sum(item.get("status") == "updated" for item in results),
        "errors": errors,
        "results": results,
    }
    save_json(report_dir / f"{datetime.now(timezone.utc).date().isoformat()}.json", payload)
    return results, errors


def main() -> None:
    results, errors = run()
    updated = sum(item.get("status") == "updated" for item in results)
    print(f"Deterministic Tier-1 status lane: {len(results)} processed, {updated} updated, {len(errors)} errors")


if __name__ == "__main__":
    main()
