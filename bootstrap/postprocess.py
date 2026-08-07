#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import yaml

ROOT = Path.cwd()

STATUS_FR = {
    'official_candidate': 'candidat officiel (liste du Conseil constitutionnel)',
    'declared_presidential': 'candidature déclarée à l’élection présidentielle',
    'party_designated': 'désigné par un parti pour l’élection présidentielle',
    'declared_primary': 'candidat déclaré à une primaire ou un processus de désignation',
    'declared_conditional': 'candidature déclarée sous condition',
    'exploratory': 'démarche exploratoire ou préparatoire',
    'potential': 'candidature potentielle, non déclarée',
    'withdrawn': 'candidature retirée ou abandonnée',
    'not_running': 'a déclaré ne pas être candidat',
    'deceased': 'décédé',
    'unknown': 'statut insuffisamment documenté',
}


def load_yaml(path: str):
    return yaml.safe_load((ROOT / path).read_text(encoding='utf-8')) or {}


def write_entity_pages() -> None:
    cand_data = load_yaml('registries/candidates.yaml')
    party_data = load_yaml('registries/parties.yaml')
    cand_dir = ROOT / 'entities/candidates'
    party_dir = ROOT / 'entities/parties'
    cand_dir.mkdir(parents=True, exist_ok=True)
    party_dir.mkdir(parents=True, exist_ok=True)
    for p in cand_dir.glob('*.md'):
        p.unlink()
    for p in party_dir.glob('*.md'):
        p.unlink()

    for c in cand_data.get('candidates', []):
        cid = c['id']
        name = c.get('name', cid)
        status = c.get('current_status', 'unknown')
        history = c.get('status_history') or []
        sources = []
        for item in history:
            url = item.get('source_url')
            if url and url not in sources:
                sources.append(url)
        affiliations = c.get('affiliation') or []
        declared = c.get('declared_at')
        lines = [
            '---', f'entity_id: {cid}', 'entity_type: candidate', f'name: {name}',
            f'current_status: {status}', f'status_as_of: {cand_data.get("snapshot_date")}',
            f'confidence: {c.get("confidence", "unverified")}',
            f'verification_state: {c.get("verification_state", "unverified")}',
            'affiliation:', *[f'  - {a}' for a in affiliations],
            f'declared_at: {declared if declared else "null"}', 'source_urls:',
            *([f'  - {u}' for u in sources] or ['  []']), '---', '', f'# {name}', '',
            '## Statut au dernier instantané', '',
            f'**{STATUS_FR.get(status, status)}** (`{status}`), état du corpus au **{cand_data.get("snapshot_date")}**.', ''
        ]
        if declared:
            lines += [f'Date de déclaration enregistrée dans le registre : **{declared}**.', '']
        if affiliations:
            lines += ['## Affiliation(s)', '', *[f'- `{a}`' for a in affiliations], '']
        lines += ['## Historique documenté', '']
        if history:
            for item in history:
                effective = item.get('effective_at') or item.get('from') or 'date non précisée'
                lines.append(f'- **{effective}** — `{item.get("status", "unknown")}`. {item.get("note", "")}'.rstrip())
                if item.get('source_url'):
                    lines.append(f'  - Source : {item["source_url"]}')
        else:
            lines.append('- Aucun changement de statut documenté dans le registre.')
        lines += ['', '## Limites', '', 'Cette fiche reflète le registre du projet. Elle ne transforme pas une candidature potentielle, une primaire ou une désignation partisane en candidature officielle. Le statut `official_candidate` est réservé à la liste du Conseil constitutionnel.', '']
        (cand_dir / f'{cid}.md').write_text('\n'.join(lines), encoding='utf-8')

    for p in party_data.get('parties', []):
        pid = p['id']
        name = p.get('name', pid)
        lines = [
            '---', f'entity_id: {pid}', 'entity_type: party', f'name: {name}',
            f'status_as_of: {party_data.get("snapshot_date")}',
            f'verification_state: {p.get("verification_state", "unverified")}',
            f'official_url: {p.get("official_url") or "null"}',
            f'programme_url: {p.get("programme_url") or "null"}', '---', '', f'# {name}', '',
            '## Références', ''
        ]
        if p.get('official_url'):
            lines.append(f'- Site officiel : {p["official_url"]}')
        if p.get('programme_url'):
            lines.append(f'- Programme / plateforme repérée : {p["programme_url"]}')
        if not p.get('official_url') and not p.get('programme_url'):
            lines.append('- Aucune URL de référence n’est encore enregistrée.')
        lines += ['', '## Statut documentaire', '', f'Verification du registre : `{p.get("verification_state", "unverified")}`.', '', '## Limites', '', 'Une plateforme de parti n’est jamais attribuée automatiquement à une personnalité candidate.', '']
        (party_dir / f'{pid}.md').write_text('\n'.join(lines), encoding='utf-8')


