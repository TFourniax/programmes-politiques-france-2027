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
- `entity_id` : propriétaire ou acteur auquel le document est rattaché ; il reste distinct de l'acteur d'un claim lorsqu'une source d'un parti prouve explicitement une déclaration personnelle, ou inversement.
- `document_type` : nature documentaire.
- `document_status` : `current`, `amended`, `superseded`, `withdrawn`, `draft`, `archived` ou `unknown`.
- `published_at` : date de publication connue ; peut être absente si elle n'est pas établie avec assez de précision.
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
Le graphe dérivé produit par `scripts/build_evidence_graph.py` n'est pas canonique. Il relie sans fusionner : document, claim, acteur et relations temporelles. Les relations de base sont `supports`, `attributed_to`, `published_by` et `supersedes`. Des relations futures telles que `confirms`, `contradicts` ou `context_only` doivent rester explicitement déclarées et sourcées.

## Vérification
`verified` signifie que l'attribution et la fidélité à la source ont été vérifiées. Cela ne signifie pas que la proposition est réalisable, financée, constitutionnelle, efficace ou souhaitable.
