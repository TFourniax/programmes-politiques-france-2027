# Méthodologie

Ce dépôt documente les programmes, propositions et statuts politiques liés à l’élection présidentielle française de 2027.

## Séparation stricte des objets

Chaque information est qualifiée séparément selon trois axes :

1. le statut de la personne ;
2. le statut du document ;
3. le niveau de certitude de la proposition.

Une personnalité peut être suivie sans être candidate officielle. Un parti peut disposer d’un programme sans que ce programme soit automatiquement attribuable à une personnalité.

## Statuts des personnes

Les statuts autorisés sont :

- `official_candidate` ;
- `declared_presidential` ;
- `party_designated` ;
- `declared_primary` ;
- `declared_conditional` ;
- `exploratory` ;
- `potential` ;
- `withdrawn` ;
- `not_running` ;
- `deceased` ;
- `unknown`.

Le statut `official_candidate` est réservé aux personnes figurant sur la liste publiée par le Conseil constitutionnel.

## Statuts des documents

Les documents peuvent notamment être :

- programme présidentiel officiel ;
- préprogramme présidentiel ;
- programme de parti ;
- plateforme thématique ;
- manifeste ;
- déclaration de candidature ;
- discours officiel ;
- communiqué ;
- entretien officiel ;
- synthèse secondaire ;
- référence historique.

Chaque document possède aussi un état : `current`, `superseded`, `amended`, `withdrawn`, `draft`, `archived` ou `unknown`.

## Propositions atomiques

Une proposition atomique exprime une seule mesure, orientation ou promesse principale. Elle doit être rattachée à un document source, avec date, statut, contexte et degré de certitude.

## Sources

La priorité va aux sources primaires : sites officiels, communiqués, PDF de campagne, documents institutionnels, transcriptions officielles. Les sources secondaires servent à découvrir, contextualiser ou confirmer lorsqu’aucune source primaire n’est disponible.

## Versions

Les anciennes versions ne doivent pas être supprimées. Une nouvelle version doit remplacer explicitement une ancienne via les champs `supersedes` et `superseded_by`.

Le **chatbot courant** et les vues présentant l’état actuel excluent les versions `superseded`, `withdrawn`, `archived`, `rejected`, `draft` ou explicitement historiques. Une ancienne version ne doit jamais réapparaître comme position actuelle uniquement parce qu’elle correspond mieux lexicalement à une question.

Le mode **Historique** peut au contraire afficher les anciennes versions, leurs dates, leurs sources et leurs liens de version. L’ordre chronologique seul ne suffit jamais à affirmer un revirement, un abandon ou un remplacement : une évolution est qualifiée comme telle uniquement lorsqu’un statut ou un lien `supersedes` / `superseded_by` le documente.

## Réponses du chatbot

La récupération est déterministe en priorité. Le système doit préférer un refus explicite à une réponse approximative.

- une entité nommée sert de filtre, jamais de preuve suffisante du sujet ;
- un thème reconnu ne peut pas masquer un qualificatif hors corpus ;
- les nombres de la question doivent être compatibles avec les preuves retournées ;
- une position de parti n’est pas transférée automatiquement à une personnalité ;
- une absence du corpus n’est pas transformée en absence de position ;
- aucun classement politique subjectif n’est déduit automatiquement ;
- les réponses politiques sont composées à partir de formulations présentes dans les données versionnées ou de titres canoniques de propositions.

Un classifieur sémantique de secours peut uniquement aider à interpréter une formulation lorsque le retrieval déterministe échoue. Chaque acteur ou concept qu’il propose doit être rattaché à un fragment exact de la question courante, puis la requête obtenue est revalidée par le moteur déterministe. Le classifieur ne rédige jamais les faits ou positions affichés.

## Suggestions

Les suggestions de questions doivent être dérivées exclusivement de thèmes et d’acteurs réellement documentés dans les versions actives du corpus. Chaque suggestion est elle-même testée par le moteur déterministe avant affichage ; une suggestion ambiguë, hors corpus ou attribuée au mauvais acteur doit être supprimée.

## Incertitude

En cas de doute, l’entrée doit rester dans un état prudent : `unknown`, `unverified`, `link_only`, `needs_review` ou `attributed_by_secondary_source` selon le cas.

Au niveau de l’interface, une donnée manquante doit être présentée comme **non documentée dans le corpus**, jamais comme une conclusion sur la position politique réelle de l’acteur.
