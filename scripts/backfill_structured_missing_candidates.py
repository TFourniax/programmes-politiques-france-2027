#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import requests
import yaml

from common import ROOT, parse_markdown

SNAPSHOT = "2026-08-13"
USER_AGENT = "politique2027-structured-primary-backfill/1.0"
TOPICS = {
    "pouvoir-achat-travail", "retraites", "fiscalite-redistribution", "immigration-integration",
    "europe-souverainete", "ecologie-energie", "institutions-democratie", "services-publics",
    "securite-justice", "economie-finances",
}

CANDIDATES = [
    {
        "id": "juan-branco", "name": "Juan Branco", "current_status": "declared_presidential",
        "status_as_of": SNAPSHOT, "status_confidence": "high", "official_candidate": False,
        "primary_party_id": None, "declared_at": None, "source_url": "https://ruches.org/",
        "source_tier": "tier_1_primary_official",
        "status_note": "Le site Branco 2027 des Ruches présente explicitement Juan Branco comme candidat à la présidentielle 2027 et relie sa candidature au projet La Voie."
    },
    {
        "id": "manolo-mlekuz", "name": "Manolo Mlekuz", "current_status": "declared_presidential",
        "status_as_of": SNAPSHOT, "status_confidence": "high", "official_candidate": False,
        "primary_party_id": None, "declared_at": None, "source_url": "https://trajectoire2027.fr/qui-sommes-nous.html",
        "source_tier": "tier_1_primary_official",
        "status_note": "Trajectoire présente explicitement Manolo Mlekuz comme candidat à l’élection présidentielle et publie son programme de transition constitutionnelle."
    },
]

SOURCES = [
    {"id": "src-juan-branco-2027", "url": "https://ruches.org/", "tier": "tier_1_primary_official", "owner": "Juan Branco"},
    {"id": "src-juan-branco-projet", "url": "https://ruches.org/le-projet", "tier": "tier_1_primary_official", "owner": "Juan Branco"},
    {"id": "src-manolo-mlekuz-2027", "url": "https://trajectoire2027.fr/qui-sommes-nous.html", "tier": "tier_1_primary_official", "owner": "Manolo Mlekuz"},
    {"id": "src-manolo-mlekuz-programme", "url": "https://trajectoire2027.fr/programme.html", "tier": "tier_1_primary_official", "owner": "Manolo Mlekuz"},
]

KEYWORDS = {
    "retraites": ("retraite", "pension", "âge de départ", "age de depart"),
    "immigration-integration": ("immigration", "immigré", "immigre", "étranger", "etranger", "asile", "visa", "nationalité", "nationalite", "naturalisation", "séjour", "sejour", "clandestin", "frontière", "frontiere"),
    "fiscalite-redistribution": ("impôt", "impot", "taxe", "fiscal", "cotisation", "tva", "héritage", "heritage", "succession", "patrimoine", "prélèvement", "prelevement"),
    "pouvoir-achat-travail": ("salaire", "smic", "travail", "emploi", "chômage", "chomage", "congé", "conge", "temps de travail", "pouvoir d’achat", "pouvoir d'achat"),
    "securite-justice": ("justice", "tribunal", "magistrat", "procureur", "police", "gendarmer", "prison", "peine", "délinqu", "delinqu", "narcotrafic", "sécurité", "securite"),
    "ecologie-energie": ("écolog", "ecolog", "climat", "carbone", "énergie", "energie", "nucléaire", "nucleaire", "renouvelable", "biodivers", "agriculture", "agriculteur", "pêche", "peche", "eau", "logement"),
    "europe-souverainete": ("union européenne", "union europeenne", "euro", "otan", "diplom", "défense", "defense", "armée", "armee", "souveraineté", "souverainete", "international", "douan"),
    "services-publics": ("santé", "sante", "hôpital", "hopital", "médec", "medec", "école", "ecole", "instruction", "universit", "enseign", "recherche", "handicap", "enfance", "culture", "service public"),
    "institutions-democratie": ("référendum", "referendum", "constitution", "parlement", "sénat", "senat", "assemblée", "assemblee", "président", "president", "scrutin", "élection", "election", "mandat", "démocrat", "democrat", "ministre", "préfect", "prefect", "commune"),
    "economie-finances": ("économie", "economie", "entreprise", "industrie", "banque", "finance", "budget", "dette", "monnaie", "commerce", "marché", "marche", "production", "infrastructure", "télécom", "telecom"),
}

