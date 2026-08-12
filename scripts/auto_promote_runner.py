#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import re
import time
from pathlib import Path
from typing import Any

import requests

import auto_promote


EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "source_title": {"type": ["string", "null"]},
        "document_type": {"type": "string", "enum": sorted(auto_promote.DOC_TYPES)},
        "published_at": {"type": ["string", "null"]},
        "claims": {
            "type": "array", "maxItems": 10,
            "items": {
                "type": "object",
                "properties": {
                    "actor_id": {"type": "string"},
                    "actor_type": {"type": "string", "enum": ["candidate", "party"]},
                    "topic": {"type": "string", "enum": sorted(auto_promote.TOPICS)},
                    "statement": {"type": "string"},
                    "evidence_quote": {"type": "string"},
                    "certainty": {"type": "string", "enum": sorted(auto_promote.CERTAINTIES)},
                    "relevance": {"type": "string", "enum": ["direct", "party_platform", "unclear"]},
                },
                "required": ["actor_id", "actor_type", "topic", "statement", "evidence_quote", "certainty", "relevance"],
                "additionalProperties": False,
            },
        },
        "status_updates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "new_status": {"type": "string", "enum": sorted(auto_promote.STATUSES)},
                    "effective_date": {"type": ["string", "null"]},
                    "evidence_quote": {"type": "string"},
                    "explicit": {"type": "boolean"},
                },
                "required": ["candidate_id", "new_status", "effective_date", "evidence_quote", "explicit"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["source_title", "document_type", "published_at", "claims", "status_updates"],
    "additionalProperties": False,
}

VERIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "minimum": 0},
                    "verdict": {"type": "string", "enum": ["CONFIRMED", "REJECTED", "AMBIGUOUS"]},
                    "relation": {"type": "string", "enum": ["NEW", "DUPLICATE", "SUPERSEDES", "CONTRADICTS", "AMBIGUOUS"]},
                    "related_proposal_id": {"type": ["string", "null"]},
                    "reason": {"type": "string"},
                },
                "required": ["index", "verdict", "relation", "related_proposal_id", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["verdicts"],
    "additionalProperties": False,
}

BACKLOG_HINTS = (
    "2027", "president", "président", "programme", "projet", "proposition",
    "question", "mesure", "retraite", "immigration", "fiscal", "impot", "impôt",
    "securite", "sécurité", "justice", "ecologie", "écologie", "energie", "énergie",
    "education", "éducation", "sante", "santé", "europe", "emploi", "travail", "logement",
    "institution", "democratie", "démocratie", "budget", "economie", "économie",
)
MONTHS_FR = {
    1: "janvier", 2: "fevrier", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
    7: "juillet", 8: "aout", 9: "septembre", 10: "octobre", 11: "novembre", 12: "decembre",
}

STRUCTURED_SOURCE_BY_PUBLIC: dict[str, dict[str, Any]] = {}
STRUCTURED_FETCH_BY_PUBLIC: dict[str, str] = {}


def schema_for_prompt(prompt: str) -> dict[str, Any]:
    if "second vérificateur indépendant" in prompt:
        return VERIFICATION_SCHEMA
    return EXTRACTION_SCHEMA


def strict_gemini(api_key: str, prompt: str, model: str) -> dict[str, Any]:
    payload = {
        "model": model,
        "input": prompt,
        "store": False,
        "generation_config": {"thinking_level": "low", "thinking_summaries": "none"},
        "response_format": {"type": "text", "mime_type": "application/json", "schema": schema_for_prompt(prompt)},
    }
    last = "unknown error"
    for attempt in range(3):
        response = requests.post(
            auto_promote.ENDPOINT,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=payload,
            timeout=90,
        )
        if response.status_code == 200:
            output = auto_promote.interaction_text(response.json())
            if not output:
                raise RuntimeError("Gemini returned no structured text")
            data = json.loads(output)
            if not isinstance(data, dict):
                raise RuntimeError("Gemini structured output root is not an object")
            return data
        try:
            detail = response.json().get("error", {}).get("message", response.text[:600])
        except Exception:
            detail = response.text[:600]
        last = f"Gemini HTTP {response.status_code}: {detail}"
        if response.status_code not in {429, 500, 502, 503, 504} or attempt == 2:
            break
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(last)


def date_supported_by_source(value: Any, text: str) -> bool:
    parsed = auto_promote.parse_day(value)
    if not parsed:
        return False
    folded = auto_promote.fold(text)
    day = parsed.day
    month = MONTHS_FR[parsed.month]
    year = parsed.year
    candidates = {
        parsed.isoformat(),
        f"{day:02d}/{parsed.month:02d}/{year}",
        f"{day}/{parsed.month}/{year}",
        f"{day:02d}.{parsed.month:02d}.{year}",
        f"{day}.{parsed.month}.{year}",
        f"{day} {month} {year}",
        f"{day}er {month} {year}" if day == 1 else "",
    }
    return any(candidate and auto_promote.fold(candidate) in folded for candidate in candidates)


