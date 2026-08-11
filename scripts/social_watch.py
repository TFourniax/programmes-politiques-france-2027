#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import requests

from common import ROOT, load_yaml
from daily_watch import (
    USER_AGENT,
    ascii_fold,
    canonicalize_url,
    fetch,
    iso_now,
    root_url,
    save_json,
    utc_now,
)

SOCIAL_HINTS = (
    "2027", "president", "président", "presidentielle", "présidentielle",
    "candidat", "candidature", "programme", "proposition", "projet", "mesure",
    "reforme", "réforme", "retraite", "immigration", "budget", "fiscal",
    "impot", "impôt", "taxe", "ecologie", "écologie", "climat", "securite",
    "sécurité", "justice", "education", "éducation", "ecole", "école", "sante",
    "santé", "logement", "emploi", "travail", "salaire", "pouvoir d'achat",
    "agriculture", "industrie", "europe", "defense", "défense", "energie",
    "énergie", "constitution", "referendum", "référendum", "assemblee",
    "assemblée", "senat", "sénat", "nous proposons", "je propose", "nous voulons",
)


class HrefExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        data = {str(k).lower(): str(v or "") for k, v in attrs}
        href = data.get("href", "").strip()
        if href:
            self.hrefs.append(href)


def hostname(url: str) -> str:
    return urlsplit(url).netloc.lower().split(":", 1)[0].removeprefix("www.")


def same_host(a: str, b: str) -> bool:
    return hostname(a) == hostname(b)


def official_websites() -> list[dict[str, str]]:
    parties = load_yaml("registries/parties.yaml").get("parties", [])
    party_urls = {
        str(party.get("id")): str(party.get("official_url"))
        for party in parties
        if party.get("id") and party.get("official_url")
    }
    websites: dict[tuple[str, str], dict[str, str]] = {}

    for party in parties:
        if not party.get("id") or not party.get("name") or not party.get("official_url"):
            continue
        item = {
            "entity_id": str(party["id"]),
            "entity_name": str(party["name"]),
            "entity_type": "party",
            "url": canonicalize_url(str(party["official_url"])),
        }
        websites[(item["entity_type"], item["entity_id"])] = item

    for candidate in load_yaml("registries/candidates.yaml").get("candidates", []):
        source_url = candidate.get("source_url")
        if not source_url or candidate.get("source_tier") != "tier_1_primary_official":
            continue
        party_url = party_urls.get(str(candidate.get("primary_party_id") or ""))
        # Une page de candidat hébergée sur le site de son parti ne prouve pas que
        # les comptes sociaux du footer appartiennent personnellement au candidat.
        if party_url and same_host(str(source_url), party_url):
            continue
        if not candidate.get("id") or not candidate.get("name"):
            continue
        item = {
            "entity_id": str(candidate["id"]),
            "entity_name": str(candidate["name"]),
            "entity_type": "candidate",
            "url": canonicalize_url(root_url(str(source_url))),
        }
        websites[(item["entity_type"], item["entity_id"])] = item

    return sorted(websites.values(), key=lambda x: (x["entity_type"], x["entity_name"]))


def social_profile_from_url(url: str) -> dict[str, str] | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    host = parts.netloc.lower().split(":", 1)[0].removeprefix("www.")
    segments = [segment for segment in parts.path.split("/") if segment]
    if not segments:
        return None

    if host == "bsky.app" and len(segments) >= 2 and segments[0] == "profile":
        if len(segments) >= 3 and segments[2] == "post":
            return None
        actor = segments[1]
        return {
            "platform": "bluesky",
            "identifier_type": "actor",
            "identifier": actor,
            "profile_url": f"https://bsky.app/profile/{actor}",
        }

    if host in {"youtube.com", "m.youtube.com"}:
        first = segments[0]
        if first == "channel" and len(segments) >= 2 and segments[1].startswith("UC"):
            channel_id = segments[1]
            return {
                "platform": "youtube",
                "identifier_type": "channel_id",
                "identifier": channel_id,
                "profile_url": f"https://www.youtube.com/channel/{channel_id}",
            }
        if first.startswith("@") and len(first) > 1:
            return {
                "platform": "youtube",
                "identifier_type": "handle",
                "identifier": first,
                "profile_url": f"https://www.youtube.com/{first}",
            }
        if first == "user" and len(segments) >= 2:
            username = segments[1]
            return {
                "platform": "youtube",
                "identifier_type": "username",
                "identifier": username,
                "profile_url": f"https://www.youtube.com/user/{username}",
            }

    if host in {"x.com", "twitter.com", "mobile.twitter.com"}:
        handle = segments[0].lstrip("@").strip()
        reserved = {"home", "search", "explore", "intent", "share", "i", "hashtag", "settings"}
        if handle and handle.lower() not in reserved and re.fullmatch(r"[A-Za-z0-9_]{1,15}", handle):
            return {
                "platform": "x",
                "identifier_type": "handle",
                "identifier": handle,
                "profile_url": f"https://x.com/{handle}",
            }

    return None


