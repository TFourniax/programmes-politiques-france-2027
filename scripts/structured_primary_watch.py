#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

from common import ROOT, load_yaml
from daily_watch import USER_AGENT, canonicalize_url, iso_now, save_json


class VisibleText(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "canvas", "template", "form"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.SKIP:
            self.depth += 1

    def handle_endtag(self, tag):
        if tag.lower() in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            self.parts.append(data)


def visible_text(rendered: str) -> str:
    parser = VisibleText()
    parser.feed(html.unescape(rendered or ""))
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def parse_iso_day(value: Any) -> str | None:
    raw = str(value or "").strip()[:10]
    try:
        datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return None
    return raw


def load_state() -> dict[str, Any]:
    path = ROOT / "research" / "veille" / "state.json"
    if not path.exists():
        return {"version": 1}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"version": 1}
    return data if isinstance(data, dict) else {"version": 1}


def fetch_wordpress_rows(session: requests.Session, api_base: str, source: dict[str, Any]) -> tuple[list[dict[str, Any]], str, int]:
    params = {
        "search": str(source.get("search") or "Chapitre"),
        "per_page": 100,
        "orderby": "modified",
        "order": "desc",
        "after": str(source.get("after") or "2026-01-01T00:00:00"),
        "_fields": "id,date,modified,slug,link,title,content,status",
    }
    base_endpoint = f"{api_base}/wp-json/wp/v2/posts"
    rows: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    max_pages = int(source.get("max_pages", 10))
    while page <= total_pages and page <= max_pages:
        endpoint = f"{base_endpoint}?" + urlencode({**params, "page": page})
        response = session.get(endpoint, timeout=30)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            raise ValueError("WordPress posts response is not a list")
        rows.extend(payload)
        if page == 1:
            try:
                total_pages = max(1, int(response.headers.get("X-WP-TotalPages") or 1))
            except (TypeError, ValueError):
                total_pages = 1
            if total_pages > max_pages:
                raise ValueError(f"WordPress result pagination exceeds configured max_pages ({total_pages}>{max_pages})")
        page += 1
    return rows, f"{base_endpoint}?{urlencode(params)}", total_pages


