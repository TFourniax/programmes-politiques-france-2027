#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import auto_promote
from auto_promote_runner import strict_gemini
from common import ROOT, load_yaml


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def event_key(event: dict[str, Any]) -> str:
    raw = "|".join([
        str(event.get("platform") or ""),
        str(event.get("entity_id") or ""),
        str(event.get("url") or ""),
        str(event.get("published_at") or ""),
        str(event.get("excerpt") or ""),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def load_state() -> dict[str, Any]:
    path = ROOT / "research" / "veille" / "social-promotion-state.json"
    if not path.exists():
        return {"version": 2, "events": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("Invalid social promotion state")
    data["version"] = max(int(data.get("version", 1)), 2)
    data.setdefault("events", {})
    return data


def save_state(state: dict[str, Any]) -> None:
    path = ROOT / "research" / "veille" / "social-promotion-state.json"
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_events() -> list[dict[str, Any]]:
    base = ROOT / "research" / "veille" / "social-verified"
    events = []
    for path in sorted(base.glob("20??-??-??.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (
                item.get("event_type") == "official_social_post"
                and item.get("identity_verification_state") == "verified"
                and item.get("source_tier") == "tier_1_primary_official"
                and item.get("excerpt")
                and item.get("url")
            ):
                events.append(item)
    return events


def source_from_event(event: dict[str, Any], max_chars: int) -> dict[str, Any]:
    text = auto_promote.compact(event.get("excerpt"))[:max_chars]
    if len(text) < 24:
        raise ValueError("social source text too short")
    return {
        "url": str(event["url"]),
        "host": auto_promote.host(str(event["url"])),
        "title": auto_promote.compact(event.get("title")) or f"Publication {event.get('platform')}",
        "kind": "social",
        "text": text,
        "text_truncated": False,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }


def strict_allowed_entities(owner_id: str, owner_type: str, candidates: dict[str, Any], parties: dict[str, Any]):
    store = candidates if owner_type == "candidate" else parties
    item = store.get(owner_id)
    if not item:
        return []
    return [{"id": owner_id, "type": owner_type, "name": item["name"]}]


def promote_event(
    event: dict[str, Any],
    session: requests.Session,
    api_key: str,
    config: dict[str, Any],
    canonical_state: dict[str, Any],
    entities: dict[str, Any],
    candidates: dict[str, Any],
    parties: dict[str, Any],
    registries: dict[str, Any],
):
    source = source_from_event(event, int(config.get("max_source_chars", 4000)))
    adapted = dict(event)
    adapted["owner"] = event.get("entity_name")
    adapted["source_tier"] = "tier_1_primary_official"

    original_fetch = auto_promote.fetch_source
    original_allowed = auto_promote.allowed_entities
    original_gemini = auto_promote.gemini
    try:
        auto_promote.fetch_source = lambda _session, _url, _max_chars: source
        auto_promote.allowed_entities = strict_allowed_entities
        auto_promote.gemini = strict_gemini
        return auto_promote.promote(
            adapted, session, api_key, config, canonical_state,
            entities, candidates, parties, registries,
        )
    finally:
        auto_promote.fetch_source = original_fetch
        auto_promote.allowed_entities = original_allowed
        auto_promote.gemini = original_gemini


def write_report(results: list[dict[str, Any]], errors: list[dict[str, Any]]) -> None:
    base = ROOT / "research" / "veille" / "social-promotion"
    base.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": iso_now(),
        "processed": len(results),
        "promoted": sum(x.get("status") == "promoted" for x in results),
        "partial": sum(x.get("status") == "partial" for x in results),
        "proposals_created": sum(len(x.get("proposals") or []) for x in results),
        "status_updates": sum(len(x.get("status_updates") or []) for x in results),
        "errors": errors,
        "results": results,
    }
    (base / f"{day()}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (base / f"{day()}.md").write_text(
        f"# Promotion sociale automatique — {day()}\n\n"
        f"- {payload['processed']} publication(s) traitée(s)\n"
        f"- {payload['promoted']} publication(s) promue(s)\n"
        f"- {payload['partial']} publication(s) partiellement traitée(s)\n"
        f"- {payload['proposals_created']} proposition(s) créée(s)\n"
        f"- {payload['status_updates']} statut(s) mis à jour\n"
        f"- {len(errors)} erreur(s) technique(s)\n\n"
        "Seules les identités sociales vérifiées et les affirmations confirmées par les deux gates peuvent modifier le canon. Les erreurs techniques restent dans une file de retry durable.\n",
        encoding="utf-8",
    )


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("GEMINI_API_KEY missing: social canonical promotion deferred")
        return
    config = load_yaml("registries/watch.yaml").get("social_auto_promotion") or {}
    if not config.get("enabled", True):
        print("Social auto promotion disabled")
        return

    state = load_state()
    canonical_state = auto_promote.load_state()
    entities, candidates, parties, registries = auto_promote.entity_context()
    pending = []
    for event in load_events():
        key = event_key(event)
        previous = state["events"].get(key) or {}
        if previous.get("status") in auto_promote.TERMINAL_SOURCE_STATES:
            continue
        if not auto_promote.retry_due(previous):
            continue
        pending.append(event)
    pending.sort(key=lambda x: str(x.get("published_at") or x.get("observed_at") or ""), reverse=True)
    pending = pending[: int(config.get("max_posts_per_run", 6))]

    session = requests.Session()
    session.headers.update({"User-Agent": auto_promote.USER_AGENT})
    results, errors = [], []
    for event in pending:
        key = event_key(event)
        try:
            result = promote_event(
                event, session, api_key, config, canonical_state,
                entities, candidates, parties, registries,
            )
            results.append(result)
            state["events"][key] = {
                "url": event["url"], "status": result["status"],
                "processed_at": iso_now(), "source_sha256": result.get("sha256"),
                "chunks_done": result.get("chunks_done"), "chunks_total": result.get("chunks_total"),
            }
        except Exception as exc:
            previous = state["events"].get(key) or {}
            attempts = int(previous.get("attempts", 0)) + 1
            error = {"url": event.get("url"), "error": f"{type(exc).__name__}: {exc}", "at": iso_now()}
            errors.append(error)
            next_retry = datetime.now(timezone.utc) + auto_promote.retry_delay(attempts)
            state["events"][key] = {
                "url": event.get("url"), "status": "technical_error",
                "processed_at": iso_now(), "error": error["error"],
                "attempts": attempts, "next_retry_at": next_retry.replace(microsecond=0).isoformat(),
            }
        time.sleep(float(config.get("request_delay_seconds", 0.5)))

    state["last_run_at"] = iso_now()
    state["last_processed_count"] = len(results)
    state["last_error_count"] = len(errors)
    save_state(state)
    auto_promote.save_json(ROOT / "research" / "veille" / "promotion-state.json", canonical_state)
    write_report(results, errors)
    print(f"Social promotion: {len(results)} processed, {sum(x.get('status') == 'promoted' for x in results)} promoted, {len(errors)} errors")


if __name__ == "__main__":
    main()
