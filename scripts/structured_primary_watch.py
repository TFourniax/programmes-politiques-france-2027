#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

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


def same_host(a: str, b: str) -> bool:
    left = urlsplit(a).netloc.lower().removeprefix("www.")
    right = urlsplit(b).netloc.lower().removeprefix("www.")
    return bool(left and right and left == right)


def request_json(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    attempts: int = 2,
) -> requests.Response:
    errors: list[str] = []
    profiles = [
        {},
        {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
        },
    ]
    for attempt in range(max(1, attempts)):
        for headers in profiles:
            try:
                response = session.get(
                    url,
                    params=params,
                    headers=headers or None,
                    timeout=30,
                    allow_redirects=True,
                )
            except requests.RequestException as exc:
                errors.append(f"{type(exc).__name__}: {exc}")
                continue
            if response.status_code == 200:
                if not same_host(url, response.url):
                    raise ValueError(f"structured REST redirect outside official host: {response.url}")
                if "json" not in (response.headers.get("content-type") or "").lower():
                    raise ValueError(
                        f"structured REST returned non-JSON content: {response.headers.get('content-type')}"
                    )
                return response
            errors.append(f"HTTP {response.status_code} {response.url}")
        if attempt + 1 < max(1, attempts):
            time.sleep(1.2 * (attempt + 1))
    raise requests.HTTPError("; ".join(errors[-6:]) or f"structured REST unavailable: {url}")


def _link_allowed(link: str, source: dict[str, Any]) -> bool:
    pattern = str(source.get("link_pattern") or "").strip()
    if pattern and not re.search(pattern, link, flags=re.I):
        return False
    return not any(
        str(fragment).lower() in link.lower()
        for fragment in source.get("exclude_link_fragments", []) or []
    )


def discover_wordpress_candidates(
    session: requests.Session,
    api_base: str,
    source: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """Discover current chapters through lightweight public WordPress searches.

    The official site's WAF rejects the literal `Chapitre` query and bulk content
    requests from some GitHub runners, while ordinary public searches such as
    `programme`, `avenir en commun` and `livre` are accessible. Search responses are
    discovery-only; every selected chapter is fetched in full from its individual
    official REST endpoint before hashing or canonical promotion.
    """
    terms = [str(item).strip() for item in source.get("search_terms", []) if str(item).strip()]
    if not terms:
        terms = ["programme", "avenir en commun", "livre"]
    endpoint = f"{api_base}/wp-json/wp/v2/search"
    found_by_id: dict[int, dict[str, Any]] = {}
    successful_terms: list[str] = []
    warnings: list[str] = []

    for term in terms:
        try:
            response = request_json(
                session,
                endpoint,
                params={"search": term, "per_page": 100},
                attempts=2,
            )
            payload = response.json()
            if not isinstance(payload, list):
                raise ValueError("WordPress search response is not a list")
            successful_terms.append(term)
        except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError) as exc:
            warnings.append(f"search={term}: {type(exc).__name__}: {exc}")
            continue

        for item in payload:
            try:
                item_id = int(item.get("id"))
            except (TypeError, ValueError):
                continue
            public_url = canonicalize_url(str(item.get("url") or ""))
            title = html.unescape(str(item.get("title") or "")).strip()
            subtype = str(item.get("subtype") or "")
            if subtype != "post":
                continue
            if not re.match(r"^Chapitre\s+\d+\s*:", title, flags=re.I):
                continue
            if not public_url or not _link_allowed(public_url, source):
                continue
            found_by_id[item_id] = {
                "id": item_id,
                "url": public_url,
                "title": title,
                "subtype": subtype,
            }

    if not successful_terms:
        raise ValueError("all lightweight WordPress discovery searches failed: " + " | ".join(warnings[:6]))
    if not found_by_id:
        raise ValueError(
            "WordPress discovery searches returned no current programme chapter candidates; "
            + " | ".join(warnings[:6])
        )
    return list(found_by_id.values()), successful_terms, warnings


