# Blueprint / roadmap

Ce document décrit la trajectoire du projet sans dupliquer la méthodologie éditoriale ni l’architecture technique détaillée.

## État actuel — V1 production

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

## Priorité 1 — couverture documentaire

- [ ] poursuivre la recherche exhaustive des candidats, partis et documents 2027 ;
- [ ] remplacer les sources de confiance `medium` par des sources primaires lorsque celles-ci deviennent accessibles ;
- [ ] intégrer pour chaque candidat déclaré les discours programmatiques, préprogrammes et programmes publiés ;
- [ ] atomiser systématiquement les mesures significatives ;
- [ ] intégrer les nouvelles versions sans écraser les anciennes ;
- [ ] documenter retraits, amendements et contradictions réelles ;
- [ ] maintenir l’audit des droits de reproduction.

## Priorité 2 — mesure de la qualité de recherche

- [x] baseline lexicale full-text auditable ;
- [x] tests de questions réelles exécutés en CI ;
- [ ] constituer un benchmark plus large et versionné de questions/réponses attendues ;
- [ ] mesurer précision, rappel, MRR et qualité des citations ;
- [ ] ajouter BM25 formel si les métriques justifient le changement ;
- [ ] tester embeddings + recherche hybride seulement contre la baseline ;
- [ ] ajouter un reranker si le gain est mesurable ;
- [ ] ajouter des filtres structurés candidat, parti, thème, date et statut documentaire ;
- [ ] tester les comparaisons multi-candidats sur des propositions atomiques homogènes.

## Priorité 3 — expérience publique

- [ ] pages candidat et parti navigables depuis l’interface ;
- [ ] vue comparaison sur un thème ;
- [ ] historique temporel d’une position ;
- [ ] indicateur visible de couverture / données manquantes ;
- [ ] afficher plus explicitement le niveau de confiance de chaque source dans l’UI ;
- [ ] partage d’une réponse avec ses citations.

## Priorité 4 — accès agents et écosystème

- [ ] stabiliser un export JSONL versionné ;
- [ ] API publique read-only lorsque le schéma sera suffisamment stable ;
- [ ] endpoint ou serveur MCP facultatif ;
- [ ] politique de contributions externes avec validation de provenance et neutralité.

## Principe d’architecture

Ne pas introduire de service externe comme source de vérité. GitHub reste canonique ; tout index lexical, vectoriel ou cache est dérivé et reconstructible.
