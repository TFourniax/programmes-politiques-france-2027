# Informations manquantes et priorités de recherche

Instantané V1 : **2026-08-09**.

Le dépôt est techniquement exploitable et le moteur indexe désormais le contenu complet des fichiers Markdown, mais le corpus politique reste vivant et n'est pas présenté comme exhaustif.

## P0 — statuts à surveiller en priorité

- Toute évolution judiciaire ou politique susceptible de modifier une candidature.
- Toute nouvelle désignation officielle de parti.
- Tout retrait, renoncement ou passage d'une candidature potentielle à une candidature déclarée.
- La future liste du Conseil constitutionnel : elle seule permettra d'utiliser `official_candidate`.

Les personnalités dont `status_confidence: medium` reposent encore principalement sur une ou plusieurs sources secondaires solides ou sur une source primaire incomplète. Elles doivent être remplacées par une source de campagne/parti/institution dès qu'une preuve primaire exploitable est disponible.

## P1 — programmes et préprogrammes

Le nombre de personnes suivies est nettement supérieur au nombre de programmes et documents programmatiques déjà intégrés. Plusieurs candidats déclarés ne disposent donc pas encore d'un programme présidentiel 2027 suffisamment documenté dans le dépôt.

Priorités :

- intégrer les programmes explicitement 2027 dès publication ;
- intégrer les préprogrammes et conventions thématiques ;
- intégrer les grands discours programmatiques récents ;
- distinguer systématiquement projet de parti, programme personnel, interview et proposition ponctuelle ;
- rechercher une version plus récente avant de considérer un document comme `current`.

## P2 — propositions atomiques

Les propositions atomiques actuelles valident le format et servent aux tests du moteur, mais ne couvrent pas encore tous les thèmes ni toutes les sensibilités.

À poursuivre :

- retraite ;
- salaires et travail ;
- fiscalité ;
- immigration et asile ;
- sécurité et justice ;
- institutions ;
- défense ;
- énergie et nucléaire ;
- santé ;
- éducation ;
- logement ;
- écologie ;
- Union européenne ;
- intelligence artificielle et numérique.

## P3 — versions historiques et contradictions

Conserver les versions antérieures permet de répondre aux questions d'évolution et de contradiction. Ne jamais écraser silencieusement une ancienne position.

Les changements à documenter explicitement comprennent :

- ajout ou retrait d'une mesure ;
- montant modifié ;
- calendrier modifié ;
- changement de périmètre ;
- différence candidat / parti ;
- contradiction réelle ou tension à revoir.

## P4 — qualité du retrieval

La V1 dispose maintenant d'une baseline full-text et d'un jeu de tests. Les améliorations suivantes doivent être guidées par les métriques et non ajoutées par principe :

- benchmark plus large de questions ;
- BM25 ;
- embeddings ;
- recherche hybride ;
- reranking ;
- filtres structurés.

## Règle fondamentale

**Non documenté dans ce dépôt** ne signifie jamais **absence de position politique**.

Un niveau de confiance `medium` ne signifie pas que l'information est fausse : il signifie que la preuve disponible dans le corpus n'atteint pas encore le standard `high` d'une source primaire claire, datée et directement attribuable.
