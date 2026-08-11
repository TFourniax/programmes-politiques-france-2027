#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import auto_promote
from common import ROOT, markdown_files, parse_markdown


def canonical_proposal_ids() -> set[str]:
    out: set[str] = set()
    for path in markdown_files("proposals"):
        try:
            meta, _ = parse_markdown(path)
        except Exception:
            continue
        proposal_id = meta.get("proposal_id")
        if proposal_id:
            out.add(str(proposal_id))
    return out


def repair_state(state: dict[str, Any], proposal_ids: set[str]) -> tuple[dict[str, Any], dict[str, int]]:
    state = dict(state)
    fingerprints = dict(state.get("claim_fingerprints") or {})
    sources = dict(state.get("sources") or {})

    removed_fingerprints = 0
    for fingerprint, record in list(fingerprints.items()):
        proposal_id = str((record or {}).get("proposal_id") or "")
        source_url = str((record or {}).get("source_url") or "")
        if not proposal_id or proposal_id not in proposal_ids or auto_promote.explicit_old_election(source_url):
            fingerprints.pop(fingerprint, None)
            removed_fingerprints += 1

    historical_sources = 0
    for key, record in list(sources.items()):
        if not isinstance(record, dict):
            continue
        url = str(record.get("url") or "")
        if not auto_promote.explicit_old_election(url):
            continue
        if record.get("status") != "historical_skipped" or record.get("reason") != "explicit_old_election_context":
            updated = dict(record)
            updated["status"] = "historical_skipped"
            updated["reason"] = "explicit_old_election_context"
            sources[key] = updated
            historical_sources += 1

    state["version"] = max(int(state.get("version", 1)), 2)
    state["claim_fingerprints"] = fingerprints
    state["sources"] = sources
    return state, {
        "removed_fingerprints": removed_fingerprints,
        "historical_sources_reclassified": historical_sources,
    }


def main() -> None:
    path = ROOT / "research" / "veille" / "promotion-state.json"
    if not path.exists():
        print("Promotion state absent: nothing to repair")
        return
    state = json.loads(path.read_text(encoding="utf-8"))
    repaired, stats = repair_state(state, canonical_proposal_ids())
    if repaired != state:
        path.write_text(json.dumps(repaired, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        "Promotion state repair: "
        f"{stats['removed_fingerprints']} stale fingerprint(s), "
        f"{stats['historical_sources_reclassified']} historical source(s) reclassified"
    )


if __name__ == "__main__":
    main()
