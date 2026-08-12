#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

import requests

from common import ROOT, load_yaml

USER_AGENT = "programmes-politiques-france-2027-watch/1.0 (+https://github.com/TFourniax/programmes-politiques-france-2027)"
POLITICAL_HINTS = (
    "2027", "president", "président", "candidat", "candidature", "programme", "projet",
    "proposition", "mesure", "priorite", "priorité", "idee", "idée", "conviction",
    "election", "élection", "livre", "manifeste", "plateforme", "discours", "communique",
    "communiqué", "actualite", "actualité",
)
SOCIAL_DOMAINS = {
    "x.com", "twitter.com", "youtube.com", "youtu.be", "instagram.com", "facebook.com",
    "bsky.app", "tiktok.com", "linkedin.com",
}
TRACKING_QUERY_KEYS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
}


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            value = re.sub(r"\s+", " ", data).strip()
            if value:
                self.parts.append(value)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().replace(microsecond=0).isoformat()


def ascii_fold(value: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", str(value).lower())
        if unicodedata.category(ch) != "Mn"
    )


def canonicalize_url(url: str) -> str:
    try:
        parts = urlsplit(str(url).strip())
    except ValueError:
        return str(url).strip()
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return str(url).strip()
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        low = key.lower()
        if low.startswith("utm_") or low in TRACKING_QUERY_KEYS:
            continue
        query.append((key, value))
    query.sort()
    path = parts.path or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query, doseq=True), ""))


def domain_matches(host_or_url: str, allowed: str) -> bool:
    host = urlsplit(host_or_url).netloc.lower() if "://" in host_or_url else host_or_url.lower()
    host = host.split(":", 1)[0]
    allowed = allowed.lower().strip().lstrip(".")
    return host == allowed or host.endswith("." + allowed)


def trusted_press(host_or_url: str, config: dict[str, Any]) -> bool:
    allowlist = config.get("gdelt", {}).get("trusted_press_domains", []) or []
    return any(domain_matches(host_or_url, domain) for domain in allowlist)


def normalize_html(raw: bytes, encoding: str = "utf-8") -> str:
    text = raw.decode(encoding or "utf-8", errors="replace")
    parser = TextExtractor()
    try:
        parser.feed(text)
    except Exception:
        return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def hash_payload(raw: bytes, content_type: str, encoding: str) -> tuple[str, str]:
    if "html" in (content_type or "").lower():
        normalized = normalize_html(raw, encoding)
        payload = normalized.encode("utf-8")
        excerpt = normalized[:1200]
    else:
        payload = raw
        excerpt = f"binary:{len(raw)} bytes"
    return hashlib.sha256(payload).hexdigest(), excerpt


