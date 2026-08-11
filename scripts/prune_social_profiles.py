#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from common import ROOT


def parse_instant(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def partition_profiles(
    records: list[dict[str, Any]],
    stale_days: int,
    reference: datetime | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    now = reference or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max(1, stale_days))
    active: list[dict[str, Any]] = []
    stale: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        confirmed = parse_instant(record.get("last_confirmed_at"))
        if confirmed and confirmed >= cutoff:
            active.append(record)
            continue
        copy = dict(record)
        copy["collection_state"] = "stale_not_confirmed_on_official_site"
        copy["source_tier"] = "tier_4_discovery_only"
        copy["stale_since"] = now.replace(microsecond=0).isoformat()
        stale.append(copy)
    return active, stale


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stale-days", type=int, default=7)
    args = parser.parse_args()

    base = ROOT / "research" / "veille"
    path = base / "social-profiles.json"
    if not path.exists():
        print("No social profile snapshot to prune")
        return
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise SystemExit("Invalid social-profiles.json")

    active, stale = partition_profiles(records, args.stale_days)
    path.write_text(json.dumps(active, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (base / "social-profiles-stale.json").write_text(
        json.dumps(stale, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Social profile freshness: {len(active)} active, {len(stale)} stale")


if __name__ == "__main__":
    main()
