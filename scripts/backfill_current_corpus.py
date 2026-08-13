#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import auto_promote
import auto_promote_canonical_runner as canonical_runner
import auto_promote_runner as promotion_runner
import daily_watch
from canonical_queue import CanonicalQueue
from common import ROOT, load_yaml, parse_markdown

BACKFILL_ID = "2026-08-13-complete-current-corpus"
FIXED_OBSERVED_AT = "2026-08-13T10:00:00+00:00"
TERMINAL = set(auto_promote.TERMINAL_SOURCE_STATES)


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def current_proposal_counts() -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    root = ROOT / "proposals"
    if not root.exists():
        return {}
    for path in root.rglob("*.md"):
        try:
            meta, _ = parse_markdown(path)
        except Exception:
            continue
        if str(meta.get("proposal_status") or "current") != "current":
            continue
        entity_id = str(meta.get("entity_id") or "").strip()
        topic = str(meta.get("topic") or "").strip()
        if entity_id and topic:
            counts[entity_id][topic] += 1
    return {entity: dict(topics) for entity, topics in counts.items()}


def entity_labels() -> dict[str, str]:
    payload = json.loads((ROOT / "data" / "entities.json").read_text(encoding="utf-8"))
    labels = {}
    for group in ("candidates", "parties"):
        for item in payload.get(group, []):
            if item.get("id") and item.get("name"):
                labels[str(item["id"])] = str(item["name"])
    return labels


def registry_events() -> list[dict[str, Any]]:
    events = []
    for source in load_yaml("registries/sources.yaml").get("sources", []):
        if source.get("tier") != "tier_1_primary_official" or not source.get("url") or not source.get("owner"):
            continue
        events.append({
            "event_type": "official_new_url",
            "observed_at": FIXED_OBSERVED_AT,
            "owner": str(source["owner"]),
            "priority": "high",
            "published_at": None,
            "source_tier": "tier_1_primary_official",
            "title": None,
            "url": str(source["url"]),
            "verification_state": "needs_review",
            "provenance": "one_off_current_corpus_backfill_registry",
        })
    for party in load_yaml("registries/parties.yaml").get("parties", []):
        owner = str(party.get("name") or "").strip()
        if not owner:
            continue
        for field in ("programme_url", "official_url"):
            url = str(party.get(field) or "").strip()
            if not url:
                continue
            events.append({
                "event_type": "official_new_url",
                "observed_at": FIXED_OBSERVED_AT,
                "owner": owner,
                "priority": "high",
                "published_at": None,
                "source_tier": "tier_1_primary_official",
                "title": None,
                "url": url,
                "verification_state": "needs_review",
                "provenance": "one_off_current_corpus_backfill_party_registry",
            })
    return events


def event_recency(event: dict[str, Any]) -> str:
    return str(event.get("published_at") or event.get("observed_at") or "")


def backfill_events() -> list[dict[str, Any]]:
    # Durable watch/sitemap/structured-source backlog plus every curated primary source.
    # Deduplicate by public URL and keep the richest/latest event so a source is not
    # needlessly paid for twice during the one-off drain.
    rows = list(promotion_runner.durable_load_events()) + registry_events()
    by_url: dict[str, dict[str, Any]] = {}
    for event in rows:
        url = str(event.get("url") or "").strip()
        if not url or not promotion_runner.current_cycle_event(event):
            continue
        previous = by_url.get(url)
        if previous is None:
            by_url[url] = event
            continue
        previous_richness = int(bool(previous.get("sha256"))) + int(bool(previous.get("fetch_url"))) + int(bool(previous.get("published_at")))
        current_richness = int(bool(event.get("sha256"))) + int(bool(event.get("fetch_url"))) + int(bool(event.get("published_at")))
        if (current_richness, event_recency(event)) > (previous_richness, event_recency(previous)):
            by_url[url] = event
    return list(by_url.values())


def pending_events() -> list[dict[str, Any]]:
    state = auto_promote.load_state()
    pending = []
    for event in backfill_events():
        previous = state["sources"].get(auto_promote.event_key(event)) or {}
        if previous.get("status") in TERMINAL:
            continue
        if not auto_promote.retry_due(previous):
            continue
        pending.append(event)
    pending.sort(key=auto_promote.priority, reverse=True)
    return pending