def fetch_wordpress_rows(
    session: requests.Session,
    api_base: str,
    source: dict[str, Any],
) -> tuple[list[dict[str, Any]], str, int, str]:
    candidates, successful_terms, discovery_warnings = discover_wordpress_candidates(
        session, api_base, source
    )
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    delay = max(0.0, float(source.get("detail_request_delay_seconds", 0.15)))

    for index, item in enumerate(sorted(candidates, key=lambda row: row["id"])):
        detail_url = f"{api_base}/wp-json/wp/v2/posts/{item['id']}"
        try:
            # No query parameters here: this individual endpoint is the public full
            # representation already proven reachable from GitHub runners.
            detail = request_json(session, detail_url, attempts=2)
            payload = detail.json()
            if not isinstance(payload, dict):
                raise ValueError("WordPress detail response is not an object")
            rows.append(payload)
        except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError) as exc:
            errors.append(f"{item['id']} {item['url']}: {type(exc).__name__}: {exc}")
        if delay and index + 1 < len(candidates):
            time.sleep(delay)

    if errors:
        raise ValueError(
            f"incomplete WordPress detail retrieval ({len(errors)}/{len(candidates)} failed): "
            + " | ".join(errors[:5])
        )
    endpoint = (
        f"{api_base}/wp-json/wp/v2/search"
        f" [terms={','.join(successful_terms)}; candidates={len(candidates)};"
        f" discovery_warnings={len(discovery_warnings)}] -> individual /posts/{{id}}"
    )
    return rows, endpoint, len(successful_terms), "public_search_then_individual_full_rest"


