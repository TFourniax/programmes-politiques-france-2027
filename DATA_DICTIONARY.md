# Dictionnaire des données

Ce document définit la sémantique des champs canoniques. Les schémas machine-readable sont dans `schemas/`.

## Personnalité
- `id` : identifiant stable et non sémantique de la personnalité.
- `current_status` : état de candidature au dernier instantané ; ne préjuge pas de la liste officielle du Conseil constitutionnel sauf `official_candidate`.
- `status_as_of` : date à laquelle ce statut est établi.
- `status_confidence` : confiance dans l'attribution du statut, pas probabilité électorale.
- `primary_party_id` : rattachement principal enregistré ; ne transfère aucune proposition du parti à la personnalité.

## Document
- `document_id` : identifiant stable du document canonique.
- `entity_id` : acteur ou organisation auquel le document est rattaché pour le corpus. Ce champ n'affirme pas qui a publié la page distante.
- `publisher_entity_id` : éditeur canonique du document uniquement lorsqu'il est explicitement établi ; il n'est jamais déduit de `entity_id` ni du nom de domaine.
- `document_type` : nature documentaire.
- `document_status` : `current`, `amended`, `superseded`, `withdrawn`, `draft`, `archived` ou `unknown`.
- `published_at` : date de publication connue ou valeur de capture lorsque `date_basis: capture_fallback` le signale explicitement.
- `date_basis` : provenance de la date. `source_publication` signifie date de publication établie ; `capture_fallback` signifie seulement date d'observation et ne doit pas être présentée comme publication ; `unknown` reste indéterminé.
- `captured_at` : instant de collecte technique lorsqu'il est conservé.
- `source_url` : URL d'origine ou meilleure URL primaire disponible.
- `source_tier` : niveau de source selon `SOURCES_POLICY.md`.
- `rights_status` : régime de réutilisation ; ne confond pas accessibilité publique et licence ouverte.
- `retrieved_at` : date de dernière récupération ou vérification de la page, lorsqu'elle est enregistrée.
- `topics` : thèmes utiles à la découverte ; ce champ seul ne crée aucune proposition.

## Proposition
- `proposal_id` : identifiant stable du claim atomique.
- `entity_id` : acteur auquel le claim est explicitement attribué.
- `topic` : thème public unique de la proposition.
- `certainty` : précision documentaire de l'attribution.
- `proposal_status` : état temporel du claim ; `current` par défaut.
- `source_document_id` / `source_document_ids` : documents canoniques soutenant le claim.
- `verification_state` : état du contrôle documentaire, lorsque renseigné.
- `source_published_at` : date de la source utilisée pour le claim.
- `last_confirmed_at` : dernière date à laquelle la provenance a été vérifiée ; ne signifie pas que le candidat a réitéré la proposition à cette date.
- `supersedes` / `superseded_by` : relation explicite de remplacement entre claims du même acteur et du même thème.

## Preuve / provenance
Le graphe dérivé produit par `scripts/build_evidence_graph.py` n'est pas canonique. Il relie sans fusionner document, rattachement documentaire, éditeur explicite, claim et acteur. Les relations de base sont `attached_to`, `supports`, `attributed_to` et `supersedes`; `published_by` n'existe que lorsque l'éditeur est explicitement documenté. Les relations futures telles que `confirms`, `contradicts` ou `context_only` doivent rester explicitement déclarées et sourcées.

## Vérification
`verified` signifie que l'attribution et la fidélité à la source ont été vérifiées. Cela ne signifie pas que la proposition est réalisable, financée, constitutionnelle, efficace ou souhaitable.
