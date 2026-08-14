# Benchmark public de questions humaines

## Pourquoi il n'est pas généré artificiellement
L'objectif est de mesurer le produit sur des formulations réellement humaines et inédites. Générer 500 questions avec le même modèle qui aide à développer le produit créerait un faux holdout et donnerait une confiance excessive. Le dépôt fournit donc le protocole, le schéma et un canal de contribution, mais ne qualifie jamais de « humaines » des questions synthétiques.

## Cible
Au moins 500 questions gelées avant publication d'un benchmark majeur, stratifiées entre :
- question factuelle simple ;
- paraphrase et faute ;
- comparaison multi-acteurs ;
- chiffres et conditions ;
- historique et changement de position ;
- ambiguïté parti/personnalité ;
- question hors corpus ;
- demande subjective ou recommandation de vote.

## Métriques
- exactitude de la citation ;
- groundedness de la réponse ;
- rappel du retrieval ;
- exactitude de l'abstention ;
- fuite parti → personnalité ;
- contamination historique ;
- affirmation politique non soutenue.

Les trois dernières métriques ont une cible structurelle de zéro pour les réponses publiques.

## Collecte
Le formulaire GitHub `benchmark-question.yml` permet de proposer une formulation humaine avec le comportement attendu et, lorsqu'il existe, le ou les éléments canoniques pertinents. Avant publication, les entrées doivent être dédupliquées, anonymisées et séparées des fixtures utilisées pendant le développement.

## Gel
Une version publique du benchmark doit être associée à un commit ou à une release. Une fois utilisée comme jeu de développement, elle n'est plus considérée comme holdout inédit pour l'évaluation suivante.