def wordpress_chapters(session: requests.Session, source: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    api_base = str(source["api_base"]).rstrip("/")
    minimum_expected = int(source.get("minimum_expected_chapters", source.get("expected_chapters", 18)))
    min_chars = int(source.get("min_content_chars", 500))
    rows, endpoint, pages = fetch_wordpress_rows(session, api_base, source)

    by_number: dict[int, dict[str, Any]] = {}
    rejected = 0
    for row in rows:
        title = html.unescape(str((row.get("title") or {}).get("rendered") or "")).strip()
        match = re.match(r"^Chapitre\s+(\d+)\s*:\s*(.+)", title, flags=re.I)
        if not match:
            continue
        number = int(match.group(1))
        if number < 1:
            continue
        rendered = str((row.get("content") or {}).get("rendered") or "")
        text = visible_text(rendered)
        link = canonicalize_url(str(row.get("link") or ""))
        if not link or len(text) < min_chars or str(row.get("status") or "publish") not in {"publish", ""}:
            rejected += 1
            continue
        current = {
            "number": number,
            "id": int(row["id"]),
            "title": title,
            "link": link,
            "date": parse_iso_day(row.get("date")),
            "modified": str(row.get("modified") or ""),
            "text_chars": len(text),
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "fetch_url": f"{api_base}/wp-json/wp/v2/posts/{int(row['id'])}",
        }
        previous = by_number.get(number)
        if previous is None or (current["modified"], current["id"]) > (previous["modified"], previous["id"]):
            by_number[number] = current

    chapters = [by_number[number] for number in sorted(by_number)]
    numbers = [item["number"] for item in chapters]
    highest = max(numbers, default=0)
    contiguous = numbers == list(range(1, highest + 1)) if numbers else False
    # `minimum_expected_chapters` is a floor, not a ceiling: if the official site adds
    # chapter 19 tomorrow, 1..19 is accepted and ingested automatically. A missing chapter
    # or a drop below the known baseline makes the representation unhealthy instead.
    complete = highest >= minimum_expected and contiguous and len(chapters) == highest
    expected_items = highest if complete else max(highest, minimum_expected)
    health = {
        "id": str(source["id"]),
        "owner": str(source["owner"]),
        "kind": "wordpress_programme_chapters",
        "status": 200 if complete else 206,
        "checked_at": iso_now(),
        "api_endpoint": endpoint,
        "minimum_expected_items": minimum_expected,
        "expected_items": expected_items,
        "item_count": len(chapters),
        "full_content_items": sum(1 for item in chapters if item["text_chars"] >= min_chars),
        "rejected_items": rejected,
        "coverage_urls": [canonicalize_url(str(url)) for url in source.get("coverage_urls", [])],
        "chapter_numbers": numbers,
        "highest_chapter_number": highest,
        "contiguous": contiguous,
        "wordpress_pages_fetched": pages,
        "minimum_content_chars": min([item["text_chars"] for item in chapters], default=0),
        "maximum_content_chars": max([item["text_chars"] for item in chapters], default=0),
        "complete": complete,
    }
    return chapters, health


def collect_source(session: requests.Session, source: dict[str, Any], previous: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if source.get("kind") != "wordpress_programme_chapters":
        raise ValueError(f"unsupported structured primary kind: {source.get('kind')}")
    chapters, health = wordpress_chapters(session, source)
    events: list[dict[str, Any]] = []
    previous_items = (previous or {}).get("items") or {}
    current_items: dict[str, Any] = {}

    for item in chapters:
        key = str(item["number"])
        old = previous_items.get(key) or {}
        current_items[key] = item
        changed = bool(old and old.get("sha256") != item["sha256"])
        is_new = not old
        if is_new or changed:
            events.append({
                "event_type": "official_source_changed" if changed else "official_new_url",
                "observed_at": iso_now(),
                "owner": str(source["owner"]),
                "priority": "high",
                "published_at": item.get("date"),
                "source_tier": "tier_1_primary_official",
                "title": item["title"],
                "url": item["link"],
                "fetch_url": item["fetch_url"],
                "sha256": item["sha256"],
                "verification_state": "needs_review",
                "provenance": "official_wordpress_rest_full_primary_content",
                "structured_source_id": str(source["id"]),
                "structured_item_number": item["number"],
            })

    health["items"] = current_items
    health["event_count"] = len(events)
    return events, health


def append_events(events: list[dict[str, Any]]) -> Path:
    day = datetime.now(timezone.utc).date().isoformat()
    path = ROOT / "research" / "veille" / f"{day}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_keys: set[tuple[str, str, str]] = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            existing_keys.add((str(item.get("event_type") or ""), str(item.get("url") or ""), str(item.get("sha256") or "")))
    with path.open("a", encoding="utf-8") as handle:
        for event in events:
            key = (str(event.get("event_type") or ""), str(event.get("url") or ""), str(event.get("sha256") or ""))
            if key in existing_keys:
                continue
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
            existing_keys.add(key)
    return path


def write_report(events: list[dict[str, Any]], health_rows: list[dict[str, Any]], warnings: list[str]) -> None:
    day = datetime.now(timezone.utc).date().isoformat()
    out = ROOT / "research" / "veille" / "structured"
    out.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Sources primaires structurées — {day}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        "> Ces endpoints sont publiés par les sites officiels eux-mêmes. Ils servent de représentation",
        "> primaire alternative lorsque le rendu HTML public applique un filtrage anti-bot. Une donnée",
        "> n'entre dans le canon qu'après les mêmes garde-fous de citation, attribution et vérification.", "",
    ]
    for row in health_rows:
        lines.extend([
            f"## {row.get('owner')} · {row.get('id')}", "",
            f"- chapitres : {row.get('item_count')} (minimum connu : {row.get('minimum_expected_items')}) ;",
            f"- séquence continue : {'oui' if row.get('contiguous') else 'non'} ;",
            f"- objets à contenu complet : {row.get('full_content_items')} ;",
            f"- état : {'complet' if row.get('complete') else 'incomplet'} ;",
            f"- nouveaux/changés : {row.get('event_count', 0)}.", "",
        ])
    if warnings:
        lines.extend(["## Avertissements", "", *[f"- {item}" for item in warnings], ""])
    (out / f"{day}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    save_json(out / f"{day}.json", {"generated_at": iso_now(), "events": events, "health": health_rows, "warnings": warnings})


def main() -> None:
    config = load_yaml("registries/watch.yaml")
    sources = list(config.get("official_structured_sources") or [])
    state = load_state()
    previous = state.get("structured_primary_health") or {}
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json,text/html;q=0.8", "Accept-Language": "fr,en;q=0.7"})

    all_events: list[dict[str, Any]] = []
    health_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    current: dict[str, Any] = dict(previous)
    for source in sources:
        source_id = str(source.get("id") or "")
        if not source_id:
            continue
        try:
            events, health = collect_source(session, source, previous.get(source_id) or {})
            all_events.extend(events)
            health_rows.append(health)
            current[source_id] = health
        except (requests.RequestException, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            warning = f"{source_id}: {type(exc).__name__}: {exc}"
            warnings.append(warning)
            current[source_id] = {
                **dict(previous.get(source_id) or {}),
                "id": source_id,
                "owner": str(source.get("owner") or ""),
                "kind": str(source.get("kind") or ""),
                "status": 0,
                "checked_at": iso_now(),
                "complete": False,
                "error": warning,
                "coverage_urls": [canonicalize_url(str(url)) for url in source.get("coverage_urls", [])],
            }

    state["structured_primary_health"] = current
    state["last_structured_primary_run_at"] = iso_now()
    state["last_structured_primary_event_count"] = len(all_events)
    save_json(ROOT / "research" / "veille" / "state.json", state)
    append_events(all_events)
    write_report(all_events, health_rows, warnings)
    print(f"Structured primary watch: {len(sources)} source(s), {len(all_events)} event(s), {len(warnings)} warning(s)")
    for row in health_rows:
        print(f"  {row['id']}: {row['item_count']} chapter(s), baseline={row['minimum_expected_items']}, complete={row['complete']}")


if __name__ == "__main__":
    main()
