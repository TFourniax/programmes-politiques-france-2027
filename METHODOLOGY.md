# Méthodologie

Ce dépôt documente les programmes, propositions et statuts politiques liés à l’élection présidentielle française de 2027.

## Séparation stricte des objets

Chaque information est qualifiée séparément selon trois axes :

1. le statut de la personne ;
2. le statut du document ;
3. le niveau de certitude de la proposition.

Une personnalité peut être suivie sans être candidate officielle. Un parti peut disposer d’un programme sans que ce programme soit attribuable à toutes les personnalités qui lui sont liées.

### Attribution d’un programme de parti à une personnalité

Le corpus applique une règle contrôlée et vérifiable : **le programme d’un parti peut être attribué à une personnalité uniquement lorsqu’elle est officiellement désignée pour porter la candidature de ce parti**.

Dans le registre actuel, cette attribution est autorisée lorsque :

- la personnalité possède un `primary_party_id` explicite ;
- son statut est `party_designated`, ou `official_candidate` lorsque la liste officielle du Conseil constitutionnel sera disponible ;
- le document ou la proposition provient bien du parti enregistré comme parti principal.

Une simple appartenance, une candidature déclarée de façon autonome, une participation à une primaire, un statut potentiel ou exploratoire ne suffisent jamais à transférer le programme du parti à la personnalité.

Même lorsque l’attribution est autorisée, **la provenance n’est jamais réécrite** : le candidat est l’acteur auquel la position peut être attribuée, mais le document reste publié par le parti. Les interfaces et les données machine-readable conservent cette distinction afin qu’un lecteur puisse toujours remonter au propriétaire réel de la source.

Cette règle ne transforme pas non plus un programme de parti en déclaration personnelle : lorsqu’une source directement produite par le candidat existe, elle reste distinguée et peut être privilégiée comme preuve personnelle.

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

## Propositions atomiques et canon

Une proposition atomique exprime une seule mesure, orientation ou promesse principale. Elle doit être rattachée à un document source, avec date, statut, contexte et degré de certitude.

Une même mesure ne doit pas être recréée à chaque nouvelle occurrence. Lorsqu’une nouvelle source vérifiée confirme un claim canonique existant, le système conserve le claim unique et lui rattache la nouvelle preuve. Les identifiants des documents sources, leurs URL et leurs empreintes peuvent donc être multiples pour une même proposition.

Un rattachement automatique de doublon n’est accepté que si la cible canonique existe et conserve au minimum le même acteur et le même thème. En cas d’ambiguïté, le système préfère ne pas fusionner. Rejouer une même source ou une même veille doit être idempotent : aucune proposition ni provenance identique ne doit être créée une seconde fois.

Les contradictions ou changements documentés ne sont jamais assimilés à de simples doublons. Ils restent traçables séparément et utilisent, lorsqu’il y a remplacement explicite, les mécanismes de version décrits plus bas.

## Ce que signifie « vérifié »

Dans ce dépôt, la vérification porte d’abord sur **l’attribution et la fidélité documentaire** : la source doit permettre d’établir que la personnalité, le parti ou l’organisation concernée a bien annoncé, proposé, déclaré ou publié l’information enregistrée.

Le label de vérification **ne signifie pas** que la mesure est jugée réalisable, financée, juridiquement applicable, constitutionnelle, économiquement efficace ou politiquement souhaitable. L’évaluation de faisabilité ou d’impact n’est pas l’objet du corpus à ce stade.

Une affirmation quantitative qui prétend décrire un effet réel, un coût, une économie ou un résultat extérieur à la simple déclaration de l’acteur nécessite donc des preuves adaptées à cette affirmation ; la seule source de campagne ne transforme pas automatiquement cette estimation en fait établi.

## Sources

La priorité va aux sources primaires : sites officiels, communiqués, PDF de campagne, documents institutionnels, transcriptions officielles et comptes sociaux dont l’identité a été vérifiée. Les sources secondaires servent à découvrir, contextualiser ou confirmer lorsqu’aucune source primaire n’est disponible.

Une pluralité de liens n’est pas automatiquement considérée comme une pluralité de confirmations indépendantes. Les reprises d’une même source ou d’un même contenu doivent rester rattachées à leur provenance plutôt que gonfler artificiellement le niveau de preuve.

## Versions

