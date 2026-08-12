#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import requests

from common import ROOT
from social_watch import youtube_public_items

USER_AGENT = "programmes-politiques-france-2027-social-identity/1.0"


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def fold(value: Any) -> str:
    text = str(value or "").lower()
    text = text.replace("é", "e").replace("è", "e").replace("ê", "e").replace("ë", "e")
    text = text.replace("à", "a").replace("â", "a").replace("î", "i").replace("ï", "i")
    text = text.replace("ô", "o").replace("ö", "o").replace("ù", "u").replace("û", "u").replace("ü", "u")
    text = text.replace("ç", "c")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def meaningful_tokens(value: Any) -> set[str]:
    stop = {"le", "la", "les", "de", "des", "du", "un", "une", "et", "parti", "mouvement", "officiel", "officielle"}
    return {token for token in fold(value).split() if token not in stop and len(token) >= 3}


def hostname(url: str) -> str:
    host = (urlsplit(str(url or "")).hostname or "").lower()
    return host.removeprefix("www.")


def identity_name_matches(entity_name: str, profile_name: str) -> bool:
    entity = meaningful_tokens(entity_name)
    profile = meaningful_tokens(profile_name)
    if not entity or not profile:
        return False
    return entity.issubset(profile) or profile.issubset(entity)


def handle_matches_site(handle: str, source_site: str) -> bool:
    handle = str(handle or "").lower().lstrip("@").rstrip(".")
    site = hostname(source_site)
    return bool(handle and site and (handle == site or handle.endswith("." + site)))


def resolve_youtube(session: requests.Session, record: dict[str, Any], api_key: str) -> dict[str, Any] | None:
    params: dict[str, str] = {"part": "snippet", "key": api_key}
    kind = record.get("identifier_type")
    identifier = str(record.get("identifier") or "")
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
    items = response.json().get("items") or []
    if not items:
        return None
    item = items[0]
    snippet = item.get("snippet") or {}
    return {
        "channel_id": str(item.get("id") or ""),
        "display_name": str(snippet.get("title") or ""),
        "description": str(snippet.get("description") or "")[:500],
        "custom_url": str(snippet.get("customUrl") or ""),
    }


def verify_profile(session: requests.Session, record: dict[str, Any], youtube_key: str) -> dict[str, Any]:
    platform = record.get("platform")
    entity_name = str(record.get("entity_name") or "")
    source_site = str(record.get("source_site") or "")
    out = dict(record)
    out["identity_checked_at"] = iso_now()

    if platform == "bluesky":
        try:
            response = session.get(
                "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
                params={"actor": record.get("identifier")}, timeout=25,
            )
            response.raise_for_status()
            profile = response.json()
            handle = str(profile.get("handle") or "")
            display_name = str(profile.get("displayName") or "")
            verified = handle_matches_site(handle, source_site) or identity_name_matches(entity_name, display_name)
            out.update({
                "resolved_handle": handle,
                "resolved_display_name": display_name,
                "resolved_did": profile.get("did"),
                "identity_state": "verified" if verified else "rejected_identity_mismatch",
                "identity_method": "official_site_link_plus_public_profile_identity",
            })
        except (requests.RequestException, ValueError) as exc:
            out.update({
                "identity_state": "verification_unavailable",
                "identity_method": "bluesky_public_profile_lookup_failed",
                "identity_error": f"{type(exc).__name__}: {exc}",
            })

    elif platform == "youtube":
        public_error = None
        resolved = None
        try:
            _, resolved = youtube_public_items(session, record, 1)
        except (requests.RequestException, ValueError) as exc:
            public_error = exc
        if resolved:
            verified = identity_name_matches(entity_name, resolved.get("display_name") or resolved.get("channel_title"))
            out.update(resolved)
            out.update({
                "identity_state": "verified" if verified else "rejected_identity_mismatch",
                "identity_method": "official_site_link_plus_youtube_public_feed_identity",
            })
        elif youtube_key:
            try:
                resolved = resolve_youtube(session, record, youtube_key)
                if not resolved:
                    out.update({"identity_state": "rejected_profile_not_found", "identity_method": "youtube_channel_lookup"})
                else:
                    verified = identity_name_matches(entity_name, resolved["display_name"])
                    out.update(resolved)
                    out.update({
                        "identity_state": "verified" if verified else "rejected_identity_mismatch",
                        "identity_method": "official_site_link_plus_youtube_api_identity_fallback",
                    })
            except (requests.RequestException, ValueError) as exc:
                out.update({
                    "identity_state": "verification_unavailable",
                    "identity_method": "youtube_identity_lookup_failed",
                    "identity_error": f"public={public_error}; api={type(exc).__name__}: {exc}",
                })
        else:
            out.update({
                "identity_state": "verification_unavailable",
                "identity_method": "youtube_public_feed_identity_unavailable",
                "identity_error": f"{type(public_error).__name__}: {public_error}" if public_error else "public feed unavailable",
            })

    elif platform == "x":
        # Aucun appel X payant : un lien trouvé dans une page officielle peut provenir
        # d'un embed ou d'une citation tierce, il n'est donc jamais considéré comme
        # identité officielle sans preuve supplémentaire.
        out.update({
            "identity_state": "unverified_no_free_identity_check",
            "identity_method": "discovery_only_cost_control",
        })
    else:
        out.update({"identity_state": "unsupported_platform", "identity_method": "none"})

    if out.get("identity_state") == "verified":
        out["source_tier"] = "tier_1_primary_official"
        out["provenance"] = "official_website_link_plus_identity_verification"
        out["collection_state"] = "active"
    else:
        out["source_tier"] = "tier_4_discovery_only"
        out["provenance"] = "social_link_discovery_not_identity_verified"
        out["collection_state"] = "identity_unverified"
    return out


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def verified_keys(records: list[dict[str, Any]]) -> set[tuple[str, str, str]]:
    return {
        (str(x.get("entity_id")), str(x.get("platform")), str(x.get("profile_url")))
        for x in records if x.get("identity_state") == "verified"
    }