def fetch(session: requests.Session, url: str) -> dict[str, Any]:
    response = session.get(url, timeout=35, allow_redirects=True)
    return {
        "status": response.status_code,
        "url": canonicalize_url(response.url),
        "raw": response.content,
        "content_type": response.headers.get("content-type", ""),
        "encoding": response.encoding or "utf-8",
        "etag": response.headers.get("etag"),
        "last_modified": response.headers.get("last-modified"),
        "headers": dict(response.headers),
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "version": 4,
            "sources": {},
            "official_seen_urls": {},
            "discovery_seen_urls": {},
            "social_profiles": {},
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("Invalid watch state root")
    data.setdefault("version", 4)
    data.setdefault("sources", {})
    data.setdefault("official_seen_urls", {})
    data.setdefault("discovery_seen_urls", {})
    data.setdefault("social_profiles", {})
    return data


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_config() -> dict[str, Any]:
    return load_yaml("registries/watch.yaml")


def collect_official_targets() -> list[dict[str, str]]:
    targets: dict[str, dict[str, str]] = {}

    for source in load_yaml("registries/sources.yaml").get("sources", []):
        url = source.get("url")
        tier = str(source.get("tier", ""))
        if not url or tier != "tier_1_primary_official":
            continue
        key = canonicalize_url(str(url))
        targets[key] = {
            "url": key,
            "owner": str(source.get("owner") or source.get("id") or "source officielle"),
            "tier": tier,
            "kind": "registry_source",
        }

    for party in load_yaml("registries/parties.yaml").get("parties", []):
        for field, kind in (("official_url", "party_official"), ("programme_url", "party_programme")):
            url = party.get(field)
            if not url:
                continue
            key = canonicalize_url(str(url))
            targets[key] = {
                "url": key,
                "owner": str(party.get("name") or party.get("id")),
                "tier": "tier_1_primary_official",
                "kind": kind,
            }

    for candidate in load_yaml("registries/candidates.yaml").get("candidates", []):
        url = candidate.get("source_url")
        if not url or candidate.get("source_tier") != "tier_1_primary_official":
            continue
        key = canonicalize_url(str(url))
        targets.setdefault(key, {
            "url": key,
            "owner": str(candidate.get("name") or candidate.get("id")),
            "tier": "tier_1_primary_official",
            "kind": "candidate_official_evidence",
        })

    return sorted(targets.values(), key=lambda item: (item["owner"], item["url"]))


def collect_candidate_entities() -> list[dict[str, str]]:
    out = []
    for candidate in load_yaml("registries/candidates.yaml").get("candidates", []):
        name = candidate.get("name")
        entity_id = candidate.get("id")
        status = candidate.get("current_status")
        if name and entity_id and status not in {"withdrawn", "not_running", "deceased"}:
            out.append({"id": str(entity_id), "name": str(name), "status": str(status)})
    return out


def event(event_type: str, **kwargs: Any) -> dict[str, Any]:
    base = {"event_type": event_type, "observed_at": iso_now()}
    base.update(kwargs)
    return base


def monitor_sources(
    session: requests.Session,
    state: dict[str, Any],
    targets: list[dict[str, str]],
    errors: list[str],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    fetched: dict[str, dict[str, Any]] = {}

    for target in targets:
        url = target["url"]
        previous = state["sources"].get(url)
        try:
            result = fetch(session, url)
        except requests.RequestException as exc:
            errors.append(f"{url}: {exc}")
            events.append(event(
                "source_fetch_error", url=url, owner=target["owner"],
                source_tier=target["tier"], verification_state="needs_review", error=str(exc),
            ))
            continue

        status = int(result["status"])
        if status >= 400:
            # Never hash or diff an error page (Cloudflare/WAF, rate-limit, auth page,
            # server error) as political content. Keep the last valid fingerprint so a
            # later recovery can be compared to the last real source, not to a challenge.
            current = dict(previous or {})
            current.update({
                "status": status,
                "resolved_url": result["url"],
                "content_type": result["content_type"],
                "checked_at": iso_now(),
                "owner": target["owner"],
                "kind": target["kind"],
                "last_fetch_error": f"HTTP {status}",
            })
            state["sources"][url] = current
            errors.append(f"{url}: HTTP {status}")
            events.append(event(
                "source_fetch_error", url=url, owner=target["owner"],
                source_tier=target["tier"], verification_state="needs_review",
                error=f"HTTP {status}",
            ))
            continue

        fetched[url] = result
        sha, excerpt = hash_payload(result["raw"], result["content_type"], result["encoding"])
        current = {
            "sha256": sha,
            "status": status,
            "resolved_url": result["url"],
            "content_type": result["content_type"],
            "etag": result["etag"],
            "last_modified": result["last_modified"],
            "checked_at": iso_now(),
            "owner": target["owner"],
            "kind": target["kind"],
            "excerpt": excerpt,
        }

        if previous and previous.get("sha256") and previous.get("sha256") != sha:
            events.append(event(
                "official_source_changed",
                url=result["url"], owner=target["owner"],
                source_tier="tier_1_primary_official", verification_state="needs_review",
                priority="high", previous_sha256=previous.get("sha256"), sha256=sha,
                excerpt=excerpt,
            ))
        state["sources"][url] = current

    return events, fetched


def root_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/", "", ""))


def is_relevant_official_url(url: str, title: str = "") -> bool:
    folded = ascii_fold(f"{url} {title}")
    return any(ascii_fold(hint) in folded for hint in POLITICAL_HINTS)


def parse_sitemap(raw: bytes) -> tuple[list[str], list[tuple[str, str | None]]]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return [], []
    tag = root.tag.rsplit("}", 1)[-1].lower()
    child_maps: list[str] = []
    urls: list[tuple[str, str | None]] = []
    if tag == "sitemapindex":
        for node in root:
            loc = None
            for child in node:
                if child.tag.rsplit("}", 1)[-1].lower() == "loc":
                    loc = (child.text or "").strip()
            if loc:
                child_maps.append(loc)
    elif tag == "urlset":
        for node in root:
            loc = None
            lastmod = None
            for child in node:
                name = child.tag.rsplit("}", 1)[-1].lower()
                if name == "loc":
                    loc = (child.text or "").strip()
                elif name == "lastmod":
                    lastmod = (child.text or "").strip() or None
            if loc:
                urls.append((loc, lastmod))
    return child_maps, urls


def discover_sitemap_urls(
    session: requests.Session,
    state: dict[str, Any],
    targets: list[dict[str, str]],
    config: dict[str, Any],
    errors: list[str],
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    max_children = int(config.get("official_discovery", {}).get("max_sitemaps_per_site", 8))
    max_urls = int(config.get("official_discovery", {}).get("max_relevant_urls_per_site", 80))

    roots: dict[str, str] = {}
    for target in targets:
        roots.setdefault(root_url(target["url"]), target["owner"])

    for root, owner in sorted(roots.items()):
        sitemap_candidates = {urljoin(root, "sitemap.xml")}
        try:
            robots = fetch(session, urljoin(root, "robots.txt"))
            if robots["status"] < 400:
                text = robots["raw"].decode(robots["encoding"] or "utf-8", errors="replace")
                for line in text.splitlines():
                    if line.lower().startswith("sitemap:"):
                        sitemap_candidates.add(line.split(":", 1)[1].strip())
        except requests.RequestException:
            pass

        queue = list(sitemap_candidates)
        visited = set()
        found: list[tuple[str, str | None]] = []
        while queue and len(visited) < max_children:
            sitemap_url = canonicalize_url(queue.pop(0))
            if sitemap_url in visited:
                continue
            visited.add(sitemap_url)
            try:
                result = fetch(session, sitemap_url)
            except requests.RequestException:
                continue
            if result["status"] >= 400:
                continue
            children, urls = parse_sitemap(result["raw"])
            queue.extend(children)
            found.extend(urls)

        for item_url, lastmod in found[:max_urls]:
            canonical = canonicalize_url(item_url)
            if not is_relevant_official_url(canonical):
                continue
            existing = state["official_seen_urls"].get(canonical)
            if existing:
                existing["last_seen_at"] = iso_now()
                if lastmod:
                    existing["lastmod"] = lastmod
                continue
            state["official_seen_urls"][canonical] = {
                "first_seen_at": iso_now(),
                "last_seen_at": iso_now(),
                "owner": owner,
                "lastmod": lastmod,
                "provenance": "official_sitemap",
            }
            if state.get("last_run_at"):
                events.append(event(
                    "official_new_url", url=canonical, owner=owner,
                    source_tier="tier_1_primary_official", verification_state="needs_review",
                    priority="high", discovered_via="sitemap", published_at=lastmod,
                ))
    return events


def parse_feed(raw: bytes) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    tag = root.tag.rsplit("}", 1)[-1].lower()
    out: list[dict[str, Any]] = []
    if tag == "rss":
        for item in root.findall("./channel/item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            published = (item.findtext("pubDate") or "").strip() or None
            if link:
                out.append({"title": title, "url": link, "published_at": published})
    elif tag == "feed":
        for entry in root:
            if entry.tag.rsplit("}", 1)[-1].lower() != "entry":
                continue
            title = ""
            link = ""
            published = None
            for child in entry:
                name = child.tag.rsplit("}", 1)[-1].lower()
                if name == "title":
                    title = "".join(child.itertext()).strip()
                elif name == "link" and not link:
                    link = (child.attrib.get("href") or (child.text or "")).strip()
                elif name in {"published", "updated"} and not published:
                    published = (child.text or "").strip() or None
            if link:
                out.append({"title": title, "url": link, "published_at": published})
    return out


def discover_feed_urls(
    session: requests.Session,
    state: dict[str, Any],
    targets: list[dict[str, str]],
    fetched: dict[str, dict[str, Any]],
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    max_feeds = int(config.get("official_discovery", {}).get("max_feeds_per_site", 2))
    feed_by_root: dict[str, list[str]] = {}
    owner_by_root: dict[str, str] = {}

    for target in targets:
        root = root_url(target["url"])
        owner_by_root.setdefault(root, target["owner"])
        result = fetched.get(target["url"])
        if not result or "html" not in result["content_type"].lower():
            continue
        source = result["raw"].decode(result["encoding"] or "utf-8", errors="replace")
        links = re.findall(r'<link[^>]+(?:type=["\']application/(?:rss|atom)\+xml["\'])[^>]*>', source, flags=re.I)
        hrefs = []
        for node in links:
            match = re.search(r'href=["\']([^"\']+)', node, flags=re.I)
            if match:
                hrefs.append(urljoin(result["url"], html.unescape(match.group(1))))
        if hrefs:
            feed_by_root.setdefault(root, []).extend(hrefs[:max_feeds])

    for root, feeds in feed_by_root.items():
        owner = owner_by_root.get(root, "source officielle")
        for feed_url in list(dict.fromkeys(feeds))[:max_feeds]:
            try:
                result = fetch(session, canonicalize_url(feed_url))
            except requests.RequestException:
                continue
            if result["status"] >= 400:
                continue
            for item in parse_feed(result["raw"]):
                canonical = canonicalize_url(item["url"])
                if not is_relevant_official_url(canonical, item.get("title") or ""):
                    continue
                existing = state["official_seen_urls"].get(canonical)
                if existing:
                    existing["last_seen_at"] = iso_now()
                    if item.get("published_at"):
                        existing["published_at"] = item.get("published_at")
                    continue
                state["official_seen_urls"][canonical] = {
                    "first_seen_at": iso_now(),
                    "last_seen_at": iso_now(),
                    "owner": owner,
                    "published_at": item.get("published_at"),
                    "title": item.get("title"),
                    "provenance": "official_feed",
                }
                if state.get("last_run_at"):
                    events.append(event(
                        "official_new_feed_item", url=canonical, owner=owner,
                        title=item.get("title") or "publication officielle",
                        published_at=item.get("published_at"), source_tier="tier_1_primary_official",
                        verification_state="needs_review", priority="high",
                        discovered_via="feed",
                    ))
    return events


def title_relevant(title: str, entity_name: str) -> bool:
    folded = ascii_fold(title)
    entity = ascii_fold(entity_name)
    last = entity.split()[-1] if entity.split() else ""
    return entity in folded or (len(last) >= 5 and last in folded) or any(ascii_fold(hint) in folded for hint in POLITICAL_HINTS)


def write_outputs(events: list[dict[str, Any]], errors: list[str], state: dict[str, Any]) -> None:
    out_dir = ROOT / "research" / "veille"
    out_dir.mkdir(parents=True, exist_ok=True)
    day = utc_now().date().isoformat()
    jsonl_path = out_dir / f"{day}.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for item in events:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    lines = [
        f"# Veille automatique — {day}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        "## Résumé", "",
        f"- {len(events)} événement(s) nouveau(x) ou modifié(s) ;",
        f"- {len(errors)} avertissement(s) de collecte.", "",
    ]
    if events:
        lines.extend(["## Événements", ""])
        for item in events:
            lines.append(f"- `{item['event_type']}` — **{item.get('owner', item.get('entity_name', 'source'))}**")
            if item.get("title"):
                lines.append(f"  - {item['title']}")
            if item.get("url"):
                lines.append(f"  - {item['url']}")
            if item.get("error"):
                lines.append(f"  - erreur : {item['error']}")
        lines.append("")
    if errors:
        lines.extend(["## Avertissements", ""])
        lines.extend(f"- {value}" for value in errors)
        lines.append("")
    (out_dir / f"{day}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-gdelt", action="store_true")
    parser.add_argument("--no-google", action="store_true")
    args = parser.parse_args()

    config = load_config()
    state_path = ROOT / "research" / "veille" / "state.json"
    state = load_state(state_path)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.7"})

    targets = collect_official_targets()
    errors: list[str] = []
    events, fetched = monitor_sources(session, state, targets, errors)
    events.extend(discover_sitemap_urls(session, state, targets, config, errors))
    events.extend(discover_feed_urls(session, state, targets, fetched, config))

    state["last_run_at"] = iso_now()
    state["last_run_error_count"] = len(errors)
    save_json(state_path, state)
    write_outputs(events, errors, state)

    print(
        f"Official watch: {len(targets)} source(s), {len(events)} event(s), "
        f"{len(errors)} warning(s)"
    )


if __name__ == "__main__":
    main()