SECTION_DEFAULTS = {
    "justice": "securite-justice", "intérieur": "securite-justice", "interieur": "securite-justice",
    "extérieur": "europe-souverainete", "exterieur": "europe-souverainete", "défense": "europe-souverainete", "defense": "europe-souverainete",
    "économie": "economie-finances", "economie": "economie-finances", "numérique": "economie-finances", "numerique": "economie-finances",
    "instruction": "services-publics", "santé": "services-publics", "sante": "services-publics", "handicap": "services-publics",
    "protection de l’enfance": "services-publics", "protection de l'enfance": "services-publics", "arts": "services-publics",
    "agriculture": "ecologie-energie", "énergie": "ecologie-energie", "energie": "ecologie-energie", "écologie": "ecologie-energie", "ecologie": "ecologie-energie",
    "europe": "europe-souverainete", "souveraineté": "europe-souverainete", "souverainete": "europe-souverainete",
    "démocratie": "institutions-democratie", "democratie": "institutions-democratie", "gouvernance": "institutions-democratie",
    "république": "institutions-democratie", "republique": "institutions-democratie", "géographie des pouvoirs": "institutions-democratie", "geographie des pouvoirs": "institutions-democratie",
    "décisions": "institutions-democratie", "decisions": "institutions-democratie", "société": "institutions-democratie", "societe": "institutions-democratie",
}


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def fold(value: Any) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", str(value or "")) if not unicodedata.combining(c)).lower()


def write_md(path: Path, meta: dict[str, Any], body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    front = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=120).strip()
    path.write_text(f"---\n{front}\n---\n\n{body.strip()}\n", encoding="utf-8")


def fetch_html(url: str) -> tuple[str, str]:
    response = requests.get(url, timeout=45, headers={"User-Agent": USER_AGENT, "Accept-Language": "fr"})
    response.raise_for_status()
    if not response.url.startswith(url.split("/", 3)[0] + "//" + url.split("/", 3)[2]):
        raise RuntimeError(f"unexpected redirect: {response.url}")
    text = response.text
    if len(text) < 500:
        raise RuntimeError(f"source too short: {url}")
    return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


class BulletParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.heading_tag = None
        self.heading_parts: list[str] = []
        self.section = ""
        self.pending_bullet = False
        self.pending_parts: list[str] = []
        self.rows: list[tuple[str, str]] = []

    def flush(self):
        text = compact(" ".join(self.pending_parts)).lstrip("◆").strip()
        if text and len(text) >= 3:
            self.rows.append((self.section, text))
        self.pending_parts = []
        self.pending_bullet = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {"h2", "h3"}:
            self.flush()
            self.heading_tag = tag.lower()
            self.heading_parts = []

    def handle_endtag(self, tag):
        if self.heading_tag == tag.lower():
            heading = compact(" ".join(self.heading_parts))
            if heading:
                self.section = heading
            self.heading_tag = None
            self.heading_parts = []

    def handle_data(self, data):
        text = compact(data)
        if not text:
            return
        if self.heading_tag:
            self.heading_parts.append(text)
            return
        if "◆" in text:
            parts = text.split("◆")
            if self.pending_bullet:
                self.pending_parts.append(parts[0])
                self.flush()
            for index, part in enumerate(parts[1:]):
                if index > 0:
                    self.flush()
                self.pending_bullet = True
                if compact(part):
                    self.pending_parts = [compact(part)]
            return
        if self.pending_bullet:
            # The measure label is normally one data node. Permit nested spans, but
            # stop before swallowing prose paragraphs that follow a short label.
            if sum(len(x) for x in self.pending_parts) < 420:
                self.pending_parts.append(text)

    def close(self):
        super().close()
        self.flush()


def parse_branco_measures(html: str) -> list[tuple[str, str]]:
    parser = BulletParser()
    parser.feed(html)
    parser.close()
    unique = []
    seen = set()
    for section, text in parser.rows:
        normalized = fold(text)
        if normalized in seen:
            continue
        if text.lower().startswith(("déduction fiscale", "paiement sécurisé", "transparence totale")):
            continue
        seen.add(normalized)
        unique.append((section, text))
    if not 800 <= len(unique) <= 900:
        raise RuntimeError(f"unexpected Branco structured-measure count: {len(unique)}")
    return unique


