# Gouvernance

## Mission
France 2027 maintient un registre public, versionné et vérifiable des candidatures, documents et propositions politiques liés à l'élection présidentielle française de 2027. La gouvernance protège en priorité l'exactitude documentaire, la neutralité d'attribution, la reproductibilité et la traçabilité.

## Sources de vérité
Les fichiers Markdown et YAML versionnés constituent le canon. Les index JSON, pages web, rapports de couverture et graphes de provenance sont des vues dérivées et reconstructibles.

## Rôles
- **Mainteneur** : accepte les changements structurels, les règles de validation et les releases de recherche.
- **Pipeline de veille** : collecte, vérifie et propose ou promeut automatiquement des éléments selon les règles documentées. Il ne peut pas assouplir les règles de source pour augmenter artificiellement la couverture.
- **Contributeur** : peut proposer une correction ou une source ; l'identité politique ou institutionnelle d'un contributeur ne modifie jamais le niveau de preuve requis.
- **Relecteur externe** : audite périodiquement un échantillon selon `docs/EXTERNAL_REVIEW_PROTOCOL.md` et déclare ses conflits d'intérêts.

## Règles de décision
1. Une source primaire disponible prime sur une reprise secondaire.
2. Une position de parti ne devient jamais celle d'une personnalité sans preuve directe d'attribution.
3. Une absence de donnée reste une absence de documentation dans le corpus.
4. Une correction conserve l'historique Git et suit `CORRECTIONS_POLICY.md`.
5. Une donnée historique, retirée ou remplacée reste conservée mais ne doit pas contaminer l'état courant.
6. Les changements de schéma doivent rester rétrocompatibles ou fournir une migration explicite et testée.

## Automatisation et branche canonique
La veille peut rester autonome afin de maintenir la fraîcheur. Les modifications humaines et structurelles doivent passer par une branche et les contrôles CI. Le dépôt vise une protection de `main` contre suppression et force-push, avec checks obligatoires pour les changements humains et une exception étroitement limitée à l'automatisation de veille. La configuration GitHub effective doit refléter cette règle sans empêcher les mises à jour autonomes légitimes.

## Transparence
Les méthodes, limites, licences, schémas et indicateurs de qualité sont publics. Les métriques de couverture ne sont jamais utilisées comme note politique ou comme appréciation d'un candidat.
