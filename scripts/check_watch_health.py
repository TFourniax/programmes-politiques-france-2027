#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from common import ROOT


def parse_instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-age-hours", type=float, default=10.0)
    parser.add_argument("--max-gemini-outage-hours", type=float, default=24.0)
    args = parser.parse_args()

    path = ROOT / "research" / "veille" / "health.json"
    if not path.exists():
        raise SystemExit("WATCH_HEALTH_FAILURE: health.json is missing")
    try:
        health = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"WATCH_HEALTH_FAILURE: invalid health.json: {exc}") from exc

    now = datetime.now(timezone.utc)
    collection = parse_instant(health.get("last_collection_success_at"))
    age_hours = (now - collection).total_seconds() / 3600
    failures = []
    if age_hours > args.max_age_hours:
        failures.append(f"last successful collection is {age_hours:.1f}h old")

    if health.get("gemini_available") is False and health.get("gemini_unavailable_since"):
        since = parse_instant(health["gemini_unavailable_since"])
        outage_hours = (now - since).total_seconds() / 3600
        if outage_hours > args.max_gemini_outage_hours:
            failures.append(f"Gemini promotion has been unavailable for {outage_hours:.1f}h")

    if failures:
        raise SystemExit("WATCH_HEALTH_FAILURE: " + "; ".join(failures))

    print(
        "WATCH_HEALTH_OK: "
        f"collection_age={age_hours:.1f}h, status={health.get('status')}, "
        f"pending={health.get('pending_work', 0)}, gemini={health.get('gemini_available')}"
    )


if __name__ == "__main__":
    main()