def strict_sanitize(raw: dict[str, Any], text: str, allowed: list[dict[str, str]], max_claims: int):
    claims, statuses, doc_type, published = ORIGINAL_SANITIZE(raw, text, allowed, max_claims)
    if published and not date_supported_by_source(published, text):
        published = None
    statuses = [
        item for item in statuses
        if item.get("effective_date") and date_supported_by_source(item.get("effective_date"), text)
    ]
    return claims, statuses, doc_type, published


def _year(value: Any) -> int | None:
    match = re.match(r"^(\d{4})", str(value or "").strip())
    return int(match.group(1)) if match else None


def current_cycle_event(event: dict[str, Any]) -> bool:
    url = str(event.get("url") or "")
    title = str(event.get("title") or "")
    if auto_promote.explicit_old_election(f"{url} {title}"):
        return False
    published_year = _year(event.get("published_at"))
    explicit_2027 = "2027" in auto_promote.fold(f"{url} {title}")
    if published_year is not None and published_year <= 2024 and not explicit_2027:
        return False
    return True


def backlog_candidate(url: str, metadata: dict[str, Any]) -> bool:
    event = {"url": url, "published_at": metadata.get("lastmod") or metadata.get("published_at")}
    if not current_cycle_event(event):
        return False
    haystack = auto_promote.fold(url)
    if any(auto_promote.fold(hint) in haystack for hint in BACKLOG_HINTS):
        return True
    year = _year(metadata.get("lastmod") or metadata.get("published_at"))
    return bool(year and year >= 2025)


def _load_watch_state(state_path: Path | None = None) -> dict[str, Any]:
    path = state_path or (auto_promote.ROOT / "research" / "veille" / "state.json")
    if not path.exists():
        return {}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return state if isinstance(state, dict) else {}


def state_backlog_events(state_path: Path | None = None) -> list[dict[str, Any]]:
    state = _load_watch_state(state_path)
    seen = state.get("official_seen_urls") or {}
    if not isinstance(seen, dict):
        return []
    out: list[dict[str, Any]] = []
    for url, metadata in seen.items():
        if not isinstance(metadata, dict) or not metadata.get("owner"):
            continue
        if not backlog_candidate(str(url), metadata):
            continue
        observed = str(metadata.get("first_seen_at") or state.get("last_run_at") or "")
        lastmod = str(metadata.get("lastmod") or metadata.get("published_at") or "") or None
        out.append({
            "event_type": "official_new_url",
            "observed_at": observed,
            "owner": str(metadata["owner"]),
            "priority": "high",
            "published_at": lastmod,
            "source_tier": "tier_1_primary_official",
            "title": None,
            "url": str(url),
            "verification_state": "needs_review",
            "provenance": "durable_official_sitemap_backlog",
        })
    return out


def structured_backlog_events(state_path: Path | None = None) -> list[dict[str, Any]]:
    state = _load_watch_state(state_path)
    out: list[dict[str, Any]] = []
    for source_id, source in (state.get("structured_primary_health") or {}).items():
        if not isinstance(source, dict) or not source.get("complete") or source.get("status") != 200:
            continue
        owner = str(source.get("owner") or "").strip()
        if not owner:
            continue
        for item in (source.get("items") or {}).values():
            if not isinstance(item, dict) or not item.get("link") or not item.get("fetch_url") or not item.get("sha256"):
                continue
            event = {
                "event_type": "official_new_url",
                "observed_at": str(source.get("checked_at") or state.get("last_structured_primary_run_at") or ""),
                "owner": owner,
                "priority": "high",
                "published_at": item.get("date"),
                "source_tier": "tier_1_primary_official",
                "title": item.get("title"),
                "url": str(item["link"]),
                "fetch_url": str(item["fetch_url"]),
                "snapshot_path": item.get("snapshot_path"),
                "sha256": str(item["sha256"]),
                "verification_state": "needs_review",
                "provenance": "durable_official_structured_primary_backlog",
                "structured_source_id": source_id,
                "structured_item_number": item.get("number"),
            }
            if current_cycle_event(event):
                out.append(event)
    return out


def _register_structured_event(event: dict[str, Any]) -> None:
    public = str(event.get("url") or "")
    if not public:
        return
    record = {
        "fetch_url": str(event.get("fetch_url") or "") or None,
        "snapshot_path": str(event.get("snapshot_path") or "") or None,
        "sha256": str(event.get("sha256") or "") or None,
        "title": event.get("title"),
    }
    if record["fetch_url"] or record["snapshot_path"]:
        STRUCTURED_SOURCE_BY_PUBLIC[public] = record
    if record["fetch_url"]:
        STRUCTURED_FETCH_BY_PUBLIC[public] = record["fetch_url"]


