#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

import requests

from common import ROOT, load_yaml

USER_AGENT = "programmes-politiques-france-2027-watch/1.0 (+https://github.com/TFourniax/programmes-politiques-france-2027)"
MAX_BYTES = 5_000_000
TRACKING_KEYS = {"fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"}
POLITICAL_HINTS = (
    "2027", "president", "président", "candidat", "candidature", "programme",
    "proposition", "projet", "mesure", "election", "élection", "communique",
    "communiqué", "discours", "meeting", "retraite", "immigration", "budget",
    "ecologie", "écologie", "securite", "sécurité", "fiscal", "education",
    "éducation", "sante", "santé", "logement", "emploi", "europe",
)


class TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "canvas", "template"}

    def __init__(self):
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


class FeedLinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link":
            return
        data = {str(k).lower(): str(v or "") for k, v in attrs}
        rel = data.get("rel", "").lower()
        typ = data.get("type", "").lower()
        href = data.get("href", "")
        if href and "alternate" in rel and typ in {
            "application/rss+xml", "application/atom+xml", "application/feed+json"
        }:
            self.links.append(href)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().replace(microsecond=0).isoformat()


def ascii_fold(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(c)
    ).lower()


def canonicalize_url(url: str) -> str:
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return url.strip()
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        k = key.lower()
        if k.startswith("utm_") or k in TRACKING_KEYS:
            continue
        query.append((key, value))
    return urlunsplit((
        parts.scheme.lower(),
        parts.netloc.lower(),
        parts.path or "/",
        urlencode(sorted(query)),
        "",
    ))


def normalize_html(raw: bytes, encoding: str | None = None) -> str:
    text = raw.decode(encoding or "utf-8", errors="replace")
    parser = TextExtractor()
    parser.feed(text)
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def hash_payload(raw: bytes, content_type: str, encoding: str | None = None) -> tuple[str, str]:
    if "html" in content_type.lower():
        text = normalize_html(raw, encoding)
        payload = text.encode("utf-8")
        excerpt = text[:700]
    else:
        payload = raw
        excerpt = ""
    return hashlib.sha256(payload).hexdigest(), excerpt


