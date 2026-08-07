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

## Incertitude

En cas de doute, l’entrée doit rester dans un état prudent : `unknown`, `unverified`, `link_only`, `needs_review` ou `attributed_by_secondary_source` selon le cas.