def extract_social_profiles(base_url: str, raw: bytes, encoding: str | None) -> list[dict[str, str]]:
    text = raw.decode(encoding or "utf-8", errors="replace")
    parser = HrefExtractor()
    parser.feed(text)
    profiles: dict[tuple[str, str], dict[str, str]] = {}
    for href in parser.hrefs:
        absolute = urljoin(base_url, href)
        profile = social_profile_from_url(absolute)
        if profile:
            profiles[(profile["platform"], profile["identifier"].lower())] = profile
    return sorted(profiles.values(), key=lambda p: (p["platform"], p["identifier"]))


def relevant_social_text(text: str) -> bool:
    folded = ascii_fold(text)
    return any(ascii_fold(hint) in folded for hint in SOCIAL_HINTS)


def load_state() -> dict[str, Any]:
    path = ROOT / "research" / "veille" / "state.json"
    if not path.exists():
        return {"version": 1}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise SystemExit(f"Invalid watch state: {exc}")
    if not isinstance(data, dict):
        raise SystemExit("Invalid watch state root")
    return data


def profile_key(entity: dict[str, str], profile: dict[str, str]) -> str:
    return ":".join([
        profile["platform"], entity["entity_type"], entity["entity_id"],
        profile["identifier"].lower(),
    ])


