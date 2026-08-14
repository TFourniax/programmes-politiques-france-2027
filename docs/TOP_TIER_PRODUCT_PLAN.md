# Top-tier product & corpus plan

Cette note accompagne la branche d'amélioration produit/data/SEO. Elle documente les objectifs mesurables derrière les changements afin d'éviter une accumulation de fonctionnalités sans critère de qualité.

## North star

Faire de France 2027 une **base de connaissance politique publique, ouverte, fraîche, versionnée et vérifiable**, utilisable aussi bien par un citoyen que par un moteur de recherche ou un agent. La recherche conversationnelle est un mode d'accès au corpus, pas l'identité du produit.

## P0 — intégrité et exhaustivité structurelle

- Une taxonomie publique unique pilote UI, validation et couverture.
- Les douze thèmes incluent explicitement `defense-international` et `numerique-ia`.
- Toute proposition canonique doit rester liée à ses documents de preuve.
- Une donnée remplacée ou retirée reste historique et ne contamine pas l'état courant.
- Les candidats actifs disposent d'une matrice de couverture séparée du taux global tous acteurs.

## P1 — qualité perçue et vérifiable

- Landing éditoriale data-first, sans esthétique ni vocabulaire de chatbot comme promesse principale.
- Pages indexables par candidat et par thème, avec contenu substantiel et sources.
- Page publique de couverture/fraîcheur/limites.
- Première interaction rapide : métadonnées légères et préchauffage zéro-token de la route de retrieval.
- Evaluation humaine élargie : réponses, hors-corpus ciblé, demandes subjectives et liens de source.

### SLO produit visés

- réponse chaude p95 < 2 s ;
- première réponse après cold start : cible < 4 s, à mesurer sur production ;
- aucune réponse politique sans citation ;
- rejet de 100 % du jeu d'évaluation hors corpus/subjectif ;
- aucune attribution automatique parti → personnalité ;
- aucune version historique présentée comme actuelle.

## P2 — moat data et distribution

- Sitemap couvrant home, candidats, thèmes et transparence.
- Manifest JSON public pour la découverte machine-readable.
- `llms.txt` pour expliciter la source canonique et les règles d'interprétation aux agents.
- Données canoniques toujours conservées en Markdown/JSON versionnés dans Git.
- Couverture des candidats actifs et fraîcheur des preuves comme KPI de veille.

## KPI de corpus à piloter

1. couverture directe candidat actif × thème ;
2. âge de la dernière preuve par candidat × thème ;
3. part des propositions vérifiées ;
4. part des propositions confirmées par plusieurs documents ;
5. nombre de sources officielles en échec persistant ;
6. questions réelles sans réponse pertinente (après anonymisation et agrégation si une télémétrie est ajoutée ultérieurement).

Le taux global acteur × thème reste utile pour l'inventaire, mais ne doit plus être le KPI principal de complétude du produit public.
