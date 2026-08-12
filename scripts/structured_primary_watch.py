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
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

from common import ROOT, load_yaml
from daily_watch import USER_AGENT, canonicalize_url, iso_now, save_json

MAX_BYTES = 2_000_000


class PageParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "canvas", "template", "form"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts: list[str] = []
        self.hrefs: list[str] = []
        self.h1_depth = 0
        self.current_h1: list[str] = []
        self.h1s: list[str] = []

    def handle_starttag(self, tag, attrs):
        lowered = tag.lower()
        if lowered in self.SKIP:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if lowered == "a":
            data = {str(k).lower(): str(v or "") for k, v in attrs}
            if data.get("href"):
                self.hrefs.append(data["href"])
        if lowered == "h1":
            self.h1_depth += 1
            self.current_h1 = []

    def handle_endtag(self, tag):
        lowered = tag.lower()
        if lowered in self.SKIP and self.skip_depth:
            self.skip_depth -= 1
            return
        if self.skip_depth:
            return
        if lowered == "h1" and self.h1_depth:
            title = compact(" ".join(self.current_h1))
            if title:
                self.h1s.append(title)
            self.current_h1 = []
            self.h1_depth = 0

    def handle_data(self, data):
        if self.skip_depth:
            return
        self.parts.append(data)
        if self.h1_depth:
            self.current_h1.append(data)


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def page_data(raw: bytes) -> dict[str, Any]:
    parser = PageParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    return {
        "text": compact(" ".join(parser.parts)),
        "hrefs": parser.hrefs,
        "h1s": parser.h1s,
    }


def same_host(a: str, b: str) -> bool:
    left = (urlsplit(a).hostname or "").lower().removeprefix("www.")
    right = (urlsplit(b).hostname or "").lower().removeprefix("www.")
    return bool(left and right and left == right)


def fetch_html(url: str, *, attempts: int = 2, max_bytes: int = MAX_BYTES) -> dict[str, Any]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr,en;q=0.7",
    }
    errors: list[str] = []
    for attempt in range(max(1, attempts)):
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=25) as response:
                raw = response.read(max_bytes + 1)
                status = int(response.status)
                resolved = response.geturl()
                ctype = response.headers.get("content-type", "")
        except HTTPError as exc:
            status = int(exc.code)
            resolved = exc.geturl()
            ctype = exc.headers.get("content-type", "") if exc.headers else ""
            raw = exc.read(min(max_bytes, 5000))
        except (URLError, TimeoutError, OSError) as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt + 1 < max(1, attempts):
                time.sleep(1.0 + attempt)
                continue
            raise ValueError(f"official HTML unavailable for {url}: {'; '.join(errors[-3:])}") from exc

        if status == 200:
            if not same_host(url, resolved):
                raise ValueError(f"official HTML redirected outside source host: {resolved}")
            if "html" not in ctype.lower():
                raise ValueError(f"official HTML returned unsupported content type: {ctype}")
            if len(raw) > max_bytes:
                raise ValueError(f"official HTML exceeds safe byte limit: {url}")
            return {
                "status": status,
                "url": canonicalize_url(resolved),
                "content_type": ctype,
                "raw": raw,
            }
        if status == 404:
            return {"status": 404, "url": canonicalize_url(resolved), "content_type": ctype, "raw": raw}
        errors.append(f"HTTP {status} {resolved}")
        if attempt + 1 < max(1, attempts):
            time.sleep(1.0 + attempt)
            continue
        raise ValueError(f"official HTML unavailable for {url}: {'; '.join(errors[-3:])}")
    raise ValueError(f"official HTML unavailable for {url}")


def content_h1(page: dict[str, Any], pattern: str | None = None) -> str | None:
    h1s = [compact(item) for item in page.get("h1s") or [] if compact(item)]
    if pattern:
        matching = [item for item in h1s if re.search(pattern, item, flags=re.I)]
        if matching:
            return matching[-1]
    return h1s[-1] if h1s else None


def extract_section_text(page: dict[str, Any], title: str) -> str:
    text = compact(page.get("text"))
    if not text or not title:
        return ""
    # The theme repeats the section title in its local navigation before the real H1.
    # Taking the last occurrence before the post-content navigation isolates the actual
    # policy text while discarding site-wide menus and old-programme navigation links.
    end_candidates = [
        index for marker in ("Lire la suite", "Le menu", "Les réseaux")
        if (index := text.find(marker)) >= 0
    ]
    provisional_end = min(end_candidates) if end_candidates else len(text)
    start = text.rfind(title, 0, provisional_end)
    if start < 0:
        start = text.find(title)
    if start < 0:
        return ""
    end_candidates = [
        index for marker in ("Lire la suite", "Le menu", "Les réseaux")
        if (index := text.find(marker, start + len(title))) >= 0
    ]
    end = min(end_candidates) if end_candidates else len(text)
    return compact(text[start:end])


