#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import requests
import yaml

import auto_promote
import auto_promote_runner as runner
from common import ROOT, load_yaml, parse_markdown

SNAPSHOT = "2026-08-13"

CANDIDATES = [
    {
        "id": "juan-branco",
        "name": "Juan Branco",
        "current_status": "declared_presidential",
        "status_as_of": SNAPSHOT,
        "status_confidence": "high",
        "official_candidate": False,
        "primary_party_id": None,
        "declared_at": None,
        "source_url": "https://ruches.org/",
        "source_tier": "tier_1_primary_official",
        "status_note": "Le site Branco 2027 des Ruches présente explicitement Juan Branco comme candidat à la présidentielle 2027 et relie directement sa candidature au projet La Voie."
    },
    {
        "id": "manolo-mlekuz",
        "name": "Manolo Mlekuz",
        "current_status": "declared_presidential",
        "status_as_of": SNAPSHOT,
        "status_confidence": "high",
        "official_candidate": False,
        "primary_party_id": None,
        "declared_at": None,
        "source_url": "https://trajectoire2027.fr/qui-sommes-nous.html",
        "source_tier": "tier_1_primary_official",
        "status_note": "Trajectoire présente explicitement Manolo Mlekuz comme candidat à l'élection présidentielle et publie son programme de transition constitutionnelle."
    }
]

SOURCES = [
    {"id": "src-juan-branco-2027", "url": "https://ruches.org/", "tier": "tier_1_primary_official", "owner": "Juan Branco"},
    {"id": "src-juan-branco-projet", "url": "https://ruches.org/le-projet", "tier": "tier_1_primary_official", "owner": "Juan Branco"},
    {"id": "src-manolo-mlekuz-2027", "url": "https://trajectoire2027.fr/qui-sommes-nous.html", "tier": "tier_1_primary_official", "owner": "Manolo Mlekuz"},
    {"id": "src-manolo-mlekuz-programme", "url": "https://trajectoire2027.fr/programme.html", "tier": "tier_1_primary_official", "owner": "Manolo Mlekuz"},
]

PROGRAMMES = [
    {
        "owner": "Juan Branco",
        "url": "https://ruches.org/le-projet",
        "title": "La Voie — programme Branco 2027",
        "minimum_created_proposals": 350,
    },
    {
        "owner": "Manolo Mlekuz",
        "url": "https://trajectoire2027.fr/programme.html",
        "title": "Programme Trajectoire 2027",
        "minimum_created_proposals": 4,
    },
]


def ensure_entities() -> None:
    path = ROOT / "data" / "entities.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    existing = {row.get("id") for row in data.get("candidates", [])}
    for row in CANDIDATES:
        if row["id"] not in existing:
            data.setdefault("candidates", []).append(copy.deepcopy(row))
    data["snapshot_date"] = SNAPSHOT
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    registry_path = ROOT / "registries" / "candidates.yaml"
    registry = yaml.safe_load(registry_path.read_text(encoding="utf-8")) or {}
    existing = {row.get("id") for row in registry.get("candidates", [])}
    for row in CANDIDATES:
        if row["id"] not in existing:
            registry.setdefault("candidates", []).append(copy.deepcopy(row))
    registry["snapshot_date"] = SNAPSHOT
    registry_path.write_text(yaml.safe_dump(registry, allow_unicode=True, sort_keys=False, width=120), encoding="utf-8")

    sources_path = ROOT / "registries" / "sources.yaml"
    sources = yaml.safe_load(sources_path.read_text(encoding="utf-8")) or {}
    existing = {row.get("id") for row in sources.get("sources", [])}
    for row in SOURCES:
        if row["id"] not in existing:
            sources.setdefault("sources", []).append(copy.deepcopy(row))
    sources["snapshot_date"] = SNAPSHOT
    sources_path.write_text(yaml.safe_dump(sources, allow_unicode=True, sort_keys=False, width=140), encoding="utf-8")


def current_actor_proposals(actor_id: str) -> int:
    total = 0
    for path in (ROOT / "proposals").rglob("*.md"):
        try:
            meta, _ = parse_markdown(path)
        except Exception:
            continue
        if meta.get("entity_id") == actor_id and str(meta.get("proposal_status") or "current") == "current":
            total += 1
    return total


def dense_config() -> dict:
    config = copy.deepcopy(load_yaml("registries/watch.yaml").get("auto_promotion") or {})
    config.update({
        "enabled": True,
        "model": config.get("model") or "gemini-3.5-flash-lite",
        "max_source_chars": 4_000_000,
        "chunk_chars": 4000,
        "chunk_overlap_chars": 180,
        "max_chunks_per_source_per_run": 999,
        "max_claims_per_chunk": 40,
        "request_delay_seconds": 0.20,
    })
    return config


def install_strict_runtime() -> None:
    auto_promote.gemini = runner.strict_gemini
    auto_promote.fetch_source = runner.safe_fetch_source
    auto_promote.sanitize = runner.strict_sanitize


def promote_programmes(api_key: str) -> list[dict]:
    entities, candidates, parties, registries = auto_promote.entity_context()
    state = auto_promote.load_state()
    session = requests.Session()
    session.headers.update({"User-Agent": auto_promote.USER_AGENT})
    config = dense_config()
    results = []

    for item in PROGRAMMES:
        actor = next(row for row in CANDIDATES if row["name"] == item["owner"])
        before = current_actor_proposals(actor["id"])
        event = {
            "event_type": "official_new_url",
            "observed_at": f"{SNAPSHOT}T10:00:00+00:00",
            "owner": item["owner"],
            "priority": "high",
            "published_at": None,
            "source_tier": "tier_1_primary_official",
            "title": item["title"],
            "url": item["url"],
            "verification_state": "needs_review",
            "provenance": "structured_missing_candidate_backfill",
        }
        result = auto_promote.promote(
            event, session, api_key, config, state, entities, candidates, parties, registries
        )
        after = current_actor_proposals(actor["id"])
        created = after - before
        results.append({**result, "actor_id": actor["id"], "created_current_proposals": created})
        minimum = int(item["minimum_created_proposals"])
        if result.get("status") != "promoted":
            raise RuntimeError(f"{actor['id']} dense programme did not promote: {result}")
        if created < minimum:
            raise RuntimeError(
                f"{actor['id']} dense programme under-extracted: created {created}, expected at least {minimum}"
            )

    auto_promote.save_json(ROOT / "research" / "veille" / "promotion-state.json", state)
    auto_promote.save_json(ROOT / "data" / "entities.json", entities)
    with (ROOT / "registries" / "candidates.yaml").open("w", encoding="utf-8") as handle:
        yaml.safe_dump(registries["candidates"], handle, allow_unicode=True, sort_keys=False, width=120)
    return results


def main() -> int:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("GEMINI_API_KEY is required")
    ensure_entities()
    install_strict_runtime()
    results = promote_programmes(api_key)
    report = {
        "generated_at": f"{SNAPSHOT}T12:00:00+00:00",
        "verification_scope": "statement_attribution_not_feasibility",
        "sources": SOURCES,
        "results": results,
        "counts": {row["id"]: current_actor_proposals(row["id"]) for row in CANDIDATES},
    }
    out = ROOT / "research" / "veille" / "backfill" / "2026-08-13-structured-missing-candidates.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