def filter_events(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = verified_keys(records)
    path = ROOT / "research" / "veille" / "social" / f"{day()}.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        key = (str(event.get("entity_id")), str(event.get("platform")), str(event.get("profile_url")))
        if key not in allowed:
            continue
        event["identity_verification_state"] = "verified"
        event["verification_state"] = "identity_verified_needs_claim_verification"
        event["source_tier"] = "tier_1_primary_official"
        out.append(event)
    return out


def write_outputs(records: list[dict[str, Any]], events: list[dict[str, Any]]) -> None:
    base = ROOT / "research" / "veille"
    verified = [x for x in records if x.get("identity_state") == "verified"]
    (base / "social-profiles.json").write_text(json.dumps(records, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (base / "social-profiles-verified.json").write_text(json.dumps(verified, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    out_dir = base / "social-verified"
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / f"{day()}.jsonl").open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")

    states: dict[str, int] = {}
    for record in records:
        state = str(record.get("identity_state") or "unknown")
        states[state] = states.get(state, 0) + 1
    lines = [
        f"# Vérification d'identité sociale — {day()}", "",
        f"Généré automatiquement à `{iso_now()}`.", "",
        f"- {len(records)} lien(s) de profil découvert(s) ;",
        f"- {len(verified)} identité(s) vérifiée(s) ;",
        f"- {len(events)} nouvelle(s) publication(s) éligible(s) au gate canonique ;", "",
        "## États", "",
    ]
    lines.extend(f"- `{key}` : {value}" for key, value in sorted(states.items()))
    lines += ["", "Un lien social intégré ou cité sur un site officiel n'est jamais suffisant, à lui seul, pour qualifier le compte d'officiel.", ""]
    (out_dir / f"{day()}.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    base = ROOT / "research" / "veille"
    profiles = load_json(base / "social-profiles.json", [])
    if not isinstance(profiles, list):
        raise SystemExit("Invalid social-profiles.json")
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    youtube_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    checked = [verify_profile(session, item, youtube_key) for item in profiles if isinstance(item, dict)]
    checked.sort(key=lambda x: (str(x.get("platform")), str(x.get("entity_name")), str(x.get("identifier"))))
    events = filter_events(checked)
    write_outputs(checked, events)
    print(f"Social identity verification: {len(checked)} discovered, {len(verified_keys(checked))} verified, {len(events)} eligible events")


if __name__ == "__main__":
    main()