def topic_for(section: str, statement: str) -> str:
    haystack = fold(statement)
    scores = {topic: sum(1 for keyword in words if fold(keyword) in haystack) for topic, words in KEYWORDS.items()}
    best = max(scores, key=scores.get)
    if scores[best] > 0:
        return best
    section_folded = fold(section)
    for label, topic in SECTION_DEFAULTS.items():
        if fold(label) in section_folded:
            return topic
    return "institutions-democratie"


def evidence_quote(statement: str) -> str:
    words = statement.split()
    return " ".join(words[:18])


def ensure_registry_entries() -> None:
    entities_path = ROOT / "data" / "entities.json"
    entities = json.loads(entities_path.read_text(encoding="utf-8"))
    existing = {row.get("id") for row in entities.get("candidates", [])}
    for row in CANDIDATES:
        if row["id"] not in existing:
            entities.setdefault("candidates", []).append(dict(row))
    entities["snapshot_date"] = SNAPSHOT
    entities_path.write_text(json.dumps(entities, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    candidates_path = ROOT / "registries" / "candidates.yaml"
    candidate_registry = yaml.safe_load(candidates_path.read_text(encoding="utf-8")) or {}
    existing = {row.get("id") for row in candidate_registry.get("candidates", [])}
    for row in CANDIDATES:
        if row["id"] not in existing:
            candidate_registry.setdefault("candidates", []).append(dict(row))
    candidate_registry["snapshot_date"] = SNAPSHOT
    candidates_path.write_text(yaml.safe_dump(candidate_registry, allow_unicode=True, sort_keys=False, width=120), encoding="utf-8")

    sources_path = ROOT / "registries" / "sources.yaml"
    source_registry = yaml.safe_load(sources_path.read_text(encoding="utf-8")) or {}
    existing = {row.get("id") for row in source_registry.get("sources", [])}
    for row in SOURCES:
        if row["id"] not in existing:
            source_registry.setdefault("sources", []).append(dict(row))
    source_registry["snapshot_date"] = SNAPSHOT
    sources_path.write_text(yaml.safe_dump(source_registry, allow_unicode=True, sort_keys=False, width=140), encoding="utf-8")


def existing_actor_texts(actor_id: str) -> set[str]:
    out = set()
    for path in (ROOT / "proposals").rglob("*.md"):
        try:
            meta, body = parse_markdown(path)
        except Exception:
            continue
        if meta.get("entity_id") != actor_id or str(meta.get("proposal_status") or "current") != "current":
            continue
        out.add(fold(meta.get("title") or ""))
        first = body.split("\n", 1)[0].lstrip("# ").strip()
        if first:
            out.add(fold(first))
    return out


def write_source_document(actor_id: str, actor_name: str, url: str, source_hash: str, topics: list[str], count: int) -> str:
    doc_id = f"structured-{actor_id}-2027-{source_hash[:12]}"
    path = ROOT / "corpus" / "2027" / "structured" / "candidates" / actor_id / f"{SNAPSHOT}-{source_hash[:12]}.md"
    meta = {
        "document_id": doc_id, "title": f"Programme présidentiel 2027 — {actor_name}",
        "entity_id": actor_id, "entity_type": "candidate", "document_type": "official_presidential_programme",
        "document_status": "current", "election_scope": "presidential_2027_or_current_party_platform",
        "source_url": url, "source_tier": "tier_1_primary_official", "published_at": SNAPSHOT,
        "date_basis": "capture_fallback", "captured_at": f"{SNAPSHOT}T12:00:00+00:00",
        "rights_status": "quotation_only", "verification_state": "verified",
        "verification_scope": "statement_attribution_not_feasibility",
        "verification_method": "direct_primary_campaign_structured_measure_parser",
        "evidence_sha256": source_hash, "source_complete": True,
        "generated_by": "scripts/backfill_structured_missing_candidates.py", "topics": sorted(set(topics)),
    }
    body = (
        f"# Programme présidentiel 2027 — {actor_name}\n\n"
        f"Source primaire de campagne explicitement rattachée à la présidentielle 2027. "
        f"Le parseur a identifié **{count} mesures structurées** dans la source officielle. "
        "Les propositions atomiques sont conservées séparément avec une courte preuve textuelle ; "
        "la vérification porte sur l’attribution, pas sur la faisabilité."
    )
    write_md(path, meta, body)
    return doc_id


def write_proposals(actor_id: str, source_url: str, source_hash: str, doc_id: str, rows: list[tuple[str, str]]) -> dict[str, int]:
    existing = existing_actor_texts(actor_id)
    counts = {topic: 0 for topic in TOPICS}
    created = 0
    skipped = 0
    for section, statement in rows:
        normalized = fold(statement)
        if normalized in existing:
            skipped += 1
            continue
        topic = topic_for(section, statement)
        digest = hashlib.sha256(f"{actor_id}|{topic}|{normalized}".encode("utf-8")).hexdigest()
        proposal_id = f"structured-{actor_id}-{topic}-{digest[:12]}"
        meta = {
            "proposal_id": proposal_id, "title": statement[:160], "entity_id": actor_id, "topic": topic,
            "certainty": "explicit", "proposal_status": "current", "source_document_ids": [doc_id],
            "source_url": source_url, "source_tier": "tier_1_primary_official", "first_documented_at": SNAPSHOT,
            "source_published_at": SNAPSHOT, "date_basis": "capture_fallback",
            "verification_state": "verified", "verification_scope": "statement_attribution_not_feasibility",
            "verification_method": "direct_primary_campaign_structured_measure_parser",
            "evidence_sha256": source_hash, "generated_by": "scripts/backfill_structured_missing_candidates.py",
        }
        quote = evidence_quote(statement)
        body = (
            f"# {statement}\n\n"
            f"Cette mesure est publiée dans le programme présidentiel 2027 de `{actor_id}`.\n\n"
            f"## Attribution et preuve\n\nExtrait de preuve : « {quote} »\n\n"
            "La présence de cette entrée établit l’attribution documentaire de la mesure ; elle ne juge pas sa faisabilité."
        )
        path = ROOT / "proposals" / "structured" / topic / f"{proposal_id}.md"
        write_md(path, meta, body)
        existing.add(normalized)
        counts[topic] += 1
        created += 1
    counts["created"] = created
    counts["skipped_existing"] = skipped
    return counts


def import_branco() -> dict[str, Any]:
    url = "https://ruches.org/le-projet"
    html, source_hash = fetch_html(url)
    rows = parse_branco_measures(html)
    topics = [topic_for(section, statement) for section, statement in rows]
    doc_id = write_source_document("juan-branco", "Juan Branco", url, source_hash, topics, len(rows))
    counts = write_proposals("juan-branco", url, source_hash, doc_id, rows)
    if counts["created"] < 800:
        raise RuntimeError(f"Branco import created only {counts['created']} proposals")
    return {"actor_id": "juan-branco", "source_url": url, "structured_measures": len(rows), **counts}


def import_manolo() -> dict[str, Any]:
    url = "https://trajectoire2027.fr/programme.html"
    html, source_hash = fetch_html(url)
    visible = compact(re.sub(r"<[^>]+>", " ", html))
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
    folded_visible = fold(visible)
    for statement, proof in specs:
        if fold(proof) not in folded_visible:
            raise RuntimeError(f"Manolo primary-source proof missing: {proof}")
        rows.append(("Programme", statement))
    doc_id = write_source_document("manolo-mlekuz", "Manolo Mlekuz", url, source_hash, ["institutions-democratie"], len(rows))
    counts = write_proposals("manolo-mlekuz", url, source_hash, doc_id, rows)
    if counts["created"] < 7:
        raise RuntimeError(f"Manolo import created only {counts['created']} proposals")
    return {"actor_id": "manolo-mlekuz", "source_url": url, "structured_measures": len(rows), **counts}


def main() -> int:
    ensure_registry_entries()
    results = [import_branco(), import_manolo()]
    report = {
        "generated_at": f"{SNAPSHOT}T12:00:00+00:00",
        "verification_scope": "statement_attribution_not_feasibility",
        "method": "direct_primary_campaign_structured_measure_parser",
        "results": results,
    }
    out = ROOT / "research" / "veille" / "backfill" / "2026-08-13-structured-missing-candidates.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
