# Modèle de provenance et d'evidence graph

## Objectif
Rendre chaque affirmation politique retraçable selon la chaîne : **acteur ← claim ← preuve documentaire ← source**, tout en conservant les versions et propriétaires de documents séparément.

## Nœuds
- `entity` : personnalité, parti ou mouvement canonique ;
- `document` : document versionné du corpus ;
- `proposal` : claim politique atomique.

## Relations
- `published_by` : document → propriétaire du document ;
- `attributed_to` : proposition → acteur du claim ;
- `supports` : document → proposition lorsqu'il figure parmi ses sources canoniques ;
- `supersedes` : nouvelle proposition → ancienne proposition lorsque le remplacement est explicitement documenté.

Le propriétaire d'un document et l'acteur d'une proposition sont volontairement deux relations distinctes. Le graphe ne doit jamais transformer `document → parti` en `proposal → candidat` par transitivité.

## Relations enrichies
Pour de futurs audits, les relations suivantes peuvent être ajoutées de manière explicite : `confirms`, `contradicts`, `direct_quote`, `context_only`. Elles ne doivent pas être déduites de la simple cooccurrence de deux documents.

## Hash et reproductibilité
Chaque nœud document/proposition dérivé comporte une empreinte SHA-256 du fichier canonique local. Cette empreinte prouve l'état du snapshot du corpus, pas l'intégrité cryptographique de la page distante à une date antérieure.

## Génération
`python scripts/build_evidence_graph.py` reconstruit `generated/evidence-graph.json`. Ce fichier est une vue dérivée : en cas de désaccord, les Markdown/YAML canoniques prévalent.