def durable_load_events() -> list[dict[str, Any]]:
    events = [item for item in ORIGINAL_LOAD_EVENTS() if current_cycle_event(item)]
    for event in events:
        _register_structured_event(event)
    existing = {
        (str(item.get("url") or ""), str(item.get("sha256") or item.get("published_at") or item.get("observed_at") or ""))
        for item in events
    }
    for event in [*state_backlog_events(), *structured_backlog_events()]:
        _register_structured_event(event)
        key = (
            str(event.get("url") or ""),
            str(event.get("sha256") or event.get("published_at") or event.get("observed_at") or ""),
        )
        if key not in existing:
            events.append(event)
            existing.add(key)
    return events


def _snapshot_source(public_url: str, snapshot: str, expected_sha: str | None, max_chars: int, title: Any = None) -> dict[str, Any]:
    path = (auto_promote.ROOT / snapshot).resolve()
    structured_root = (auto_promote.ROOT / "research" / "veille" / "structured" / "snapshots").resolve()
    if structured_root not in path.parents:
        raise ValueError("structured snapshot path outside approved research directory")
    if not path.exists() or not path.is_file():
        raise ValueError(f"structured snapshot missing: {snapshot}")
    raw_text = path.read_text(encoding="utf-8").rstrip("\n")
    actual_sha = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    if expected_sha and actual_sha != expected_sha:
        raise ValueError("structured primary snapshot hash mismatch")
    full_text = auto_promote.compact(raw_text)
    if len(full_text) < 180:
        raise ValueError("structured primary snapshot text too short")
    if len(full_text) > max_chars:
        raise ValueError("structured primary snapshot exceeds configured safe extraction limit")
    return {
        "url": public_url,
        "fetch_url": public_url,
        "snapshot_path": snapshot,
        "host": auto_promote.host(public_url),
        "title": auto_promote.compact(title) or None,
        "kind": "official_html_snapshot",
        "text": full_text,
        "text_truncated": False,
        "sha256": actual_sha,
    }


def _wordpress_rest_source(session: requests.Session, public_url: str, fetch_url: str, max_chars: int) -> dict[str, Any]:
    response = session.get(fetch_url, timeout=30, allow_redirects=True)
    if response.status_code != 200:
        raise ValueError(f"structured primary HTTP {response.status_code}")
    if not auto_promote.same_host(fetch_url, response.url):
        raise ValueError(f"structured primary redirect outside official host: {response.url}")
    ctype = (response.headers.get("content-type") or "").lower()
    if "json" not in ctype:
        raise ValueError(f"structured primary unsupported content type: {ctype}")
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("structured primary JSON root is not an object")
    rendered = str((payload.get("content") or {}).get("rendered") or "")
    title_html = str((payload.get("title") or {}).get("rendered") or "")
    parser = auto_promote.Extractor()
    parser.feed(html.unescape(rendered))
    full_text = auto_promote.compact(" ".join(parser.parts))
    title = auto_promote.compact(re.sub(r"<[^>]+>", " ", html.unescape(title_html))) or None
    if len(full_text) < 180:
        raise ValueError("structured primary text too short")
    truncated = len(full_text) > max_chars
    return {
        "url": public_url,
        "fetch_url": response.url,
        "host": auto_promote.host(public_url),
        "title": title,
        "kind": "wordpress_rest_json",
        "text": full_text[:max_chars],
        "text_truncated": truncated,
        "sha256": hashlib.sha256(full_text.encode("utf-8")).hexdigest(),
    }


def safe_fetch_source(session, url: str, max_chars: int):
    record = STRUCTURED_SOURCE_BY_PUBLIC.get(str(url)) or {}
    if record.get("snapshot_path"):
        source = _snapshot_source(
            str(url),
            str(record["snapshot_path"]),
            str(record.get("sha256") or "") or None,
            max_chars,
            record.get("title"),
        )
    elif record.get("fetch_url"):
        source = _wordpress_rest_source(session, str(url), str(record["fetch_url"]), max_chars)
    else:
        source = ORIGINAL_FETCH_SOURCE(session, url, max_chars)
    if source.get("text_truncated"):
        raise ValueError("source exceeds configured safe extraction limit; refusing partial canonical promotion")
    return source


ORIGINAL_LOAD_EVENTS = auto_promote.load_events
ORIGINAL_FETCH_SOURCE = auto_promote.fetch_source
ORIGINAL_SANITIZE = auto_promote.sanitize


def main() -> None:
    auto_promote.gemini = strict_gemini
    auto_promote.load_events = durable_load_events
    auto_promote.fetch_source = safe_fetch_source
    auto_promote.sanitize = strict_sanitize
    auto_promote.main()


if __name__ == "__main__":
    main()
