# Programmes politiques France 2027

Dépôt public, neutre et versionné de documents, propositions et métadonnées relatifs à l’élection présidentielle française de 2027.

> **Important :** une personnalité suivie dans ce dépôt n’est pas nécessairement un candidat officiel. Le statut de chaque personne, document et proposition est qualifié séparément et daté.

## Objectifs

- rendre les programmes et propositions plus accessibles aux humains comme aux agents/LLM ;
- conserver les différentes versions et évolutions de positions ;
- permettre des comparaisons sourcées entre candidats et partis ;
- fournir une base canonique pour un futur chatbot/RAG ;
- distinguer strictement programme de parti, programme de candidat, déclaration ponctuelle et document historique.

## Principes

1. **Sources primaires d’abord.** Les sources secondaires servent à découvrir ou contextualiser, pas à remplacer une source officielle disponible.
2. **Pas de surinterprétation.** Une absence d’information n’est pas une opposition, et une position de parti n’est pas automatiquement attribuée à un candidat.
3. **Traçabilité.** Les dates, statuts, sources et versions sont conservés.
4. **Neutralité.** Le corpus documente ce qui est proposé ; il n’évalue pas la pertinence politique des mesures.
5. **Prudence juridique.** Les textes complets ne sont reproduits que lorsque les droits le permettent ; sinon le dépôt conserve métadonnées, résumés, courtes citations et liens.

## Structure prévue

```text
entities/       fiches des candidats et partis
corpus/         documents politiques versionnés
proposals/      propositions atomiques par thème
registries/     registres YAML canoniques
schemas/        schémas JSON
research/       rapports de collecte et de contrôle
generated/      index JSON/JSONL reconstruisibles
scripts/        validation, génération et contrôle des sources
taxonomy/       taxonomie thématique
templates/      modèles de contribution
```

## Statut du corpus

Le corpus est un **instantané préélectoral** et évoluera jusqu’au scrutin. Le statut `official_candidate` est réservé aux personnes figurant sur la liste officielle publiée par le Conseil constitutionnel.

## Pour les agents et LLM

Lire d’abord `AGENTS.md` et `llms.txt`. Les index générés `generated/catalog.jsonl` et `generated/proposals.jsonl` seront pratiques, mais les fichiers Markdown et les registres YAML resteront la source de vérité.

## Validation locale

```bash
python -m pip install -r requirements.txt
python scripts/validate.py
python scripts/build_catalog.py
pytest -q
```

## Contribution

Le projet repose sur quatre règles : source primaire recherchée, statut explicite, date explicite, droits de reproduction qualifiés.
