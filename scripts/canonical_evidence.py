from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import yaml

from common import ROOT, markdown_files, parse_markdown


class FlowListDumper(yaml.SafeDumper):
    pass


def _flow_list(dumper, data):
    return dumper.represent_sequence("tag:yaml.org,2002:seq", data, flow_style=True)


FlowListDumper.add_representer(list, _flow_list)


def compact(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def fold(value: Any) -> str:
    import unicodedata
    return "".join(
        char for char in unicodedata.normalize("NFKD", str(value or ""))
        if not unicodedata.combining(char)
    ).lower()


def write_md(path: Path, meta: dict[str, Any], body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    front = yaml.dump(meta, Dumper=FlowListDumper, allow_unicode=True, sort_keys=False, width=120).strip()
    path.write_text(f"---\n{front}\n---\n\n{body.strip()}\n", encoding="utf-8")


def proposal_records(root: Path | None = None) -> dict[str, tuple[Path, dict[str, Any], str]]:
    base = (root or ROOT).resolve()
    out: dict[str, tuple[Path, dict[str, Any], str]] = {}
    proposals_root = base / "proposals"
    if not proposals_root.exists():
        return out
    for path in sorted(proposals_root.rglob("*.md")):
        try:
            meta, body = parse_markdown(path)
        except Exception:
            continue
        proposal_id = str(meta.get("proposal_id") or "").strip()
        if proposal_id:
            out[proposal_id] = (path, meta, body)
    return out


def claim_fingerprint(claim: dict[str, Any]) -> str:
    payload = f"{claim.get('actor_id')}|{claim.get('topic')}|{fold(claim.get('statement'))}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def valid_target(claim: dict[str, Any], proposal_id: str | None, records: dict[str, tuple[Path, dict[str, Any], str]]) -> str | None:
    target = str(proposal_id or "").strip()
    if not target or target not in records:
        return None
    _, meta, _ = records[target]
    if str(meta.get("entity_id") or "") != str(claim.get("actor_id") or ""):
        return None
    if str(meta.get("topic") or "") != str(claim.get("topic") or ""):
        return None
    if str(meta.get("proposal_status") or "current") not in {"current", "amended", "unknown"}:
        return None
    return target


def resolve_target(
    claim: dict[str, Any],
    verdict: dict[str, Any],
    state: dict[str, Any],
    records: dict[str, tuple[Path, dict[str, Any], str]],
) -> str | None:
    target = valid_target(claim, verdict.get("related_proposal_id"), records)
    if target:
        return target
    fingerprint = claim_fingerprint(claim)
    previous = (state.get("claim_fingerprints") or {}).get(fingerprint) or {}
    return valid_target(claim, previous.get("proposal_id"), records)


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []


def merge_provenance(
    proposal_id: str,
    claim: dict[str, Any],
    document_id: str,
    source_url: str,
    source_sha256: str,
    confirmed_at: str,
    root: Path | None = None,
) -> bool:
    records = proposal_records(root)
    target = valid_target(claim, proposal_id, records)
    if not target:
        return False
    path, meta, body = records[target]

    source_ids = _as_list(meta.get("source_document_ids") or meta.get("source_document_id"))
    source_urls = _as_list(meta.get("source_urls"))
    if meta.get("source_url"):
        source_urls.insert(0, str(meta["source_url"]))
    hashes = _as_list(meta.get("evidence_sha256s"))
    if meta.get("evidence_sha256"):
        hashes.insert(0, str(meta["evidence_sha256"]))

    changed = False
    if document_id and document_id not in source_ids:
        source_ids.append(document_id)
        changed = True
    if source_url and source_url not in source_urls:
        source_urls.append(source_url)
        changed = True
    if source_sha256 and source_sha256 not in hashes:
        hashes.append(source_sha256)
        changed = True
    if not changed:
        return False

    updated = dict(meta)
    updated.pop("source_document_id", None)
    updated["source_document_ids"] = source_ids
    updated["source_urls"] = list(dict.fromkeys(source_urls))
    updated["evidence_sha256s"] = list(dict.fromkeys(hashes))
    updated["confirmation_count"] = len(source_ids)
    updated["last_confirmed_at"] = confirmed_at
    updated["verification_state"] = "verified"
    write_md(path, updated, body)
    return True


def ensure_support_document(
    *,
    source: dict[str, Any],
    owner_id: str,
    owner_type: str,
    owner_name: str,
    published_at: str,
    date_basis: str,
    document_type: str,
    claims: list[dict[str, Any]],
    root: Path | None = None,
) -> tuple[str, str, bool]:
    base = (root or ROOT).resolve()
    source_hash = hashlib.sha256(f"{source['url']}|{source['sha256']}".encode("utf-8")).hexdigest()[:12]
    document_id = f"auto-{owner_id}-{published_at}-{source_hash}"
    path = base / "corpus" / "2027" / "auto" / f"{owner_type}s" / owner_id / f"{published_at}-{source_hash}.md"

    existing_meta: dict[str, Any] = {}
    existing_body = ""
    if path.exists():
        existing_meta, existing_body = parse_markdown(path)
        document_id = str(existing_meta.get("document_id") or document_id)

    topics = sorted(set(_as_list(existing_meta.get("topics"))) | {str(item.get("topic")) for item in claims if item.get("topic")})
    meta = dict(existing_meta) if existing_meta else {
        "document_id": document_id,
        "title": source.get("title") or f"Source officielle — {owner_name} — {published_at}",
        "entity_id": owner_id,
        "entity_type": owner_type,
        "document_type": document_type,
        "document_status": "current",
        "election_scope": "presidential_2027_or_current_party_platform",
        "source_url": source["url"],
        "source_tier": "tier_1_primary_official",
        "published_at": published_at,
        "date_basis": date_basis,
        "captured_at": source.get("captured_at") or confirmed_iso(source),
        "rights_status": "quotation_only",
        "verification_state": "verified",
        "verification_method": "primary_source_exact_quote_plus_independent_gemini_verifier_plus_canonical_duplicate_guard",
        "evidence_sha256": source["sha256"],
        "source_complete": not bool(source.get("text_truncated")),
        "generated_by": "scripts/auto_promote.py",
        "topics": topics,
    }
    meta["topics"] = topics
    meta["verification_state"] = "verified"

    statements = []
    for claim in claims:
        statement = compact(claim.get("statement"))
        quote = compact(claim.get("evidence_quote"))
        if statement and quote:
            statements.append((statement, quote))

    changed = not path.exists()
    if existing_body:
        body = existing_body.rstrip()
        missing = [(statement, quote) for statement, quote in statements if statement not in body or quote not in body]
        if missing:
            body += "\n\n## Confirmations de claims canoniques\n"
            for statement, quote in missing:
                body += f"\n- {statement}\n  - Extrait de preuve : « {quote} »\n"
            changed = True
    else:
        lines = [
            f"# {meta['title']}",
            "",
            f"Source primaire officielle attribuée à **{owner_name}**. Cette fiche conserve les preuves vérifiées rattachées aux claims canoniques sans dupliquer les propositions.",
            "",
            "## Éléments programmatiques vérifiés",
        ]
        for statement, quote in statements:
            lines += ["", f"- {statement}", f"  - Extrait de preuve : « {quote} »"]
        lines += [
            "",
            "## Traçabilité",
            "",
            "La source confirme un ou plusieurs claims déjà présents dans le canon. Elle enrichit leur provenance sans créer de proposition dupliquée.",
        ]
        body = "\n".join(lines)

    if changed:
        write_md(path, meta, body)
    return document_id, str(path.relative_to(base)), changed


def confirmed_iso(source: dict[str, Any]) -> str:
    from datetime import datetime, timezone
    value = str(source.get("captured_at") or "").strip()
    return value or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