def write_rights_and_research() -> None:
    cand_data = load_yaml('registries/candidates.yaml')
    party_data = load_yaml('registries/parties.yaml')
    doc_data = load_yaml('registries/documents.yaml')
    rights = {'snapshot_date': cand_data.get('snapshot_date'), 'rights': []}
    for d in doc_data.get('documents', []):
        status = d.get('rights_status') or 'unknown'
        allowed = ['metadata', 'summary', 'short_quotes']
        if status in {'open_license', 'public_domain', 'permission_granted'}:
            allowed.append('full_reproduction')
        rights['rights'].append({
            'document_id': d.get('document_id'), 'rights_status': status,
            'rights_holder': None, 'evidence_url': d.get('source_url'),
            'retrieved_at': d.get('retrieved_at'), 'allowed_actions': allowed,
            'notes': 'Dérivé des métadonnées du document ; vérifier les mentions légales de la source avant toute republication intégrale.'
        })
    (ROOT / 'registries/rights.yaml').write_text(yaml.safe_dump(rights, allow_unicode=True, sort_keys=False), encoding='utf-8')

    research = ROOT / 'research'
    research.mkdir(exist_ok=True)
    by_candidate = {d.get('entity_id') for d in doc_data.get('documents', []) if d.get('entity_type') == 'candidate'}
    by_party = {d.get('entity_id') for d in doc_data.get('documents', []) if d.get('entity_type') == 'party'}
    missing_candidates = [c for c in cand_data.get('candidates', []) if c.get('id') not in by_candidate]
    missing_parties = [p for p in party_data.get('parties', []) if p.get('id') not in by_party]
    proposals = len(list((ROOT / 'proposals').rglob('*.md')))
    (research / '2026-08-deep-research-report.md').write_text(
        f'# Rapport de couverture — instantané {cand_data.get("snapshot_date")}\n\n'
        'Ce document décrit **l’état réel du corpus**, pas l’état de la campagne dans son ensemble.\n\n'
        f'- {len(cand_data.get("candidates", []))} personnalités suivies ;\n'
        f'- {len(party_data.get("parties", []))} partis / mouvements suivis ;\n'
        f'- {len(doc_data.get("documents", []))} documents intégrés ;\n'
        f'- {proposals} propositions atomiques ;\n'
        f'- {len(by_candidate)} personnalités avec au moins un document de corpus ;\n'
        f'- {len(by_party)} partis avec au moins un document de corpus.\n\n'
        'Le corpus est vivant et doit continuer à être enrichi jusqu’à l’élection. Une absence de document n’est jamais interprétée comme une absence de position.\n',
        encoding='utf-8'
    )
    missing = ['# Informations manquantes', '', f'Instantané : **{cand_data.get("snapshot_date")}**.', '', '## P1 — personnalités sans document de corpus', '']
    missing += [f'- `{c["id"]}` — {c.get("name", c["id"])} — statut `{c.get("current_status")}`' for c in missing_candidates]
    missing += ['', '## P1 — partis sans document de corpus', '']
    missing += [f'- `{p["id"]}` — {p.get("name", p["id"])}' for p in missing_parties]
    missing += ['', '## Règle', '', 'Une absence de document signifie **non documenté dans ce corpus**, jamais « absence de position ».', '']
    (research / 'missing-information.md').write_text('\n'.join(missing), encoding='utf-8')
    (research / 'position-changes-and-contradictions.md').write_text(
        f'# Évolutions et contradictions\n\nInstantané : **{cand_data.get("snapshot_date")}**.\n\nAucune contradiction politique n’est affirmée automatiquement. Les changements de statut sont conservés dans `registries/candidates.yaml` et les fiches `entities/candidates/`. Toute future contradiction entre propositions doit être documentée avec deux sources incompatibles et datées.\n', encoding='utf-8')
    counts = {}
    for d in doc_data.get('documents', []):
        key = d.get('rights_status') or 'unknown'
        counts[key] = counts.get(key, 0) + 1
    (research / 'rights-audit.md').write_text(
        '# Audit des droits\n\nInstantané : **%s**.\n\n%s\n\nLe registre détaillé se trouve dans `registries/rights.yaml`. En cas de doute, le projet conserve métadonnées, résumé original, courtes citations et lien plutôt que de reproduire intégralement le document.\n' %
        (cand_data.get('snapshot_date'), '\n'.join(f'- `{k}` : {v} document(s)' for k, v in sorted(counts.items()))), encoding='utf-8')
    (research / 'research-log.md').write_text(
        f'# Journal de recherche\n\n## {cand_data.get("snapshot_date")} — instantané initial\n\n- Registres consolidés : candidats, partis, documents et sources.\n- Corpus pilote intégré avec qualification séparée du statut de la personne et du document.\n- Propositions atomiques ajoutées lorsque la formulation disponible permet une extraction prudente.\n- Les lacunes sont conservées explicitement dans `missing-information.md`.\n', encoding='utf-8')