def aggressive_discovery() -> dict[str, Any]:
    config = copy.deepcopy(load_yaml("registries/watch.yaml"))
    discovery = config.setdefault("official_discovery", {})
    discovery["max_sitemaps_per_site"] = max(24, int(discovery.get("max_sitemaps_per_site", 8)))
    discovery["max_relevant_urls_per_site"] = max(320, int(discovery.get("max_relevant_urls_per_site", 80)))
    discovery["max_feeds_per_site"] = max(5, int(discovery.get("max_feeds_per_site", 2)))

    state_path = ROOT / "research" / "veille" / "state.json"
    state = daily_watch.load_state(state_path)
    errors: list[str] = []
    session = requests.Session()
    session.headers.update({"User-Agent": daily_watch.USER_AGENT, "Accept-Language": "fr,en;q=0.7"})
    targets = daily_watch.collect_official_targets()

    source_events, fetched = daily_watch.monitor_sources(session, state, targets, errors)
    sitemap_events = daily_watch.discover_sitemap_urls(session, state, targets, config, errors)
    feed_events = daily_watch.discover_official_feeds(session, state, targets, fetched, config)
    state["last_backfill_discovery_at"] = now()
    state["last_backfill_discovery_id"] = BACKFILL_ID
    daily_watch.save_json(state_path, state)

    return {
        "targets": len(targets),
        "source_events": len(source_events),
        "sitemap_events": len(sitemap_events),
        "feed_events": len(feed_events),
        "warnings": errors,
        "official_seen_urls": len(state.get("official_seen_urls") or {}),
    }


def run_helper(path: str) -> None:
    subprocess.run([sys.executable, str(ROOT / path)], cwd=ROOT, check=True)


def backfill_watch_config() -> dict[str, Any]:
    config = copy.deepcopy(load_yaml("registries/watch.yaml"))
    promotion = config.setdefault("auto_promotion", {})
    promotion.update({
        "enabled": True,
        "model": promotion.get("model") or "gemini-3.5-flash-lite",
        "max_source_chars": max(4_000_000, int(promotion.get("max_source_chars", 4_000_000))),
        "chunk_chars": 12000,
        "chunk_overlap_chars": 500,
        "max_chunks_per_source_per_run": 4,
        "max_claims_per_chunk": 10,
        "request_delay_seconds": 0.30,
    })
    return config


def install_backfill_promotion(config: dict[str, Any]) -> None:
    canonical_runner.install()
    original_load_yaml = auto_promote.load_yaml

    def load_yaml_override(path: str):
        if path == "registries/watch.yaml":
            return config
        return original_load_yaml(path)

    auto_promote.load_yaml = load_yaml_override
    auto_promote.gemini = promotion_runner.strict_gemini
    auto_promote.load_events = backfill_events
    auto_promote.fetch_source = promotion_runner.safe_fetch_source
    auto_promote.sanitize = promotion_runner.strict_sanitize


def run_promotion_round(max_sources: int) -> None:
    previous_argv = sys.argv[:]
    try:
        sys.argv = ["auto_promote.py", "--max-sources", str(max_sources)]
        auto_promote.main()
    finally:
        sys.argv = previous_argv


def promotion_state_summary() -> dict[str, int]:
    state = auto_promote.load_state()
    statuses = Counter(str(item.get("status") or "unknown") for item in state.get("sources", {}).values())
    return dict(sorted(statuses.items()))


