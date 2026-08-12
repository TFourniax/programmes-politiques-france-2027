#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests

from common import ROOT, load_yaml
from daily_watch import (
    USER_AGENT,
    canonicalize_url,
    fetch,
    is_relevant_official_url,
    iso_now,
    load_state,
    parse_feed,
    save_json,
    utc_now,
)


def normalize_item_url(url: str, public_origin: str | None = None) -> str:
    canonical = canonicalize_url(url)
    if not public_origin:
        return canonical
    try:
        item = urlsplit(canonical)
        origin = urlsplit(public_origin)
    except ValueError:
        return canonical
    if item.netloc.lower() == origin.netloc.lower() and origin.scheme in {"http", "https"}:
        return canonicalize_url(urlunsplit((origin.scheme, item.netloc, item.path, item.query, "")))
    return canonical


def configured_feeds(config: dict[str, Any]) -> list[dict[str, str]]:
    out = []
    for item in config.get("official_direct_feeds", []) or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        owner = str(item.get("owner") or "").strip()
        if not url or not owner:
            continue
        out.append({
            "id": str(item.get("id") or owner),
            "url": canonicalize_url(url),
            "owner": owner,
            "public_origin": str(item.get("public_origin") or "").strip(),
            "source_tier": str(item.get("source_tier") or "tier_1_primary_official"),
        })
    return out


def collect(
    session: requests.Session,
    state: dict[str, Any],
    feeds: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    events: list[dict[str, Any]] = []
    warnings: list[str] = []
    health = state.setdefault("direct_feed_health", {})
    feed_state = state.setdefault("direct_feeds", {})
    seen = state.setdefault("official_seen_urls", {})

    for feed in feeds:
        url = feed["url"]
        previous = feed_state.get(url)
        initial_sync = not isinstance(previous, dict) or not previous.get("initialized_at")
        try:
            result = fetch(session, url)
        except requests.RequestException as exc:
            health[url] = {
                "owner": feed["owner"],
                "status": 0,
                "checked_at": iso_now(),
                "error": str(exc),
            }
            warnings.append(f"{feed['owner']} direct feed {url}: {exc}")
            continue

        status = int(result["status"])
        content_type = str(result["content_type"] or "").lower()
        if status >= 400:
            health[url] = {
                "owner": feed["owner"],
                "status": status,
                "checked_at": iso_now(),
                "resolved_url": result["url"],
                "error": f"HTTP {status}",
            }
            warnings.append(f"{feed['owner']} direct feed {url}: HTTP {status}")
            continue

        items = parse_feed(result["raw"])
        if not items and not any(kind in content_type for kind in ("rss", "atom", "xml")):
            health[url] = {
                "owner": feed["owner"],
                "status": status,
                "checked_at": iso_now(),
                "resolved_url": result["url"],
                "error": f"unexpected content type {result['content_type']}",
            }
            warnings.append(
                f"{feed['owner']} direct feed {url}: unexpected content type {result['content_type']}"
            )
            continue

        health[url] = {
            "owner": feed["owner"],
            "status": status,
            "checked_at": iso_now(),
            "resolved_url": result["url"],
            "item_count": len(items),
        }

        for item in items:
            item_url = normalize_item_url(str(item.get("url") or ""), feed.get("public_origin"))
            title = str(item.get("title") or "").strip()
            if not item_url or not is_relevant_official_url(item_url, title):
                continue
            existing = seen.get(item_url)
            if existing:
                existing["last_seen_at"] = iso_now()
                if item.get("published_at"):
                    existing["published_at"] = item.get("published_at")
                continue

            seen[item_url] = {
                "first_seen_at": iso_now(),
                "last_seen_at": iso_now(),
                "owner": feed["owner"],
                "published_at": item.get("published_at"),
                "title": title,
                "provenance": "official_direct_feed",
                "feed_url": url,
            }
            if not initial_sync and state.get("last_run_at"):
                events.append({
                    "event_type": "official_new_feed_item",
                    "observed_at": iso_now(),
                    "url": item_url,
                    "owner": feed["owner"],
                    "title": title,
                    "published_at": item.get("published_at"),
                    "source_tier": feed["source_tier"],
                    "verification_state": "needs_review",
                    "priority": "high",
                    "provenance": "official_direct_feed_discovery_only",
                })

        feed_state[url] = {
            "initialized_at": (previous or {}).get("initialized_at") or iso_now(),
            "last_success_at": iso_now(),
            "owner": feed["owner"],
            "resolved_url": result["url"],
            "item_count": len(items),
        }

    return events, warnings


def append_outputs(events: list[dict[str, Any]], warnings: list[str]) -> None:
    day = utc_now().date().isoformat()
    base = ROOT / "research" / "veille"
    jsonl = base / f"{day}.jsonl"
    report = base / f"{day}.md"
    base.mkdir(parents=True, exist_ok=True)

    if events:
        existing_lines = set(jsonl.read_text(encoding="utf-8").splitlines()) if jsonl.exists() else set()
        with jsonl.open("a", encoding="utf-8") as handle:
            for event in events:
                line = json.dumps(event, ensure_ascii=False, sort_keys=True)
                if line not in existing_lines:
                    handle.write(line + "\n")
                    existing_lines.add(line)

    if events or warnings:
        lines = ["", "## Flux officiels directs", ""]
        if events:
            for item in events:
                lines.append(f"- **{item['owner']}** — [{item['title']}]({item['url']})")
                lines.append("  - découverte officielle uniquement · contenu complet requis avant promotion canonique")
        else:
            lines.append("Aucun nouvel élément pertinent détecté sur les flux officiels directs.")
        if warnings:
            lines.extend(["", "### Avertissements"])
            lines.extend(f"- {warning}" for warning in warnings)
        with report.open("a", encoding="utf-8") as handle:
            handle.write("\n".join(lines).rstrip() + "\n")


def main() -> None:
    config = load_yaml("registries/watch.yaml")
    feeds = configured_feeds(config)
    if not feeds:
        print("No direct official feed configured")
        return

    state_path = ROOT / "research" / "veille" / "state.json"
    state = load_state(state_path)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.7"})

    events, warnings = collect(session, state, feeds)
    state["last_direct_feed_run_at"] = iso_now()
    state["last_direct_feed_event_count"] = len(events)
    save_json(state_path, state)
    append_outputs(events, warnings)

    print(
        f"Direct official feeds: {len(feeds)} feed(s), {len(events)} new event(s), "
        f"{len(warnings)} warning(s)"
    )


if __name__ == "__main__":
    main()
