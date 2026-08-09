# Architecture de l’explorateur public

Ce document décrit les règles communes aux vues **Comparer**, **Candidats**, **Thèmes**, **Boussole** et **Quiz**. Ces vues ne constituent pas une seconde base politique : elles sont dérivées du corpus versionné du dépôt.

## Source de vérité

Les vues utilisent uniquement les données produites à partir de :

- `registries/` et `data/entities.json` pour les personnalités, partis et statuts ;
- `corpus/` pour les documents ;
- `proposals/` pour les propositions atomiques ;
- `data/search-index.json`, index dérivé et reconstructible au build ;
- `data/compass.json` pour la taxonomie des dix grands enjeux utilisée dans l’interface.

Aucun service externe et aucun LLM ne détermine les scores de couverture, le rattachement d’une source ou l’ordre des personnalités.

## Règle fondamentale : candidat ≠ parti

Un document ou une proposition compte comme **source directe d’une personnalité** uniquement si son `entity_id` correspond à cette personnalité.

Les documents du parti principal peuvent être affichés dans une zone **Contexte du parti**, mais :

- ils ne sont jamais comptés comme source directe du candidat ;
- ils ne font jamais passer un candidat de « non documenté » à « partiel » ou « documenté » ;
- ils ne sont jamais présentés comme un engagement personnel sans source explicite qui le rattache au candidat.

Cette séparation est testée automatiquement en CI dans `scripts/test-explorer.mjs`.

## États de couverture

Pour chacun des dix enjeux, la couverture d’une personnalité prend exactement un état :

| État | Définition |
| --- | --- |
| `documented` | au moins deux sources directes pertinentes dans le corpus courant |
| `partial` | une source directe pertinente |
| `party_only` | aucune source directe, mais au moins une source pertinente du parti principal |
| `none` | aucune source directe pertinente trouvée |

Ces états décrivent **la couverture du corpus**, pas la précision, la valeur ou la faisabilité de la position politique.

Une absence de source signifie « non documenté ici ». Elle ne signifie jamais « opposé », « sans opinion » ou « refuse cette mesure ».

## Comparateur

Le comparateur accepte deux à quatre personnalités et jusqu’à six enjeux.

Il :

- n’attribue aucun score politique global ;
- ne classe pas les candidats par proximité idéologique ;
- expose chaque cellule avec son état de couverture ;
- affiche les sources directes puis, séparément, le contexte du parti ;
- indique les thèmes pour lesquels la sélection n’est pas suffisamment documentée ;
- encode uniquement la sélection dans l’URL pour permettre le partage.

Aucun profil utilisateur n’est requis pour partager une comparaison.

## Fiche candidat

La fiche rassemble :

- le statut électoral enregistré et sa date ;
- une matrice de couverture sur les dix enjeux ;
- les documents directement rattachés à la personnalité ;
- le contexte documentaire du parti dans une section séparée ;
- une chronologie des documents directement rattachés et du statut enregistré.

La chronologie ne prétend pas qu’une position a changé uniquement parce qu’un document plus récent existe. Les changements, retraits ou contradictions doivent rester établis par les métadonnées et les sources du corpus.

## Explorateur thématique

La vue thématique affiche **toutes** les personnalités suivies, y compris celles dont la couverture est `none`.

L’ordre est uniquement fonction du niveau de couverture documentaire (`documented`, `partial`, `party_only`, `none`), puis alphabétique. Ce n’est pas un classement politique.

Les plateformes de parti sont également affichées dans une section indépendante des candidatures.

## Boussole des enjeux

La Boussole sert uniquement à aider l’utilisateur à identifier les thèmes qu’il souhaite approfondir.

Elle ne :

- calcule pas de proximité avec un candidat ;
- n’infère pas une orientation gauche/droite ;
- ne produit pas de recommandation de vote ;
- ne persiste pas les réponses comme profil politique.

Le résultat est un parcours de lecture vers les thèmes jugés prioritaires par l’utilisateur.

## Quiz de compréhension

Le quiz vérifie uniquement des faits explicites du dépôt :

- statut enregistré d’une personnalité ;
- rattachement explicite d’un document ou d’une proposition à une personnalité.

Chaque réponse possède une source de vérification. Le score mesure la compréhension du corpus, jamais une orientation politique.

## Partage et confidentialité

Les vues peuvent utiliser des paramètres d’URL tels que :

- `mode=compare` ;
- `c=<candidate-id>,<candidate-id>` ;
- `t=<topic-id>,<topic-id>` ;
- `candidate=<candidate-id>` ;
- `topic=<topic-id>`.

Ces paramètres décrivent une navigation ou une sélection de comparaison. Ils ne constituent pas un profil électoral et aucune recommandation n’est calculée à partir d’eux.

## Limites actuelles

Le corpus politique reste évolutif et n’est pas exhaustif. Les indicateurs de couverture rendent précisément cette incomplétude visible.

La fonction « nouveau depuis ma dernière visite » n’est pas activée tant que le modèle de données ne contient pas une métadonnée fiable du type `first_indexed_at` / journal de changements permettant de distinguer :

- la date politique d’un document ;
- la date à laquelle le dépôt l’a découvert ;
- la date d’une modification éditoriale ou d’une nouvelle version.

Il est préférable d’afficher aucune fonctionnalité de nouveauté plutôt qu’un historique trompeur dérivé des seules dates de publication.
