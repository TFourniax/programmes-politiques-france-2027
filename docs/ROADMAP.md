# Blueprint / roadmap

Ce document décrit la trajectoire du projet sans dupliquer la méthodologie éditoriale ni l’architecture technique détaillée.

## État actuel — V1

- [x] dépôt GitHub public comme source canonique ;
- [x] statuts des personnalités séparés des statuts des documents ;
- [x] corpus Markdown sourcé ;
- [x] registres machine-readable ;
- [x] propositions atomiques pilotes ;
- [x] interface Next.js de questions-réponses ;
- [x] retrieval effectué avant toute synthèse LLM ;
- [x] citations vers le dépôt et les sources originales ;
- [x] fallback sans extrapolation lorsque le corpus est insuffisant ;
- [x] CI application web ;
- [x] QA minimal du corpus et tests de cohérence.

## Priorité 1 — couverture documentaire

- [ ] poursuivre la recherche exhaustive des candidats, partis et documents 2027 ;
- [ ] remplacer autant que possible les sources secondaires par les sources primaires ;
- [ ] enrichir chaque personnalité suivie d’au moins une source de statut vérifiable ;
- [ ] intégrer les nouvelles versions sans écraser les anciennes ;
- [ ] documenter systématiquement retraits, amendements et contradictions réelles ;
- [ ] maintenir l’audit des droits de reproduction.

## Priorité 2 — qualité de recherche

- [ ] ajouter un index lexical plus robuste lorsque le corpus grossit ;
- [ ] ajouter des embeddings et un reranker si les tests démontrent un gain réel ;
- [ ] créer un jeu de questions de référence pour mesurer précision, rappel et qualité des citations ;
- [ ] ajouter des filtres explicites par candidat, parti, thème, date et statut documentaire ;
- [ ] tester les comparaisons multi-candidats sur des propositions atomiques homogènes.

## Priorité 3 — expérience publique

- [ ] pages candidat et parti navigables depuis l’interface ;
- [ ] vue comparaison sur un thème ;
- [ ] historique temporel d’une position ;
- [ ] indicateur visible de couverture / données manquantes ;
- [ ] partage d’une réponse avec ses citations.

## Priorité 4 — accès agents et écosystème

- [ ] stabiliser un export JSONL versionné ;
- [ ] API publique read-only lorsque le schéma sera suffisamment stable ;
- [ ] endpoint ou serveur MCP facultatif ;
- [ ] politique de contributions externes avec validation de provenance et neutralité.

## Principe d’architecture

Ne pas introduire de service externe comme source de vérité. GitHub reste canonique ; tout index lexical, vectoriel ou cache est dérivé et reconstructible.