def patch_runtime() -> None:
    for name in ['lib/llm.js', '.env.example', 'docs/DEPLOYMENT.md', 'README.md']:
        path = ROOT / name
        if path.exists():
            text = path.read_text(encoding='utf-8').replace('gpt-5.6-luna', 'gpt-5.2')
            text = text.replace('**40 fragments** indexés pour la recherche.', '**102 fragments** indexés pour la recherche.')
            text = text.replace('generated/search-index.json', 'generated/search-index-*.json')
            path.write_text(text, encoding='utf-8')

    (ROOT / '.gitignore').write_text('__pycache__/\n.pytest_cache/\n*.pyc\nnode_modules/\n.next/\n.env\n.env.local\n.env.*.local\n.DS_Store\n', encoding='utf-8')
    (ROOT / '.github/workflows/webapp.yml').write_text("""name: Validate web app

on:
  push:
    branches: [main]
    paths:
      - 'app/**'
      - 'components/**'
      - 'lib/**'
      - 'generated/**'
      - 'package.json'
      - 'next.config.mjs'
      - '.github/workflows/webapp.yml'
  pull_request:
    paths:
      - 'app/**'
      - 'components/**'
      - 'lib/**'
      - 'generated/**'
      - 'package.json'
      - 'next.config.mjs'
      - '.github/workflows/webapp.yml'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm install
      - name: Build application
        env:
          LLM_API_KEY: build-only-placeholder
        run: npm run build
""", encoding='utf-8')

    build = ROOT / 'scripts/build_search_index.py'
    s = build.read_text(encoding='utf-8')
    needle = '    chunks = []\n    documents = 0\n    proposals = 0\n\n    for base, kind in ((CORPUS, "document"), (PROPOSALS, "proposal")):\n'
    replacement = '''    chunks = []
    documents = 0
    proposals = 0

    status_labels = {
        "official_candidate": "candidat officiel liste Conseil constitutionnel",
        "declared_presidential": "candidat candidature présidentielle déclarée candidats déclarés",
        "party_designated": "candidat désigné par un parti",
        "declared_primary": "candidat primaire processus de désignation",
        "declared_conditional": "candidature conditionnelle candidat sous condition",
        "exploratory": "candidature exploratoire préparation",
        "potential": "candidat potentiel candidature potentielle non déclarée",
        "withdrawn": "candidature retirée retrait",
        "not_running": "non candidat ne se présente pas",
        "deceased": "décédé",
        "unknown": "statut inconnu non vérifié",
    }

    candidate_snapshot = (yaml.safe_load((ROOT / "registries" / "candidates.yaml").read_text(encoding="utf-8")) or {}).get("snapshot_date")
    for item in candidates:
        entity_id = item.get("id")
        if not entity_id:
            continue
        name = item.get("name") or item.get("full_name") or entity_id
        status = item.get("current_status") or "unknown"
        history = item.get("status_history") or []
        source_url = next((entry.get("source_url") for entry in reversed(history) if entry.get("source_url")), None)
        declared_at = item.get("declared_at")
        affiliations = item.get("affiliation") or []
        text = (f"Candidat / personnalité suivie : {name}. Statut actuel dans le corpus au {candidate_snapshot}: {status}. "
                f"Qualification: {status_labels.get(status, status)}. Date de déclaration enregistrée: {declared_at or 'non précisée'}. "
                f"Affiliations enregistrées: {', '.join(affiliations) if affiliations else 'non précisées'}. "
                "Ce statut n'implique jamais le statut official_candidate tant que le Conseil constitutionnel n'a pas publié sa liste officielle.")
        chunks.append({"id": f"entities/candidates/{entity_id}.md#status", "kind": "entity_status", "path": f"entities/candidates/{entity_id}.md",
                       "title": name, "heading": "Statut au dernier instantané", "text": text, "entity_id": entity_id, "entity_label": name,
                       "entity_type": "candidate", "document_type": "candidate_status", "document_status": "current", "candidate_status_current": status,
                       "candidate_status_at_publication": None, "source_url": source_url, "source_tier": None, "published_at": declared_at or candidate_snapshot,
                       "verification_state": item.get("verification_state"), "certainty": item.get("confidence"),
                       "topics": ["candidat", "candidats", "candidature", "statut", status, status_labels.get(status, status)]})

    party_snapshot = (yaml.safe_load((ROOT / "registries" / "parties.yaml").read_text(encoding="utf-8")) or {}).get("snapshot_date")
    for item in parties:
        entity_id = item.get("id")
        if not entity_id:
            continue
        name = item.get("name") or entity_id
        text = (f"Parti ou mouvement suivi : {name}. État du registre au {party_snapshot}. Site officiel enregistré: {item.get('official_url') or 'non précisé'}. "
                f"Plateforme ou programme enregistré: {item.get('programme_url') or 'non précisé'}. Une plateforme de parti n'est pas automatiquement attribuée à un candidat.")
        chunks.append({"id": f"entities/parties/{entity_id}.md#profile", "kind": "entity_profile", "path": f"entities/parties/{entity_id}.md",
                       "title": name, "heading": "Profil du parti", "text": text, "entity_id": entity_id, "entity_label": name, "entity_type": "party",
                       "document_type": "party_profile", "document_status": "current", "candidate_status_current": None, "candidate_status_at_publication": None,
                       "source_url": item.get("official_url"), "source_tier": None, "published_at": party_snapshot, "verification_state": item.get("verification_state"),
                       "certainty": None, "topics": ["parti", "partis", "mouvement", "programme", "plateforme"]})

    for base, kind in ((CORPUS, "document"), (PROPOSALS, "proposal")):
'''
    if needle in s:
        s = s.replace(needle, replacement)
    old = '    (GENERATED / "search-index.json").write_text(json.dumps({"version": 1, "chunks": chunks}, ensure_ascii=False, indent=2), encoding="utf-8")\n    (GENERATED / "entities.json").write_text(json.dumps({"version": 1, "entities": entities}, ensure_ascii=False, indent=2), encoding="utf-8")\n'
    new = '''    shard_count = 8
    for old_path in GENERATED.glob("search-index-*.json"):
        old_path.unlink()
    shards = [[] for _ in range(shard_count)]
    for index, chunk in enumerate(chunks):
        shards[index % shard_count].append(chunk)
    shard_names = []
    for index, shard in enumerate(shards, start=1):
        name = f"search-index-{index:02d}.json"
        shard_names.append(name)
        (GENERATED / name).write_text(json.dumps({"version": 1, "chunks": shard}, ensure_ascii=False, indent=2), encoding="utf-8")
    legacy = GENERATED / "search-index.json"
    if legacy.exists():
        legacy.unlink()
    (GENERATED / "search-index-manifest.json").write_text(json.dumps({"version": 1, "shards": shard_names, "chunks": len(chunks)}, ensure_ascii=False, indent=2), encoding="utf-8")
    (GENERATED / "entities.json").write_text(json.dumps({"version": 1, "entities": entities}, ensure_ascii=False, indent=2), encoding="utf-8")
'''
    if old in s:
        s = s.replace(old, new)
    build.write_text(s, encoding='utf-8')

    retrieval = ROOT / 'lib/retrieval.js'
    s = retrieval.read_text(encoding='utf-8')
    old_import = 'import searchIndex from "../generated/search-index.json";\nimport entities from "../generated/entities.json";\n'
    new_import = '''import searchIndex01 from "../generated/search-index-01.json";
import searchIndex02 from "../generated/search-index-02.json";
import searchIndex03 from "../generated/search-index-03.json";
import searchIndex04 from "../generated/search-index-04.json";
import searchIndex05 from "../generated/search-index-05.json";
import searchIndex06 from "../generated/search-index-06.json";
import searchIndex07 from "../generated/search-index-07.json";
import searchIndex08 from "../generated/search-index-08.json";
import entities from "../generated/entities.json";

const searchIndexes = [searchIndex01, searchIndex02, searchIndex03, searchIndex04, searchIndex05, searchIndex06, searchIndex07, searchIndex08];
'''
    if old_import in s:
        s = s.replace(old_import, new_import)
    s = s.replace('const chunks = searchIndex.chunks || [];', 'const chunks = searchIndexes.flatMap((index) => index.chunks || []);')
    retrieval.write_text(s, encoding='utf-8')


def write_manifest() -> None:
    exclude = {'.git', 'node_modules', '.next', '.pytest_cache', 'bootstrap'}
    files = []
    for path in ROOT.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if rel.as_posix() == 'MANIFEST.sha256':
            continue
        if rel.parts and rel.parts[0] in exclude:
            continue
        if '__pycache__' in rel.parts or path.suffix == '.pyc':
            continue
        files.append(rel)
    files.sort(key=lambda p: p.as_posix())
    lines = [f'{hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()}  {rel.as_posix()}' for rel in files]
    (ROOT / 'MANIFEST.sha256').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-only', action='store_true')
    args = parser.parse_args()
    if args.manifest_only:
        write_manifest()
        return
    write_entity_pages()
    write_rights_and_research()
    patch_runtime()


if __name__ == '__main__':
    main()
