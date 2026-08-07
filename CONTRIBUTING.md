# Contribuer

## Ajouter une personnalité

1. Créer ou mettre à jour l’entrée dans `registries/candidates.yaml`.
2. Utiliser un statut autorisé par `METHODOLOGY.md`.
3. Ajouter une source datée.
4. Ajouter un événement dans `status_history` plutôt que remplacer silencieusement l’ancien statut.
5. Créer une fiche dans `entities/candidates/<slug>.md`.

## Ajouter un parti ou mouvement

1. Créer ou mettre à jour `registries/parties.yaml`.
2. Distinguer parti, coalition, mouvement de campagne et comité de soutien.
3. Ne pas attribuer un programme de parti à un candidat sans source explicite.

## Ajouter un document

1. Créer une fiche dans `corpus/2027/<entity-slug>/`.
2. Renseigner le frontmatter complet.
3. Indiquer le statut du candidat à la date du document et à la date de consultation.
4. Qualifier les droits de reproduction.
5. Ajouter l’entrée correspondante dans `registries/documents.yaml`.

## Ajouter une proposition

1. Créer une fiche atomique dans `proposals/<topic>/`.
2. Rattacher la proposition à au moins un document source.
3. Indiquer la certitude : `explicit`, `explicit_but_conditional`, `explicit_but_underspecified`, `attributed_by_secondary_source`, etc.
4. Ne pas inventer de chiffrage ou de calendrier.

## Validation

Avant chaque contribution :

```bash
python scripts/validate.py
python scripts/build_catalog.py
pytest -q
```

## Revue

Toute contribution substantielle doit vérifier : source, date, authenticité, droits, statut du document et statut de la personne.