def fetch(session: requests.Session, url: str, timeout: int = 20) -> dict[str, Any]:
    response = session.get(url, timeout=timeout, allow_redirects=True, stream=True)
    raw = bytearray()
    for chunk in response.iter_content(chunk_size=65536):
        if not chunk:
            continue
        remaining = MAX_BYTES - len(raw)
        if remaining <= 0:
            break
        raw.extend(chunk[:remaining])
        if len(raw) >= MAX_BYTES:
            break
    content_type = response.headers.get("content-type", "")
    return {
        "requested_url": url,
        "url": canonicalize_url(response.url),
        "status": response.status_code,
        "content_type": content_type,
        "etag": response.headers.get("etag"),
        "last_modified": response.headers.get("last-modified"),
        "raw": bytes(raw),
        "encoding": response.encoding,
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "version": 1,
            "sources": {},
            "official_seen_urls": {},
            "discovery_seen_urls": {},
            "feeds": {},
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        raise SystemExit(f"Invalid watch state: {path}")
    if not isinstance(data, dict):
        raise SystemExit(f"Invalid watch state root: {path}")
    data.setdefault("sources", {})
    data.setdefault("official_seen_urls", {})
    data.setdefault("discovery_seen_urls", {})
    data.setdefault("feeds", {})
    return data


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


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
            # An HTTP error page is never political content. Preserve the last valid hash
            # so recovery is compared against the real source, not a WAF/rate-limit page.
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
            found.extend(urls)
            for child in children:
                if len(queue) + len(visited) >= max_children:
                    break
                if urlsplit(child).netloc == urlsplit(root).netloc:
                    queue.append(child)

        relevant = []
        for url, lastmod in found:
            canonical = canonicalize_url(url)
            if urlsplit(canonical).netloc != urlsplit(root).netloc:
                continue
            if not is_relevant_official_url(canonical):
                continue
            relevant.append((canonical, lastmod))

        relevant = sorted(
            set(relevant), key=lambda pair: (pair[1] or "", pair[0]), reverse=True
        )[:max_urls]

        for url, lastmod in relevant:
            first_seen = state["official_seen_urls"].get(url)
            if first_seen is None:
                state["official_seen_urls"][url] = {
                    "first_seen_at": iso_now(), "owner": owner, "lastmod": lastmod,
                }
                if state.get("last_run_at"):
                    events.append(event(
                        "official_new_url", url=url, owner=owner, title=None,
                        published_at=lastmod, source_tier="tier_1_primary_official",
                        verification_state="needs_review", priority="high",
                    ))
            elif lastmod and lastmod != first_seen.get("lastmod"):
                first_seen["lastmod"] = lastmod
                first_seen["last_seen_at"] = iso_now()

    return events


def discover_feed_links(base_url: str, raw: bytes, encoding: str | None) -> list[str]:
    text = raw.decode(encoding or "utf-8", errors="replace")
    parser = FeedLinkExtractor()
    parser.feed(text)
    return sorted({canonicalize_url(urljoin(base_url, href)) for href in parser.links})


def parse_feed(raw: bytes) -> list[dict[str, str | None]]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    items = []
    for node in root.iter():
        tag = node.tag.rsplit("}", 1)[-1].lower()
        if tag not in {"item", "entry"}:
            continue
        title = ""
        link = ""
        published = None
        for child in list(node):
            name = child.tag.rsplit("}", 1)[-1].lower()
            if name == "title":
                title = (child.text or "").strip()
            elif name == "link":
                link = (child.text or "").strip() or child.attrib.get("href", "")
            elif name in {"pubdate", "published", "updated"}:
                published = (child.text or "").strip() or None
        if link:
            items.append({"title": title, "url": link, "published_at": published})
    return items


def discover_official_feeds(
    session: requests.Session,
    state: dict[str, Any],
    targets: list[dict[str, str]],
    fetched: dict[str, dict[str, Any]],
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    max_feeds = int(config.get("official_discovery", {}).get("max_feeds_per_site", 2))
    roots: dict[str, str] = {}
    for target in targets:
        roots.setdefault(root_url(target["url"]), target["owner"])

    for root, owner in sorted(roots.items()):
        homepage = fetched.get(canonicalize_url(root))
        if homepage is None:
            try:
                homepage = fetch(session, root)
            except requests.RequestException:
                continue
        if homepage["status"] >= 400 or "html" not in homepage["content_type"].lower():
            continue
        feeds = discover_feed_links(root, homepage["raw"], homepage["encoding"])[:max_feeds]
        for feed_url in feeds:
            try:
                result = fetch(session, feed_url)
            except requests.RequestException:
                continue
            if result["status"] >= 400:
                continue
            for item in parse_feed(result["raw"]):
                url = canonicalize_url(str(item["url"]))
                title = str(item.get("title") or "")
                if not is_relevant_official_url(url, title):
                    continue
                if url not in state["official_seen_urls"]:
                    state["official_seen_urls"][url] = {
                        "first_seen_at": iso_now(), "owner": owner,
                        "published_at": item.get("published_at"),
                    }
                    if state.get("last_run_at"):
                        events.append(event(
                            "official_new_feed_item", url=url, owner=owner, title=title,
                            published_at=item.get("published_at"),
                            source_tier="tier_1_primary_official",
                            verification_state="needs_review", priority="high",
                        ))
    return events


def domain_matches(host: str, domain: str) -> bool:
    host = host.lower().split(":", 1)[0]
    domain = domain.lower().lstrip(".")
    return host == domain or host.endswith("." + domain)


def trusted_press(url_or_domain: str, config: dict[str, Any]) -> bool:
    value = url_or_domain.strip().lower()
    host = urlsplit(value).netloc if "://" in value else value
    domains = config.get("gdelt", {}).get("trusted_press_domains", [])
    return any(domain_matches(host, str(domain)) for domain in domains)


def seen_discovery(state: dict[str, Any], url: str, source: str) -> bool:
    canonical = canonicalize_url(url)
    if canonical in state["discovery_seen_urls"]:
        state["discovery_seen_urls"][canonical]["last_seen_at"] = iso_now()
        return True
    state["discovery_seen_urls"][canonical] = {
        "first_seen_at": iso_now(), "last_seen_at": iso_now(), "source": source,
    }
    return False


def title_relevant(title: str, entity_name: str) -> bool:
    folded = ascii_fold(title)
    last_name = ascii_fold(entity_name.split()[-1]) if entity_name.split() else ""
    return bool(last_name and last_name in folded) or any(
        ascii_fold(hint) in folded for hint in POLITICAL_HINTS
    )


def discover_gdelt(
    session: requests.Session,
    state: dict[str, Any],
    entities: list[dict[str, str]],
    config: dict[str, Any],
    errors: list[str],
) -> list[dict[str, Any]]:
    settings = config.get("gdelt", {})
    if not settings.get("enabled", True):
        return []
    keep = int(settings.get("keep_per_entity", 3))
    maxrecords = int(settings.get("max_records_per_entity", 12))
    max_entities = int(settings.get("max_entities", 60))
    timespan = str(settings.get("timespan", "1d"))
    events: list[dict[str, Any]] = []

    for entity in entities[:max_entities]:
        query = f'"{entity["name"]}" (présidentielle OR programme OR proposition OR candidature OR 2027)'
        params = {
            "query": query, "mode": "artlist", "maxrecords": maxrecords,
            "timespan": timespan, "sort": "datedesc", "format": "json",
        }
        try:
            response = session.get(
                "https://api.gdeltproject.org/api/v2/doc/doc", params=params, timeout=25,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            errors.append(f"GDELT {entity['name']}: {exc}")
            continue

        kept = 0
        for article in payload.get("articles", []):
            url = article.get("url")
            title = article.get("title") or ""
            if not url or not title or not title_relevant(str(title), entity["name"]):
                continue
            canonical = canonicalize_url(str(url))
            domain = str(article.get("domain") or urlsplit(canonical).netloc)
            is_trusted = trusted_press(domain, config)
            if not is_trusted and not settings.get("allow_unlisted_domains", False):
                continue
            if seen_discovery(state, canonical, "gdelt"):
                continue
            events.append(event(
                "press_discovery", url=canonical, title=str(title), entity_id=entity["id"],
                entity_name=entity["name"], published_at=article.get("seendate"),
                domain=domain, language=article.get("language"),
                source_tier="tier_3_reliable_secondary" if is_trusted else "tier_4_exploratory",
                verification_state="discovery_only", priority="normal", discovered_via="gdelt",
            ))
            kept += 1
            if kept >= keep:
                break
        time.sleep(float(settings.get("request_delay_seconds", 0.15)))

    return events


def grounding_urls(payload: dict[str, Any]) -> list[dict[str, str]]:
    out = []
    for candidate in payload.get("candidates", []):
        metadata = candidate.get("groundingMetadata") or {}
        for chunk in metadata.get("groundingChunks") or []:
            web = chunk.get("web") or {}
            uri = web.get("uri")
            if uri:
                out.append({"url": str(uri), "title": str(web.get("title") or "")})
    return out


def discover_google_grounding(
    session: requests.Session,
    state: dict[str, Any],
    entities: list[dict[str, str]],
    config: dict[str, Any],
    errors: list[str],
    official_hosts: set[str],
) -> list[dict[str, Any]]:
    settings = config.get("google_search_grounding", {})
    if not settings.get("enabled", True):
        return []
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return []

    model = str(settings.get("model", "gemini-2.5-flash-lite"))
    max_entities = int(settings.get("max_entities", 60))
    max_urls = int(settings.get("max_urls_per_entity", 5))
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    events: list[dict[str, Any]] = []

    for entity in entities[:max_entities]:
        prompt = (
            "Recherche sur le web uniquement les nouveautés substantielles publiées au cours des "
            "36 dernières heures à propos de "
            f"{entity['name']} et de l'élection présidentielle française de 2027. "
            "Cherche les programmes, propositions, candidatures, retraits, alliances, communiqués "
            "et déclarations politiques substantielles. N'infère rien et privilégie les sources "
            "primaires. Réponds brièvement; les URLs de grounding seront exploitées séparément."
        )
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 256},
        }
        try:
            response = session.post(
                endpoint,
                headers={"x-goog-api-key": api_key, "content-type": "application/json"},
                json=body, timeout=45,
            )
            if response.status_code == 429:
                errors.append("Gemini Search Grounding: quota/rate limit reached; stopping for this run")
                break
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            errors.append(f"Gemini Search Grounding {entity['name']}: {exc}")
            continue

        kept = 0
        for item in grounding_urls(payload):
            canonical = canonicalize_url(item["url"])
            if seen_discovery(state, canonical, "google_search_grounding"):
                continue
            host = urlsplit(canonical).netloc.lower().split(":", 1)[0]
            is_official = any(domain_matches(host, official) for official in official_hosts)
            is_trusted = trusted_press(host, config)
            events.append(event(
                "web_discovery", url=canonical, title=item["title"], entity_id=entity["id"],
                entity_name=entity["name"], domain=host,
                source_tier=(
                    "tier_1_primary_official" if is_official
                    else "tier_3_reliable_secondary" if is_trusted
                    else "tier_4_exploratory"
                ),
                verification_state="needs_review" if is_official else "discovery_only",
                priority="high" if is_official else "normal",
                discovered_via="google_search_grounding",
            ))
            kept += 1
            if kept >= max_urls:
                break
        time.sleep(float(settings.get("request_delay_seconds", 0.1)))

    return events


def write_outputs(events: list[dict[str, Any]], errors: list[str]) -> tuple[Path, Path]:
    day = utc_now().date().isoformat()
    out_dir = ROOT / "research" / "veille"
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / f"{day}.jsonl"
    report_path = out_dir / f"{day}.md"

    events = sorted(
        events,
        key=lambda item: (
            0 if item.get("priority") == "high" else 1,
            item.get("event_type", ""),
            item.get("owner") or item.get("entity_name") or "",
            item.get("url") or "",
        ),
    )
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for item in events:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    groups: dict[str, list[dict[str, Any]]] = {}
    for item in events:
        groups.setdefault(item["event_type"], []).append(item)

    labels = {
        "official_source_changed": "Changements détectés sur des sources officielles",
        "official_new_url": "Nouvelles URLs officielles détectées",
        "official_new_feed_item": "Nouveaux éléments de flux officiels",
        "press_discovery": "Pistes presse (découverte uniquement)",
        "web_discovery": "Pistes Google Search Grounding",
        "source_fetch_error": "Sources à vérifier techniquement",
    }

    lines = [
        f"# Veille quotidienne — {day}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        "> Cette veille est une **boîte de réception de recherche**. Elle ne modifie jamais automatiquement",
        "> `corpus/`, `proposals/` ni les statuts canoniques. Les pistes presse/web restent",
        "> non canoniques jusqu'à validation selon `SOURCES_POLICY.md` et `METHODOLOGY.md`.", "",
        "## Résumé", "",
        f"- {len(events)} événement(s) nouveau(x) ;",
        f"- {sum(1 for e in events if e.get('source_tier') == 'tier_1_primary_official')} événement(s) issu(s) de sources officielles ;",
        f"- {sum(1 for e in events if e.get('verification_state') == 'discovery_only')} piste(s) exploratoire(s) ;",
        f"- {len(errors)} avertissement(s) technique(s).", "",
    ]

    if not events:
        lines.extend(["Aucune nouveauté détectée aujourd'hui.", ""])

    for event_type in (
        "official_source_changed", "official_new_url", "official_new_feed_item",
        "press_discovery", "web_discovery", "source_fetch_error",
    ):
        items = groups.get(event_type, [])
        if not items:
            continue
        lines.extend([f"## {labels[event_type]}", ""])
        for item in items:
            title = item.get("title") or item.get("owner") or item.get("entity_name") or item.get("url")
            actor = item.get("owner") or item.get("entity_name") or ""
            url = item.get("url") or ""
            meta = " · ".join(
                str(value) for value in [
                    actor, item.get("published_at"), item.get("domain"),
                    item.get("source_tier"), item.get("verification_state"),
                ] if value
            )
            lines.append(f"- [{title}]({url})" if url else f"- {title}")
            if meta:
                lines.append(f"  - {meta}")
        lines.append("")

    if errors:
        lines.extend(["## Avertissements techniques", ""])
        lines.extend(f"- {err}" for err in errors)
        lines.append("")

    report_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return jsonl_path, report_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the zero-cost daily political watch.")
    parser.add_argument("--no-gdelt", action="store_true")
    parser.add_argument("--no-google", action="store_true")
    args = parser.parse_args()

    config = load_config()
    if not config.get("enabled", True):
        print("Watch disabled by registries/watch.yaml")
        return

    state_path = ROOT / "research" / "veille" / "state.json"
    state = load_state(state_path)
    errors: list[str] = []
    events: list[dict[str, Any]] = []

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.7"})

    targets = collect_official_targets()
    source_events, fetched = monitor_sources(session, state, targets, errors)
    events.extend(source_events)
    events.extend(discover_sitemap_urls(session, state, targets, config, errors))
    events.extend(discover_official_feeds(session, state, targets, fetched, config))

    entities = collect_candidate_entities()
    if not args.no_gdelt:
        events.extend(discover_gdelt(session, state, entities, config, errors))
    if not args.no_google:
        official_hosts = {
            urlsplit(target["url"]).netloc.lower().split(":", 1)[0] for target in targets
        }
        events.extend(discover_google_grounding(
            session, state, entities, config, errors, official_hosts
        ))

    unique_events = []
    seen_keys = set()
    for item in events:
        key = (
            item.get("event_type"), canonicalize_url(str(item.get("url") or "")),
            item.get("entity_id"),
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        unique_events.append(item)

    state["last_run_at"] = iso_now()
    state["last_run_event_count"] = len(unique_events)
    state["last_run_error_count"] = len(errors)
    save_json(state_path, state)
    jsonl_path, report_path = write_outputs(unique_events, errors)

    print(f"Watched {len(targets)} official targets")
    print(f"Tracked {len(entities)} candidate entities")
    print(f"Wrote {jsonl_path.relative_to(ROOT)} and {report_path.relative_to(ROOT)}")
    print(f"{len(unique_events)} new event(s), {len(errors)} warning(s)")


if __name__ == "__main__":
    main()
