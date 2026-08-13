#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from html.parser import HTMLParser

import requests

import backfill_structured_missing_candidates as base
from common import ROOT, parse_markdown


def fetch_utf8(url: str) -> tuple[str, str]:
    response = requests.get(
        url,
        timeout=45,
        headers={"User-Agent": base.USER_AGENT, "Accept-Language": "fr"},
    )
    response.raise_for_status()
    expected_origin = url.split("/", 3)[0] + "//" + url.split("/", 3)[2]
    if not response.url.startswith(expected_origin):
        raise RuntimeError(f"unexpected redirect: {response.url}")
    text = response.content.decode("utf-8", errors="strict")
    if len(text) < 500:
        raise RuntimeError(f"source too short: {url}")
    return text, hashlib.sha256(response.content).hexdigest()


# These campaign sites publish UTF-8. Force raw-byte decoding instead of relying
# on requests' legacy encoding guess, which can turn French accents into mojibake.
base.fetch_html = fetch_utf8


class VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {"script", "style", "noscript"}:
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag.lower() in {"script", "style", "noscript"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data):
        if not self.skip_depth and data.strip():
            self.parts.append(data)


def import_manolo() -> dict:
    url = "https://trajectoire2027.fr/programme.html"
    html, source_hash = base.fetch_html(url)
    parser = VisibleTextParser()
    parser.feed(html)
    parser.close()
    visible = base.compact(" ".join(parser.parts))
    folded_visible = base.fold(visible)
    specs = [
        ("Réunir un collège de constitutionnalistes pour rédiger les modalités de convocation de l’assemblée constituante", "collège de constitutionnalistes"),
        ("Soumettre par référendum, via l’article 11, les modalités de convocation de l’assemblée constituante", "article 11"),
        ("Convoquer une assemblée constituante composée d’un échantillon représentatif des Français", "échantillon représentatif des Français"),
        ("Soumettre la nouvelle Constitution rédigée par l’assemblée constituante à un référendum final", "nouvelle Constitution"),
        ("Quitter la présidence de la République à l’issue du processus constituant, quel que soit le résultat du référendum final", "quittons la présidence"),
        ("Organiser de nouvelles élections législatives pendant la période de rédaction de la Constitution", "nouvelles élections législatives"),
        ("Nommer Premier ministre le président du parti arrivé en tête des nouvelles élections législatives", "parti arrivé en tête"),
    ]
    rows = []
    for statement, proof in specs:
        if base.fold(proof) not in folded_visible:
            raise RuntimeError(f"Manolo primary-source proof missing: {proof}")
        rows.append(("Programme", statement))
    doc_id = base.write_source_document(
        "manolo-mlekuz", "Manolo Mlekuz", url, source_hash,
        ["institutions-democratie"], len(rows)
    )
    counts = base.write_proposals("manolo-mlekuz", url, source_hash, doc_id, rows)
    if counts["created"] < 7:
        raise RuntimeError(f"Manolo import created only {counts['created']} proposals")
    return {"actor_id": "manolo-mlekuz", "source_url": url, "structured_measures": len(rows), **counts}


def repair_temporal_metadata() -> int:
    repaired = 0
    root = ROOT / "proposals" / "structured"
    if not root.exists():
        return repaired
    for path in root.rglob("*.md"):
        meta, body = parse_markdown(path)
        if meta.get("date_basis") != "capture_fallback" or meta.get("captured_at"):
            continue
        meta["captured_at"] = f"{base.SNAPSHOT}T12:00:00+00:00"
        base.write_md(path, meta, body)
        repaired += 1
    return repaired


def main() -> int:
    base.ensure_registry_entries()
    results = [base.import_branco(), import_manolo()]
    repaired = repair_temporal_metadata()
    report = {
        "generated_at": f"{base.SNAPSHOT}T12:00:00+00:00",
        "verification_scope": "statement_attribution_not_feasibility",
        "method": "direct_primary_campaign_structured_measure_parser",
        "temporal_records_repaired": repaired,
        "results": results,
    }
    out = ROOT / "research" / "veille" / "backfill" / "2026-08-13-structured-missing-candidates.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
