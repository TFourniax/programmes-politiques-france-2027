# Modèle de provenance et d'evidence graph

## Objectif
Rendre chaque affirmation politique retraçable selon la chaîne : **acteur ← claim ← preuve documentaire ← source**, tout en conservant les versions, rattachements et éditeurs de documents séparément.

## Nœuds
- `entity` : personnalité, parti ou mouvement canonique issu des registres YAML ;
- `document` : document versionné du corpus ;
- `proposal` : claim politique atomique.

## Relations
- `attached_to` : document → acteur ou organisation auquel le document est rattaché dans le canon. Cette relation ne signifie pas que l'acteur a publié l'URL ;
- `published_by` : document → éditeur uniquement lorsqu'un `publisher_entity_id` explicite existe dans les métadonnées ;
- `attributed_to` : proposition → acteur du claim ;
- `supports` : document → proposition lorsqu'il figure parmi ses sources canoniques ;
- `supersedes` : nouvelle proposition → ancienne proposition lorsque le remplacement est explicitement documenté.

Le rattachement d'un document, son éditeur et l'acteur d'une proposition sont volontairement trois notions différentes. Une interview TF1 rattachée à une personnalité reste `attached_to` cette personnalité sans devenir `published_by` elle. Le graphe ne doit jamais transformer `document → parti` en `proposal → candidat` par transitivité.

## Dates et instantanés
Le graphe expose `snapshotDates.candidates`, `snapshotDates.parties` et `snapshotDates.documents` à partir des registres YAML canoniques. `snapshotDate` est la date la plus récente de ces trois registres et décrit l'état global du snapshot dérivé. Il n'est jamais lu depuis un miroir JSON applicatif.

Un `published_at` dont `date_basis` vaut `capture_fallback` indique seulement la date à laquelle la page a été observée. Il ne doit pas être présenté comme date de publication connue.

## Relations enrichies
Pour de futurs audits, les relations suivantes peuvent être ajoutées de manière explicite : `confirms`, `contradicts`, `direct_quote`, `context_only`. Elles ne doivent pas être déduites de la simple cooccurrence de deux documents.

## Hash et reproductibilité
Chaque nœud document/proposition dérivé comporte une empreinte SHA-256 du fichier canonique local. Cette empreinte prouve l'état du snapshot du corpus, pas l'intégrité cryptographique de la page distante à une date antérieure.

## Génération
`python scripts/build_evidence_graph.py` reconstruit `generated/evidence-graph.json`. Ce fichier est une vue dérivée : en cas de désaccord, les Markdown/YAML canoniques prévalent.