def write_coverage_report(before: dict[str, dict[str, int]], discovery: dict[str, Any], rounds: list[dict[str, Any]]) -> Path:
    after = current_proposal_counts()
    labels = entity_labels()
    topics = sorted(auto_promote.TOPICS)
    entities = sorted(set(labels) | set(before) | set(after), key=lambda item: labels.get(item, item).lower())
    rows = []
    for entity_id in entities:
        before_topics = before.get(entity_id, {})
        after_topics = after.get(entity_id, {})
        before_total = sum(before_topics.values())
        after_total = sum(after_topics.values())
        covered = [topic for topic in topics if after_topics.get(topic, 0) > 0]
        not_documented = [topic for topic in topics if after_topics.get(topic, 0) == 0]
        rows.append({
            "entity_id": entity_id,
            "name": labels.get(entity_id, entity_id),
            "before": before_total,
            "after": after_total,
            "delta": after_total - before_total,
            "covered_topics": covered,
            "not_documented_topics": not_documented,
            "counts_by_topic": {topic: after_topics.get(topic, 0) for topic in topics},
        })

    payload = {
        "backfill_id": BACKFILL_ID,
        "generated_at": now(),
        "verification_scope": "statement_attribution_not_feasibility",
        "before_current_proposals": sum(sum(item.values()) for item in before.values()),
        "after_current_proposals": sum(sum(item.values()) for item in after.values()),
        "delta_current_proposals": sum(sum(item.values()) for item in after.values()) - sum(sum(item.values()) for item in before.values()),
        "discovery": discovery,
        "promotion_rounds": rounds,
        "promotion_state": promotion_state_summary(),
        "entities": rows,
        "notice": "A not_documented topic means only that no current verified claim was found in the corpus after this pass; it is never interpreted as absence of a political position.",
    }
    directory = ROOT / "research" / "veille" / "backfill"
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / f"{BACKFILL_ID}.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    leaders = sorted(rows, key=lambda row: (row["delta"], row["after"]), reverse=True)
    lines = [
        f"# Backfill complet du corpus courant — {BACKFILL_ID}",
        "",
        f"Généré à `{payload['generated_at']}`.",
        "",
        "La vérification porte sur l’attribution certaine d’une proposition/déclaration à l’acteur politique, pas sur sa faisabilité.",
        "",
        "## Résultat global",
        "",
        f"- propositions courantes avant : **{payload['before_current_proposals']}** ;",
        f"- propositions courantes après : **{payload['after_current_proposals']}** ;",
        f"- enrichissement net : **+{payload['delta_current_proposals']}** ;",
        f"- cibles officielles explorées : **{discovery['targets']}** ;",
        f"- URLs officielles connues après exploration : **{discovery['official_seen_urls']}**.",
        "",
        "## Couverture par acteur",
        "",
        "| Acteur | Claims courants | Ajoutés | Thèmes documentés | Thèmes non documentés |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in leaders:
        lines.append(f"| {row['name']} | {row['after']} | {row['delta']:+d} | {len(row['covered_topics'])}/10 | {len(row['not_documented_topics'])}/10 |")
    lines += [
        "",
        "> « Non documenté » signifie uniquement qu’aucun claim courant suffisamment vérifié n’a été trouvé pendant cette passe. Cela ne prouve jamais une absence de position.",
        "",
        "## Avertissements de collecte",
        "",
    ]
    if discovery["warnings"]:
        lines.extend(f"- {warning}" for warning in discovery["warnings"])
    else:
        lines.append("- Aucun avertissement technique pendant l’exploration agressive.")
    (directory / f"{BACKFILL_ID}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return json_path


def main() -> int:
    parser = argparse.ArgumentParser(description="One-off high-coverage current-cycle corpus backfill using production verification gates.")
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--max-sources-per-round", type=int, default=80)
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY", "").strip():
        raise SystemExit("GEMINI_API_KEY is required for verified canonical backfill")

    before = current_proposal_counts()
    queue = CanonicalQueue(ROOT)
    restored = queue.prepare()
    print(f"Pending canonical queue restored: {restored}")

    # Refresh structured/alternate official sources before broad sitemap discovery.
    run_helper("scripts/direct_feed_watch.py")
    run_helper("scripts/structured_primary_watch.py")
    discovery = aggressive_discovery()
    print(json.dumps({"backfill_discovery": discovery}, ensure_ascii=False))

    config = backfill_watch_config()
    install_backfill_promotion(config)
    rounds = []
    for index in range(1, max(1, args.rounds) + 1):
        before_pending = len(pending_events())
        if before_pending == 0:
            rounds.append({"round": index, "pending_before": 0, "pending_after": 0, "stopped": "drained"})
            break
        print(f"Backfill promotion round {index}: {before_pending} pending source(s)")
        run_promotion_round(args.max_sources_per_round)
        after_pending = len(pending_events())
        row = {"round": index, "pending_before": before_pending, "pending_after": after_pending}
        rounds.append(row)
        print(json.dumps(row))
        if after_pending >= before_pending:
            # No deterministic progress: avoid burning quota indefinitely on technical/ambiguous sources.
            row["stopped"] = "no_progress"
            break

    report = write_coverage_report(before, discovery, rounds)
    print(f"Coverage report: {report.relative_to(ROOT)}")
    print(json.dumps({"promotion_state": promotion_state_summary(), "pending": len(pending_events())}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
