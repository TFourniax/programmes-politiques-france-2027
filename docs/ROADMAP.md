# Blueprint / roadmap

Ce document décrit la trajectoire du projet sans dupliquer la méthodologie éditoriale ni l’architecture technique détaillée.

## État actuel — V2 exploration publique

### Socle corpus & recherche

- [x] dépôt GitHub public comme source canonique ;
- [x] snapshot candidats/partis daté et qualifié par niveau de confiance ;
- [x] statuts des personnalités séparés des statuts des documents ;
- [x] corpus Markdown sourcé ;
- [x] registres machine-readable ;
- [x] propositions atomiques pilotes ;
- [x] interface Next.js de questions-réponses ;
- [x] indexation du contenu complet des Markdown au build ;
- [x] retrieval lexical pondéré avec diversification ;
- [x] retrieval effectué avant toute synthèse LLM ;
- [x] citations vers le dépôt et les sources originales ;
- [x] fallback sans extrapolation lorsque le corpus est insuffisant ;
- [x] jeu de questions de référence pour le retrieval ;
- [x] CI application web + QA corpus ;
- [x] configuration Netlify ;
- [x] index dérivé reconstructible et non canonique.

### Expérience publique V2

- [x] navigation unifiée : Questionner / Comparer / Candidats / Thèmes / Boussole / Quiz ;
- [x] comparateur avancé de 2 à 4 personnalités et jusqu’à 6 thèmes ;
- [x] comparaisons partageables par URL sans compte ni profil politique ;
- [x] fiches candidat avec statut, documents directs, couverture thématique et contexte de parti séparé ;
- [x] indicateur « documenté / partiel / parti seulement / non documenté » ;
- [x] explorateur thématique montrant également les personnalités non documentées ;
- [x] timeline des éléments directement rattachés à une personnalité ;
- [x] Boussole des enjeux non prescriptive ;
- [x] quiz de compréhension sourcé, sans profil idéologique ;
- [x] liens d’approfondissement vers le chatbot ;
- [x] tests CI garantissant notamment qu’un document de parti ne compte jamais comme position directe d’un candidat ;
- [x] architecture et règles de neutralité des vues documentées dans `docs/EXPLORER_ARCHITECTURE.md`.

## Priorité 1 — couverture documentaire

- [ ] poursuivre la recherche exhaustive des candidats, partis et documents 2027 ;
- [ ] remplacer les sources de confiance `medium` par des sources primaires lorsque celles-ci deviennent accessibles ;
- [ ] intégrer pour chaque candidat déclaré les discours programmatiques, préprogrammes et programmes publiés ;
- [ ] atomiser systématiquement les mesures significatives ;
- [ ] intégrer les nouvelles versions sans écraser les anciennes ;
- [ ] documenter retraits, amendements et contradictions réelles ;
- [ ] maintenir l’audit des droits de reproduction.

La valeur des outils V2 dépend directement de cette couverture : l’interface rend les lacunes visibles mais ne peut pas les compenser par de l’inférence.

## Priorité 2 — qualité et profondeur de comparaison

- [x] baseline lexicale full-text auditable ;
- [x] tests de questions réelles exécutés en CI ;
- [x] filtres structurés par entité et par thème dans les vues V2 ;
- [x] comparaison multi-candidats avec séparation stricte candidat / parti ;
- [ ] constituer un benchmark plus large et versionné de questions/réponses attendues ;
- [ ] mesurer précision, rappel, MRR et qualité des citations ;
- [ ] ajouter BM25 formel si les métriques justifient le changement ;
- [ ] tester embeddings + recherche hybride seulement contre la baseline ;
- [ ] ajouter un reranker si le gain est mesurable ;
- [ ] enrichir les propositions atomiques afin de permettre des comparaisons mesure-par-mesure plus homogènes ;
- [ ] ajouter des filtres date et statut documentaire dans les vues publiques si le volume le justifie.

## Priorité 3 — temporalité et retour utilisateur

- [x] chronologie d’une personnalité fondée sur les dates des documents et du statut ;
- [ ] ajouter une métadonnée fiable `first_indexed_at` lors de l’ingestion ;
- [ ] produire un journal de changements dérivé (ajout, amendement, retrait, nouvelle version) ;
- [ ] seulement après cela, activer « nouveau depuis ma dernière visite » ;
- [ ] permettre de partager une vue thématique ou une fiche candidat avec son état exact ;
- [ ] étudier un export imprimable / synthèse partageable avec citations.

`Nouveau depuis ma dernière visite` n’est pas simulé à partir de `published_at` : la date politique d’un document n’est pas la date à laquelle le dépôt l’a découvert.

## Priorité 4 — accès agents et écosystème

- [ ] stabiliser un export JSONL versionné ;
- [ ] API publique read-only lorsque le schéma sera suffisamment stable ;
- [ ] endpoint ou serveur MCP facultatif ;
- [ ] politique de contributions externes avec validation de provenance et neutralité.

## Principe d’architecture

Ne pas introduire de service externe comme source de vérité. GitHub reste canonique ; tout index lexical, vectoriel, cache, matrice de couverture ou résultat d’exploration est dérivé et reconstructible.