Les anciennes versions ne doivent pas être supprimées. Une nouvelle version doit remplacer explicitement une ancienne via les champs `supersedes` et `superseded_by`.

Le **chatbot courant** et les vues présentant l’état actuel excluent les versions `superseded`, `withdrawn`, `archived`, `rejected`, `draft` ou explicitement historiques. Une ancienne version ne doit jamais réapparaître comme position actuelle uniquement parce qu’elle correspond mieux lexicalement à une question.

Le mode **Historique** peut au contraire afficher les anciennes versions, leurs dates, leurs sources et leurs liens de version. L’ordre chronologique seul ne suffit jamais à affirmer un revirement, un abandon ou un remplacement : une évolution est qualifiée comme telle uniquement lorsqu’un statut ou un lien `supersedes` / `superseded_by` le documente.

## Réponses du chatbot

La récupération est déterministe en priorité. Le système doit préférer un refus explicite à une réponse approximative.

- une entité nommée sert de filtre, jamais de preuve suffisante du sujet ;
- lorsqu’une question demande explicitement un « candidat » ou un « parti », le type d’acteur devient une contrainte du retrieval et non un simple mot-clé ;
- un thème reconnu ne peut pas masquer un qualificatif hors corpus ;
- les nombres de la question doivent être compatibles avec les preuves retournées ;
- une position de parti n’est transférée à une personnalité que selon la règle d’attribution officielle décrite plus haut ;
- lorsqu’un programme de parti est attribué au candidat officiellement désigné, le résultat conserve l’identité du parti comme propriétaire de la source ;
- une absence du corpus n’est pas transformée en absence de position ;
- aucun classement politique subjectif n’est déduit automatiquement ;
- les réponses politiques sont composées à partir de formulations présentes dans les données versionnées ou de titres canoniques de propositions.

Le moteur peut élargir son pool interne de résultats avant d’appliquer certaines contraintes de type ou d’attribution. Cet élargissement sert uniquement à préserver le rappel : il ne relâche ni les filtres de pertinence, ni les règles de provenance, ni les seuils de qualité évalués par les benchmarks.

Un classifieur sémantique de secours peut uniquement aider à interpréter une formulation lorsque le retrieval déterministe échoue. Chaque acteur ou concept qu’il propose doit être rattaché à un fragment exact de la question courante, puis la requête obtenue est revalidée par le moteur déterministe. Le classifieur ne rédige jamais les faits ou positions affichés.

### Réponse approfondie

La réponse courte reste le format par défaut. Lorsque le corpus contient réellement davantage de matière pertinente, l’interface peut proposer **Approfondir** dans la même réponse.

L’approfondissement ne lance pas une recherche libre sur Internet et ne demande pas à un modèle de langage d’inventer ou compléter le contenu. Il réutilise le contexte de retrieval déjà résolu, augmente uniquement la profondeur de récupération dans le corpus versionné, suit les relations entre claims canoniques et documents de preuve, puis compose une réponse plus détaillée à partir des passages effectivement récupérés.

Un document source peut appartenir à un parti tout en prouvant une déclaration explicitement attribuée à une personnalité, ou être attribuable au candidat officiellement désigné selon la règle documentée ci-dessus. Dans tous les cas, l’approfondissement conserve séparément **l’acteur politique auquel le claim est attribué** et **le propriétaire réel du document** ; la propriété de la source ne doit jamais devenir une attribution politique par accident.

Les passages supplémentaires d’un document long sont filtrés par proximité avec le claim concerné afin d’éviter qu’un chapitre voisin mais hors sujet apparaisse uniquement parce qu’il se trouve dans le même document.

## Suggestions

Les suggestions de questions doivent être dérivées exclusivement de thèmes et d’acteurs réellement documentés dans les versions actives du corpus. Chaque suggestion est elle-même testée par le moteur déterministe avant affichage ; une suggestion ambiguë, hors corpus ou attribuée au mauvais acteur doit être supprimée.

## Incertitude

En cas de doute, l’entrée doit rester dans un état prudent : `unknown`, `unverified`, `link_only`, `needs_review` ou `attributed_by_secondary_source` selon le cas.

Au niveau de l’interface, une donnée manquante doit être présentée comme **non documentée dans le corpus**, jamais comme une conclusion sur la position politique réelle de l’acteur.
