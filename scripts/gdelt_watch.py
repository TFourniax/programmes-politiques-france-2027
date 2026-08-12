#!/usr/bin/env python3
from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import requests

from common import ROOT, load_yaml
from daily_watch import (
    USER_AGENT,
    ascii_fold,
    canonicalize_url,
    collect_candidate_entities,
    iso_now,
    save_json,
    trusted_press,
    utc_now,
)


def load_state() -> dict[str, Any]:
    path = ROOT / "research" / "veille" / "state.json"
    if not path.exists():
        return {"version": 1}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("Invalid watch state root")
    data.setdefault("discovery_seen_urls", {})
    return data


def chunks(items: list[Any], size: int) -> list[list[Any]]:
    size = max(1, size)
    return [items[i:i + size] for i in range(0, len(items), size)]


def gdelt_query(entities: list[dict[str, str]]) -> str:
    names = " OR ".join(f'"{entity["name"]}"' for entity in entities)
    return f"({names}) AND (présidentielle OR programme OR proposition OR candidature OR 2027)"


def entity_matches(title: str, entity: dict[str, str], unique_last_names: set[str]) -> bool:
    folded = ascii_fold(title)
    full = ascii_fold(entity["name"])
    if full in folded:
        return True
    parts = full.split()
    last = parts[-1] if parts else ""
    return len(last) >= 5 and last in unique_last_names and last in folded


def match_entities(title: str, entities: list[dict[str, str]]) -> list[dict[str, str]]:
    last_counts: dict[str, int] = defaultdict(int)
    for entity in entities:
        parts = ascii_fold(entity["name"]).split()
        if parts:
            last_counts[parts[-1]] += 1
    unique_last_names = {name for name, count in last_counts.items() if count == 1}
    return [entity for entity in entities if entity_matches(title, entity, unique_last_names)]


def request_batch(
    session: requests.Session,
    batch: list[dict[str, str]],
    settings: dict[str, Any],
) -> tuple[list[dict[str, Any]], str | None]:
    params = {
        "query": gdelt_query(batch),
        "mode": "artlist",
        "maxrecords": int(settings.get("max_records_per_batch", 75)),
        "timespan": str(settings.get("timespan", "1d")),
        "sort": "datedesc",
        "format": "json",
    }
    retries = int(settings.get("max_retries", 3))
    backoff = float(settings.get("retry_backoff_seconds", 4))
    timeout = max(5.0, min(35.0, float(settings.get("request_timeout_seconds", 15))))

    for attempt in range(retries + 1):
        try:
            response = session.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params=params,
                timeout=timeout,
            )
            if response.status_code == 429 and attempt < retries:
                time.sleep(backoff * (attempt + 1))
                continue
            response.raise_for_status()
            payload = response.json()
            return list(payload.get("articles", [])), None
        except (requests.RequestException, ValueError) as exc:
            if attempt < retries:
                time.sleep(backoff * (attempt + 1))
                continue
            return [], str(exc)
    return [], "unknown GDELT error"


def seen_discovery(state: dict[str, Any], url: str) -> bool:
    canonical = canonicalize_url(url)
    existing = state["discovery_seen_urls"].get(canonical)
    if existing:
        existing["last_seen_at"] = iso_now()
        return True
    state["discovery_seen_urls"][canonical] = {
        "first_seen_at": iso_now(),
        "last_seen_at": iso_now(),
        "source": "gdelt_batched",
    }
    return False


def collect(
    session: requests.Session,
    state: dict[str, Any],
    config: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str], int]:
    settings = config.get("gdelt", {})
    if not settings.get("enabled", True):
        return [], [], 0

    entities = collect_candidate_entities()[:int(settings.get("max_entities", 60))]
    batch_size = int(settings.get("batch_size", 6))
    keep_per_entity = int(settings.get("keep_per_entity", 3))
    delay = float(settings.get("request_delay_seconds", 1.5))
    events: list[dict[str, Any]] = []
    warnings: list[str] = []
    kept_by_entity: dict[str, int] = defaultdict(int)
    requests_made = 0

    batches = chunks(entities, batch_size)
    for batch_index, batch in enumerate(batches, start=1):
        articles, error = request_batch(session, batch, settings)
        requests_made += 1
        if error:
            warnings.append(
                f"GDELT batch {batch_index} ({', '.join(e['name'] for e in batch)}): {error}"
            )
            continue

        for article in articles:
            url = article.get("url")
            title = str(article.get("title") or "").strip()
            if not url or not title:
                continue
            canonical = canonicalize_url(str(url))
            domain = str(article.get("domain") or urlsplit(canonical).netloc)
            if not trusted_press(domain, config):
                continue

            matched = match_entities(title, batch)
            if not matched:
                continue
            if seen_discovery(state, canonical):
                continue

            for entity in matched:
                if kept_by_entity[entity["id"]] >= keep_per_entity:
                    continue
                events.append({
                    "event_type": "press_discovery",
                    "observed_at": iso_now(),
                    "url": canonical,
                    "title": title,
                    "entity_id": entity["id"],
                    "entity_name": entity["name"],
                    "published_at": article.get("seendate"),
                    "domain": domain,
                    "language": article.get("language"),
                    "source_tier": "tier_3_reliable_secondary",
                    "verification_state": "discovery_only",
                    "priority": "normal",
                    "discovered_via": "gdelt_batched",
                })
                kept_by_entity[entity["id"]] += 1
        if delay and batch_index < len(batches):
            time.sleep(delay)

    return events, warnings, requests_made


def write_outputs(events: list[dict[str, Any]], warnings: list[str], requests_made: int) -> None:
    out_dir = ROOT / "research" / "veille" / "press"
    out_dir.mkdir(parents=True, exist_ok=True)
    day = utc_now().date().isoformat()

    jsonl_path = out_dir / f"{day}.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for item in sorted(events, key=lambda e: (e["entity_name"], e["url"])):
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    lines = [
        f"# Radar presse GDELT — {day}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        "> GDELT sert uniquement à découvrir des sources secondaires. Une reprise presse ne devient",
        "> jamais une information canonique sans validation de provenance.", "",
        "## Résumé", "",
        f"- {requests_made} requête(s) GDELT batchée(s) ;",
        f"- {len(events)} nouvelle(s) piste(s) de presse fiable retenue(s) ;",
        f"- {len(warnings)} avertissement(s) technique(s).", "",
    ]
    if events:
        lines.extend(["## Pistes", ""])
        for item in events:
            lines.append(
                f"- **{item['entity_name']}** — [{item['title']}]({item['url']})"
            )
            lines.append(
                f"  - {item.get('domain')} · `tier_3_reliable_secondary` · `discovery_only`"
            )
        lines.append("")
    else:
        lines.extend(["Aucune nouvelle piste de presse retenue.", ""])

    if warnings:
        lines.extend(["## Avertissements", ""])
        lines.extend(f"- {warning}" for warning in warnings)
        lines.append("")

    (out_dir / f"{day}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    config = load_yaml("registries/watch.yaml")
    state = load_state()
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.7"})

    events, warnings, requests_made = collect(session, state, config)
    state["last_gdelt_run_at"] = iso_now()
    state["last_gdelt_event_count"] = len(events)
    state["last_gdelt_request_count"] = requests_made
    save_json(ROOT / "research" / "veille" / "state.json", state)
    write_outputs(events, warnings, requests_made)

    print(f"GDELT: {requests_made} batched request(s), {len(events)} event(s), {len(warnings)} warning(s)")


if __name__ == "__main__":
    main()