def discover_profiles(
    session: requests.Session,
    state: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    profiles_state = state.setdefault("social_profiles", {})
    discovered: list[dict[str, Any]] = []
    warnings: list[str] = []

    for entity in official_websites():
        url = entity["url"]
        try:
            result = fetch(session, url)
        except requests.RequestException as exc:
            warnings.append(f"social profile discovery {url}: {exc}")
            continue
        if result["status"] >= 400 or "html" not in result["content_type"].lower():
            continue
        for profile in extract_social_profiles(result["url"], result["raw"], result["encoding"]):
            key = profile_key(entity, profile)
            existing = profiles_state.get(key)
            record = {
                **profile,
                "entity_id": entity["entity_id"],
                "entity_name": entity["entity_name"],
                "entity_type": entity["entity_type"],
                "source_site": result["url"],
                "provenance": "linked_from_official_website",
                "source_tier": "tier_1_primary_official",
                "last_confirmed_at": iso_now(),
            }
            if existing:
                record["discovered_at"] = existing.get("discovered_at", iso_now())
            else:
                record["discovered_at"] = iso_now()
            profiles_state[key] = record
            discovered.append({"key": key, "is_new": existing is None, **record})

    return discovered, warnings


def bsky_items(session: requests.Session, profile: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    response = session.get(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed",
        params={"actor": profile["identifier"], "filter": "posts_no_replies", "limit": limit},
        timeout=25,
    )
    response.raise_for_status()
    payload = response.json()
    out: list[dict[str, Any]] = []
    actor = profile["identifier"].lower()
    for feed_item in payload.get("feed", []):
        post = feed_item.get("post") or {}
        author = post.get("author") or {}
        if str(author.get("handle") or "").lower() != actor:
            continue
        record = post.get("record") or {}
        uri = str(post.get("uri") or "")
        if not uri:
            continue
        rkey = uri.rsplit("/", 1)[-1]
        handle = str(author.get("handle") or profile["identifier"])
        text = str(record.get("text") or "").strip()
        out.append({
            "id": uri,
            "url": f"https://bsky.app/profile/{handle}/post/{rkey}",
            "title": text[:180] or "Publication Bluesky",
            "text": text,
            "published_at": record.get("createdAt") or post.get("indexedAt"),
        })
    return out


def resolve_youtube_channel(
    session: requests.Session,
    profile: dict[str, Any],
    api_key: str,
) -> dict[str, str] | None:
    params: dict[str, str] = {"part": "contentDetails,snippet", "key": api_key}
    kind = profile["identifier_type"]
    identifier = profile["identifier"]
    if kind == "channel_id":
        params["id"] = identifier
    elif kind == "handle":
        params["forHandle"] = identifier
    elif kind == "username":
        params["forUsername"] = identifier
    else:
        return None
    response = session.get("https://www.googleapis.com/youtube/v3/channels", params=params, timeout=25)
    response.raise_for_status()
    items = response.json().get("items", [])
    if not items:
        return None
    channel = items[0]
    uploads = ((channel.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads")
    if not uploads:
        return None
    return {
        "channel_id": str(channel.get("id") or identifier),
        "uploads_playlist_id": str(uploads),
        "channel_title": str((channel.get("snippet") or {}).get("title") or profile["entity_name"]),
    }


def youtube_items(
    session: requests.Session,
    profile: dict[str, Any],
    api_key: str,
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, str] | None]:
    resolved = resolve_youtube_channel(session, profile, api_key)
    if not resolved:
        return [], None
    response = session.get(
        "https://www.googleapis.com/youtube/v3/playlistItems",
        params={
            "part": "snippet,contentDetails",
            "playlistId": resolved["uploads_playlist_id"],
            "maxResults": min(max(limit, 1), 50),
            "key": api_key,
        },
        timeout=25,
    )
    response.raise_for_status()
    out: list[dict[str, Any]] = []
    for item in response.json().get("items", []):
        snippet = item.get("snippet") or {}
        content = item.get("contentDetails") or {}
        resource = snippet.get("resourceId") or {}
        video_id = str(content.get("videoId") or resource.get("videoId") or "")
        if not video_id:
            continue
        title = str(snippet.get("title") or "").strip()
        description = str(snippet.get("description") or "").strip()
        out.append({
            "id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "title": title or "Vidéo YouTube",
            "text": f"{title}\n{description}".strip(),
            "published_at": content.get("videoPublishedAt") or snippet.get("publishedAt"),
        })
    return out, resolved


def collect_social_events(
    session: requests.Session,
    state: dict[str, Any],
    profiles: list[dict[str, Any]],
    config: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    seen = state.setdefault("social_seen_items", {})
    events: list[dict[str, Any]] = []
    warnings: list[str] = []
    bsky_cfg = config.get("bluesky", {})
    youtube_cfg = config.get("youtube", {})
    youtube_key = os.environ.get("YOUTUBE_API_KEY", "").strip()

    for profile in profiles:
        platform = profile["platform"]
        items: list[dict[str, Any]] = []
        if platform == "bluesky" and bsky_cfg.get("enabled", True):
            try:
                items = bsky_items(session, profile, int(bsky_cfg.get("max_posts_per_profile", 20)))
            except (requests.RequestException, ValueError) as exc:
                warnings.append(f"Bluesky {profile['profile_url']}: {exc}")
                continue
        elif platform == "youtube" and youtube_cfg.get("enabled", True):
            if not youtube_key:
                continue
            try:
                items, resolved = youtube_items(
                    session, profile, youtube_key,
                    int(youtube_cfg.get("max_videos_per_channel", 12)),
                )
                if resolved:
                    state["social_profiles"][profile["key"]].update(resolved)
                    state["social_profiles"][profile["key"]]["last_confirmed_at"] = iso_now()
            except (requests.RequestException, ValueError) as exc:
                warnings.append(f"YouTube {profile['profile_url']}: {exc}")
                continue
        else:
            # X est volontairement seulement découvert et enregistré en V1.
            continue

        profile_seen = seen.setdefault(profile["key"], {})
        initial_profile_sync = profile["is_new"] or not profile_seen
        for item in items:
            item_id = str(item["id"])
            already_seen = item_id in profile_seen
            profile_seen[item_id] = {
                "first_seen_at": profile_seen.get(item_id, {}).get("first_seen_at", iso_now()),
                "last_seen_at": iso_now(),
                "published_at": item.get("published_at"),
                "url": item.get("url"),
            }
            if already_seen or initial_profile_sync:
                continue
            if not relevant_social_text(str(item.get("text") or item.get("title") or "")):
                continue
            events.append({
                "event_type": "official_social_post",
                "observed_at": iso_now(),
                "platform": platform,
                "entity_id": profile["entity_id"],
                "entity_name": profile["entity_name"],
                "entity_type": profile["entity_type"],
                "profile_url": profile["profile_url"],
                "url": item["url"],
                "title": item["title"],
                "excerpt": str(item.get("text") or "")[:700],
                "published_at": item.get("published_at"),
                "source_tier": "tier_1_primary_official",
                "verification_state": "needs_review",
                "priority": "normal",
                "provenance": "official_social_profile_linked_from_official_website",
            })

    return events, warnings


def public_profile_snapshot(state: dict[str, Any], youtube_enabled: bool) -> list[dict[str, Any]]:
    out = []
    for record in state.get("social_profiles", {}).values():
        copy = dict(record)
        if copy.get("platform") == "youtube" and not youtube_enabled:
            copy["collection_state"] = "profile_verified_waiting_for_free_api_key"
        elif copy.get("platform") == "x":
            copy["collection_state"] = "profile_verified_collection_disabled_cost_control"
        else:
            copy["collection_state"] = "active"
        out.append(copy)
    return sorted(out, key=lambda x: (x.get("platform", ""), x.get("entity_name", "")))


def write_outputs(
    state: dict[str, Any],
    profiles: list[dict[str, Any]],
    events: list[dict[str, Any]],
    warnings: list[str],
    youtube_enabled: bool,
) -> None:
    base = ROOT / "research" / "veille"
    social_dir = base / "social"
    social_dir.mkdir(parents=True, exist_ok=True)
    day = utc_now().date().isoformat()

    save_json(base / "social-profiles.json", public_profile_snapshot(state, youtube_enabled))

    jsonl = social_dir / f"{day}.jsonl"
    with jsonl.open("w", encoding="utf-8") as handle:
        for item in sorted(events, key=lambda e: (e["platform"], e["entity_name"], e["url"])):
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    counts: dict[str, int] = {}
    for profile in profiles:
        counts[profile["platform"]] = counts.get(profile["platform"], 0) + 1

    lines = [
        f"# Veille réseaux sociaux officiels — {day}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        "> Les comptes listés ici ont été découverts depuis un site officiel suivi. Une publication",
        "> officielle est une déclaration publique, pas automatiquement une mesure de programme.", "",
        "## Couverture", "",
        f"- {counts.get('bluesky', 0)} profil(s) Bluesky officiel(s) découvert(s) ;",
        f"- {counts.get('youtube', 0)} chaîne(s)/profil(s) YouTube officiel(s) découvert(s) ;",
        f"- {counts.get('x', 0)} profil(s) X officiel(s) découvert(s), collecte désactivée ;",
        f"- {len(events)} publication(s) nouvelle(s) pertinente(s) retenue(s) ;",
        f"- {len(warnings)} avertissement(s) technique(s).", "",
    ]

    if events:
        lines.extend(["## Nouvelles publications à examiner", ""])
        for item in events:
            lines.append(f"- **{item['entity_name']} · {item['platform']}** — [{item['title']}]({item['url']})")
            if item.get("published_at"):
                lines.append(f"  - publié : {item['published_at']}")
            lines.append("  - `tier_1_primary_official` · `needs_review`")
        lines.append("")
    else:
        lines.extend(["Aucune nouvelle publication pertinente retenue aujourd'hui.", ""])

    if not youtube_enabled and counts.get("youtube", 0):
        lines.extend([
            "## YouTube", "",
            "Les chaînes officielles sont enregistrées mais la lecture API attend `YOUTUBE_API_KEY`.",
            "Cette clé utilise le quota gratuit de YouTube Data API ; aucun budget payant n'est requis.", "",
        ])

    if warnings:
        lines.extend(["## Avertissements", ""])
        lines.extend(f"- {warning}" for warning in warnings)
        lines.append("")

    (social_dir / f"{day}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    config = load_yaml("registries/watch.yaml")
    if not config.get("enabled", True):
        print("Watch disabled by registries/watch.yaml")
        return

    state = load_state()
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.7"})

    profiles, discovery_warnings = discover_profiles(session, state)
    events, collection_warnings = collect_social_events(session, state, profiles, config)
    youtube_enabled = bool(os.environ.get("YOUTUBE_API_KEY", "").strip())

    state["last_social_run_at"] = iso_now()
    state["last_social_event_count"] = len(events)
    state["last_social_profile_count"] = len(profiles)
    save_json(ROOT / "research" / "veille" / "state.json", state)
    write_outputs(
        state, profiles, events, discovery_warnings + collection_warnings, youtube_enabled
    )

    print(f"Discovered {len(profiles)} official social profile link(s)")
    print(f"Wrote {len(events)} relevant new official social event(s)")
    if not youtube_enabled:
        print("YouTube collection skipped unless YOUTUBE_API_KEY is configured")


if __name__ == "__main__":
    main()