def wordpress_chapters(
    session: requests.Session,
    source: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    api_base = str(source["api_base"]).rstrip("/")
    minimum_expected = int(
        source.get("minimum_expected_chapters", source.get("expected_chapters", 18))
    )
    min_chars = int(source.get("min_content_chars", 500))
    rows, endpoint, searches, transport = fetch_wordpress_rows(session, api_base, source)

    by_number: dict[int, dict[str, Any]] = {}
    rejected = 0
    out_of_scope = 0
    for row in rows:
        title = html.unescape(
            str((row.get("title") or {}).get("rendered") or "")
        ).strip()
        match = re.match(r"^Chapitre\s+(\d+)\s*:\s*(.+)", title, flags=re.I)
        if not match:
            continue
        number = int(match.group(1))
        link = canonicalize_url(str(row.get("link") or ""))
        if number < 1 or not link or not _link_allowed(link, source):
            out_of_scope += 1
            continue
        text = visible_text(str((row.get("content") or {}).get("rendered") or ""))
        if len(text) < min_chars or str(row.get("status") or "publish") not in {"publish", ""}:
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
        if previous is None or (current["modified"], current["id"]) > (
            previous["modified"], previous["id"]
        ):
            by_number[number] = current

    chapters = [by_number[number] for number in sorted(by_number)]
    numbers = [item["number"] for item in chapters]
    highest = max(numbers, default=0)
    contiguous = bool(numbers) and numbers == list(range(1, highest + 1))
    complete = highest >= minimum_expected and contiguous and len(chapters) == highest
    expected_items = highest if complete else max(highest, minimum_expected)
    health = {
        "id": str(source["id"]),
        "owner": str(source["owner"]),
        "kind": "wordpress_programme_chapters",
        "status": 200 if complete else 206,
        "checked_at": iso_now(),
        "api_endpoint": endpoint,
        "transport": transport,
        "minimum_expected_items": minimum_expected,
        "expected_items": expected_items,
        "item_count": len(chapters),
        "full_content_items": sum(
            1 for item in chapters if item["text_chars"] >= min_chars
        ),
        "rejected_items": rejected,
        "out_of_scope_items": out_of_scope,
        "coverage_urls": [
            canonicalize_url(str(url)) for url in source.get("coverage_urls", [])
        ],
        "chapter_numbers": numbers,
        "highest_chapter_number": highest,
        "contiguous": contiguous,
        "discovery_searches_succeeded": searches,
        "minimum_content_chars": min(
            [item["text_chars"] for item in chapters], default=0
        ),
        "maximum_content_chars": max(
            [item["text_chars"] for item in chapters], default=0
        ),
        "complete": complete,
    }
    return chapters, health


def collect_source(
    session: requests.Session,
    source: dict[str, Any],
    previous: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if source.get("kind") != "wordpress_programme_chapters":
        raise ValueError(
            f"unsupported structured primary kind: {source.get('kind')}"
        )
    chapters, health = wordpress_chapters(session, source)
    events: list[dict[str, Any]] = []
    previous_items = (previous or {}).get("items") or {}
    current_items: dict[str, Any] = {}

    for item in chapters:
        key = str(item["number"])
        old = previous_items.get(key) or {}
        current_items[key] = item
        changed = bool(old and old.get("sha256") != item["sha256"])
        if not old or changed:
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
    existing: set[tuple[str, str, str]] = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            existing.add(
                (
                    str(item.get("event_type") or ""),
                    str(item.get("url") or ""),
                    str(item.get("sha256") or ""),
                )
            )
    with path.open("a", encoding="utf-8") as handle:
        for event in events:
            key = (
                str(event.get("event_type") or ""),
                str(event.get("url") or ""),
                str(event.get("sha256") or ""),
            )
            if key in existing:
                continue
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
            existing.add(key)
    return path


def write_report(
    events: list[dict[str, Any]],
    health_rows: list[dict[str, Any]],
    warnings: list[str],
) -> None:
    day = datetime.now(timezone.utc).date().isoformat()
    out = ROOT / "research" / "veille" / "structured"
    out.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Sources primaires structurées — {day}",
        "",
        f"Généré automatiquement à `{iso_now()}`.",
        "",
        "> Les recherches WordPress servent uniquement à découvrir les objets officiels.",
        "> Chaque chapitre est ensuite téléchargé intégralement depuis son endpoint REST",
        "> individuel avant calcul de hash et avant toute promotion canonique.",
        "",
    ]
    for row in health_rows:
        lines.extend([
            f"## {row.get('owner')} · {row.get('id')}",
            "",
            f"- transport : {row.get('transport')} ;",
            f"- recherches de découverte réussies : {row.get('discovery_searches_succeeded')} ;",
            f"- chapitres : {row.get('item_count')} (minimum connu : {row.get('minimum_expected_items')}) ;",
            f"- séquence continue : {'oui' if row.get('contiguous') else 'non'} ;",
            f"- objets à contenu complet : {row.get('full_content_items')} ;",
            f"- état : {'complet' if row.get('complete') else 'incomplet'} ;",
            f"- nouveaux/changés : {row.get('event_count', 0)}.",
            "",
        ])
    if warnings:
        lines.extend(["## Avertissements", ""])
        lines.extend(f"- {item}" for item in warnings)
        lines.append("")
    (out / f"{day}.md").write_text(
        "\n".join(lines).rstrip() + "\n", encoding="utf-8"
    )
    save_json(
        out / f"{day}.json",
        {
            "generated_at": iso_now(),
            "events": events,
            "health": health_rows,
            "warnings": warnings,
        },
    )


def main() -> None:
    config = load_yaml("registries/watch.yaml")
    sources = list(config.get("official_structured_sources") or [])
    state = load_state()
    previous = state.get("structured_primary_health") or {}
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/html;q=0.8",
        "Accept-Language": "fr,en;q=0.7",
    })

    all_events: list[dict[str, Any]] = []
    health_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    current: dict[str, Any] = dict(previous)
    for source in sources:
        source_id = str(source.get("id") or "")
        if not source_id:
            continue
        try:
            events, health = collect_source(
                session, source, previous.get(source_id) or {}
            )
            all_events.extend(events)
            health_rows.append(health)
            current[source_id] = health
        except (
            requests.RequestException,
            ValueError,
            KeyError,
            TypeError,
            json.JSONDecodeError,
        ) as exc:
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
                "coverage_urls": [
                    canonicalize_url(str(url))
                    for url in source.get("coverage_urls", [])
                ],
            }

    state["structured_primary_health"] = current
    state["last_structured_primary_run_at"] = iso_now()
    state["last_structured_primary_event_count"] = len(all_events)
    save_json(ROOT / "research" / "veille" / "state.json", state)
    append_events(all_events)
    write_report(all_events, health_rows, warnings)

    print(
        f"Structured primary watch: {len(sources)} source(s), "
        f"{len(all_events)} event(s), {len(warnings)} warning(s)"
    )
    for row in health_rows:
        print(
            f"  {row['id']}: {row['item_count']} chapter(s), "
            f"baseline={row['minimum_expected_items']}, complete={row['complete']}, "
            f"transport={row['transport']}"
        )
    for warning in warnings:
        print(f"  WARNING {warning}")


if __name__ == "__main__":
    main()
