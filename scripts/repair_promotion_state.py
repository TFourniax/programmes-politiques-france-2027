#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import auto_promote
from common import ROOT, markdown_files, parse_markdown
from update_watch_health import RETRY_ATTEMPT_BUDGET, parse_timestamp

# Errors that another identical request will not fix: the page is gone, refused
# to this client, or carries no usable text. Network errors, 5xx and Gemini
# failures stay retryable until they recover.
PERMANENT_RETRY_ERRORS = (
    "http 401",
    "http 403",
    "http 404",
    "http 410",
    "source text too short",
)
# Longest backoff used by auto_promote.retry_delay. A retry still pending this
# long after it became due, while the runner kept running, is no longer in the
# runner's backlog (newer version of the page, rotated feed) and will never run.
STALE_RETRY_GRACE = timedelta(days=14)


def canonical_proposal_ids() -> set[str]:
    out: set[str] = set()
    for path in markdown_files("proposals"):
        try:
            meta, _ = parse_markdown(path)
        except Exception:
            continue
        proposal_id = meta.get("proposal_id")
        if proposal_id:
            out.add(str(proposal_id))
    return out


def repair_state(state: dict[str, Any], proposal_ids: set[str]) -> tuple[dict[str, Any], dict[str, int]]:
    state = dict(state)
    fingerprints = dict(state.get("claim_fingerprints") or {})
    sources = dict(state.get("sources") or {})

    removed_fingerprints = 0
    for fingerprint, record in list(fingerprints.items()):
        proposal_id = str((record or {}).get("proposal_id") or "")
        source_url = str((record or {}).get("source_url") or "")
        if not proposal_id or proposal_id not in proposal_ids or auto_promote.explicit_old_election(source_url):
            fingerprints.pop(fingerprint, None)
            removed_fingerprints += 1

    historical_sources = 0
    for key, record in list(sources.items()):
        if not isinstance(record, dict):
            continue
        url = str(record.get("url") or "")
        if not auto_promote.explicit_old_election(url):
            continue
        if record.get("status") != "historical_skipped" or record.get("reason") != "explicit_old_election_context":
            updated = dict(record)
            updated["status"] = "historical_skipped"
            updated["reason"] = "explicit_old_election_context"
            sources[key] = updated
            historical_sources += 1

    state["version"] = max(int(state.get("version", 1)), 2)
    state["claim_fingerprints"] = fingerprints
    state["sources"] = sources
    return state, {
        "removed_fingerprints": removed_fingerprints,
        "historical_sources_reclassified": historical_sources,
    }


def permanent_retry_error(record: dict[str, Any]) -> bool:
    error = str(record.get("error") or record.get("reason") or "").lower()
    return any(marker in error for marker in PERMANENT_RETRY_ERRORS)


def retire_dead_retries(
    records: dict[str, Any],
    *,
    last_run_at: Any,
    stamp: str,
    budget: int = RETRY_ATTEMPT_BUDGET,
) -> tuple[dict[str, Any], dict[str, int]]:
    """Close technical retries that can no longer succeed or will never be re-run.

    Rows keep their URL, error and attempt count so the decision stays auditable.
    A newer version of the same page gets a new state key and is processed afresh.
    """
    records = dict(records or {})
    last_run = parse_timestamp(last_run_at)
    exhausted = 0
    stale = 0
    for key, record in list(records.items()):
        if not isinstance(record, dict) or record.get("status") != "technical_error":
            continue
        attempts = int(record.get("attempts") or 0)
        due_at = parse_timestamp(record.get("next_retry_at"))
        if attempts >= budget and permanent_retry_error(record):
            reason = "permanent_error_retry_budget_exhausted"
            exhausted += 1
        elif last_run is not None and due_at is not None and last_run - due_at > STALE_RETRY_GRACE:
            reason = "retry_never_rescheduled"
            stale += 1
        else:
            continue
        updated = dict(record)
        updated["status"] = "retry_abandoned"
        updated["reason"] = reason
        updated["abandoned_at"] = stamp
        updated.pop("next_retry_at", None)
        records[key] = updated
    return records, {"exhausted_permanent_retries": exhausted, "stale_retries": stale}


def retire_state_retries(path: Path, collection: str, stamp: str) -> dict[str, int]:
    if not path.exists():
        return {"exhausted_permanent_retries": 0, "stale_retries": 0}
    state = json.loads(path.read_text(encoding="utf-8"))
    records, stats = retire_dead_retries(
        state.get(collection) or {}, last_run_at=state.get("last_run_at"), stamp=stamp,
    )
    if records != (state.get(collection) or {}):
        state[collection] = records
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return stats


def main() -> None:
    path = ROOT / "research" / "veille" / "promotion-state.json"
    if not path.exists():
        print("Promotion state absent: nothing to repair")
        return
    state = json.loads(path.read_text(encoding="utf-8"))
    repaired, stats = repair_state(state, canonical_proposal_ids())
    if repaired != state:
        path.write_text(json.dumps(repaired, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        "Promotion state repair: "
        f"{stats['removed_fingerprints']} stale fingerprint(s), "
        f"{stats['historical_sources_reclassified']} historical source(s) reclassified"
    )

    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    veille = ROOT / "research" / "veille"
    for label, state_path, collection in (
        ("source", veille / "promotion-state.json", "sources"),
        ("social", veille / "social-promotion-state.json", "events"),
    ):
        retired = retire_state_retries(state_path, collection, stamp)
        print(
            f"Promotion retry repair ({label}): "
            f"{retired['exhausted_permanent_retries']} exhausted permanent error(s), "
            f"{retired['stale_retries']} never-rescheduled retry(ies) closed"
        )


if __name__ == "__main__":
    main()