def chapter_section_urls(page: dict[str, Any], chapter_url: str, number: int) -> list[str]:
    pattern = re.compile(rf"/programme2025/livre/chapitre{number}/s(\d+)/?$", flags=re.I)
    found: dict[int, str] = {}
    for href in page.get("hrefs") or []:
        absolute = canonicalize_url(urljoin(chapter_url, str(href)))
        if not same_host(chapter_url, absolute):
            continue
        match = pattern.search(urlsplit(absolute).path)
        if match:
            found[int(match.group(1))] = absolute
    return [found[index] for index in sorted(found)]


def snapshot_path(source_id: str, number: int) -> Path:
    return ROOT / "research" / "veille" / "structured" / "snapshots" / source_id / f"chapter-{number:02d}.txt"


def write_snapshot(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = text.rstrip() + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == payload:
        return
    path.write_text(payload, encoding="utf-8")


def capture_chapter(source: dict[str, Any], number: int) -> dict[str, Any] | None:
    base = str(source["public_base"]).rstrip("/")
    chapter_url = canonicalize_url(f"{base}/chapitre{number}/")
    result = fetch_html(chapter_url)
    if result["status"] == 404:
        return None
    page = page_data(result["raw"])
    title = content_h1(page, rf"^Chapitre\s+{number}\s*:")
    if not title:
        raise ValueError(f"chapter {number} returned HTML but no matching chapter H1")
    section_urls = chapter_section_urls(page, chapter_url, number)
    if not section_urls:
        raise ValueError(f"chapter {number} exposes no programme section URL")

    min_section_chars = int(source.get("min_section_chars", 180))
    delay = max(0.0, float(source.get("request_delay_seconds", 0.05)))
    sections: list[dict[str, Any]] = []
    for index, section_url in enumerate(section_urls):
        section_result = fetch_html(section_url)
        if section_result["status"] != 200:
            raise ValueError(f"chapter {number} section unavailable: {section_url}")
        section_page = page_data(section_result["raw"])
        section_title = content_h1(section_page)
        section_text = extract_section_text(section_page, section_title or "")
        if not section_title or len(section_text) < min_section_chars:
            raise ValueError(
                f"chapter {number} section content too short ({len(section_text)} chars): {section_url}"
            )
        sections.append({
            "url": section_url,
            "title": section_title,
            "text": section_text,
            "text_chars": len(section_text),
        })
        if delay and index + 1 < len(section_urls):
            time.sleep(delay)

    snapshot_parts = [title]
    for section in sections:
        snapshot_parts.extend(["", section["title"], section["text"]])
    full_text = "\n".join(snapshot_parts).strip()
    min_chapter_chars = int(source.get("min_content_chars", 500))
    if len(full_text) < min_chapter_chars:
        raise ValueError(f"chapter {number} full primary snapshot too short: {len(full_text)}")
    path = snapshot_path(str(source["id"]), number)
    write_snapshot(path, full_text)
    return {
        "number": number,
        "title": title,
        "link": chapter_url,
        "fetch_url": chapter_url,
        "snapshot_path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "date": None,
        "captured_at": iso_now(),
        "text_chars": len(full_text),
        "section_count": len(sections),
        "section_urls": section_urls,
        "minimum_section_chars": min(section["text_chars"] for section in sections),
        "sha256": hashlib.sha256(full_text.encode("utf-8")).hexdigest(),
        "transport": "official_html_chapter_sections",
    }


def collect_html_chapters(source: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    baseline = int(source.get("minimum_expected_chapters", 18))
    max_probe = max(baseline, int(source.get("max_probe_chapters", baseline + 8)))
    extra_404_stop = max(1, int(source.get("stop_after_consecutive_missing", 3)))
    chapters: list[dict[str, Any]] = []
    missing_after_baseline = 0
    future_probe_status: list[dict[str, Any]] = []

    for number in range(1, max_probe + 1):
        try:
            chapter = capture_chapter(source, number)
        except ValueError:
            # Every baseline chapter is mandatory. Above the known baseline, a non-404
            # transport/content failure is also material because it could hide a new chapter.
            raise
        if chapter is None:
            if number <= baseline:
                raise ValueError(f"mandatory programme chapter {number} returned 404")
            future_probe_status.append({"number": number, "status": 404})
            missing_after_baseline += 1
            if missing_after_baseline >= extra_404_stop:
                break
            continue
        chapters.append(chapter)
        future_probe_status.append({"number": number, "status": 200})
        if number > baseline:
            missing_after_baseline = 0

    numbers = [item["number"] for item in chapters]
    highest = max(numbers, default=0)
    contiguous = bool(numbers) and numbers == list(range(1, highest + 1))
    complete = highest >= baseline and contiguous and len(chapters) == highest
    expected = highest if complete else max(highest, baseline)
    health = {
        "id": str(source["id"]),
        "owner": str(source["owner"]),
        "kind": "official_html_programme_chapters",
        "status": 200 if complete else 206,
        "checked_at": iso_now(),
        "api_endpoint": f"{str(source['public_base']).rstrip('/')}/chapitre{{n}}/ + section pages",
        "transport": "official_html_chapter_sections",
        "minimum_expected_items": baseline,
        "expected_items": expected,
        "item_count": len(chapters),
        "full_content_items": sum(1 for item in chapters if item.get("snapshot_path") and item.get("text_chars", 0) >= int(source.get("min_content_chars", 500))),
        "coverage_urls": [canonicalize_url(str(url)) for url in source.get("coverage_urls", [])],
        "chapter_numbers": numbers,
        "highest_chapter_number": highest,
        "contiguous": contiguous,
        "minimum_content_chars": min([item["text_chars"] for item in chapters], default=0),
        "maximum_content_chars": max([item["text_chars"] for item in chapters], default=0),
        "total_sections": sum(int(item.get("section_count") or 0) for item in chapters),
        "future_probe_status": future_probe_status,
        "complete": complete,
    }
    return chapters, health


def load_state() -> dict[str, Any]:
    path = ROOT / "research" / "veille" / "state.json"
    if not path.exists():
        return {"version": 1}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"version": 1}
    return data if isinstance(data, dict) else {"version": 1}


def collect_source(source: dict[str, Any], previous: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if source.get("kind") != "html_programme_chapters":
        raise ValueError(f"unsupported structured primary kind: {source.get('kind')}")
    chapters, health = collect_html_chapters(source)
    previous_items = (previous or {}).get("items") or {}
    events: list[dict[str, Any]] = []
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
                "published_at": None,
                "source_tier": "tier_1_primary_official",
                "title": item["title"],
                "url": item["link"],
                "fetch_url": item["fetch_url"],
                "snapshot_path": item["snapshot_path"],
                "sha256": item["sha256"],
                "verification_state": "needs_review",
                "provenance": "official_html_full_primary_sections",
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
            existing.add((str(item.get("event_type") or ""), str(item.get("url") or ""), str(item.get("sha256") or "")))
    with path.open("a", encoding="utf-8") as handle:
        for event in events:
            key = (str(event.get("event_type") or ""), str(event.get("url") or ""), str(event.get("sha256") or ""))
            if key in existing:
                continue
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
            existing.add(key)
    return path


def write_report(events: list[dict[str, Any]], health_rows: list[dict[str, Any]], warnings: list[str]) -> None:
    day = datetime.now(timezone.utc).date().isoformat()
    out = ROOT / "research" / "veille" / "structured"
    out.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Sources primaires structurées — {day}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        "> Chaque chapitre est vérifié depuis sa page officielle, puis toutes ses sections",
        "> sont téléchargées directement depuis melenchon2027.fr. Les snapshots locaux ne",
        "> sont qu'une capture traçable de ce contenu primaire et servent à la promotion canonique.", "",
    ]
    for row in health_rows:
        lines.extend([
            f"## {row.get('owner')} · {row.get('id')}", "",
            f"- transport : {row.get('transport')} ;",
            f"- chapitres complets : {row.get('item_count')} (minimum connu : {row.get('minimum_expected_items')}) ;",
            f"- sections primaires capturées : {row.get('total_sections')} ;",
            f"- séquence continue : {'oui' if row.get('contiguous') else 'non'} ;",
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
    current: dict[str, Any] = dict(previous)
    events: list[dict[str, Any]] = []
    health_rows: list[dict[str, Any]] = []
    warnings: list[str] = []

    for source in sources:
        source_id = str(source.get("id") or "")
        if not source_id:
            continue
        try:
            source_events, health = collect_source(source, previous.get(source_id) or {})
            events.extend(source_events)
            health_rows.append(health)
            current[source_id] = health
        except (ValueError, KeyError, TypeError, OSError) as exc:
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
    state["last_structured_primary_event_count"] = len(events)
    save_json(ROOT / "research" / "veille" / "state.json", state)
    append_events(events)
    write_report(events, health_rows, warnings)

    print(f"Structured primary watch: {len(sources)} source(s), {len(events)} event(s), {len(warnings)} warning(s)")
    for row in health_rows:
        print(
            f"  {row['id']}: {row['item_count']} chapter(s), {row['total_sections']} section(s), "
            f"baseline={row['minimum_expected_items']}, complete={row['complete']}, transport={row['transport']}"
        )
    for warning in warnings:
        print(f"  WARNING {warning}")


if __name__ == "__main__":
    main()
