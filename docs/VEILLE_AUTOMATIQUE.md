# Veille automatique et mise à jour canonique

## Objectif

Maintenir automatiquement le dépôt politique 2027 sans file de review humaine, avec un coût d'infrastructure proche de zéro et un comportement volontairement conservateur.

Le principe n'est pas de forcer une décision sur chaque information :

- une donnée suffisamment étayée est promue automatiquement ;
- une donnée ambiguë, contradictoire, ancienne ou insuffisamment prouvée reste hors du corpus canonique courant ;
- une erreur technique est conservée dans une file de retry durable ;
- une indisponibilité Gemini retarde la promotion mais n'interrompt jamais la collecte ;
- aucune mémoire générale du modèle ne peut servir de preuve.

## Fréquence et autonomie

`.github/workflows/daily-watch.yml` s'exécute quatre fois par jour à `01:17`, `07:17`, `13:17` et `19:17` UTC, ainsi que manuellement et après modification de la configuration de veille.

Un second workflow, `.github/workflows/watch-health.yml`, agit comme dead-man quatre fois par jour. Il vérifie que la collecte est suffisamment récente et que la promotion IA n'est pas indisponible durablement. En cas de dépassement du SLO, il ouvre ou met à jour automatiquement une issue GitHub `[AUTO] Veille politique dégradée`, puis la ferme automatiquement lorsque le système récupère.

L'état agrégé est conservé dans `research/veille/health.json` et exposé dans `/api/health`.

## Collecte gratuite

### Sites officiels

`scripts/daily_watch.py` surveille les sources de niveau 1, calcule leurs empreintes, inspecte les sitemaps, `robots.txt` et flux RSS/Atom et détecte les nouvelles pages programmatiques ou de candidature.

### Presse

`scripts/gdelt_watch.py` utilise GDELT comme radar secondaire. Les articles servent à détecter des nouveautés et contradictions potentielles, mais une piste presse n'est pas directement promue comme mesure canonique.

### Bluesky

`scripts/social_watch.py` découvre les liens Bluesky depuis les sites officiels et lit l'AppView public sans clé. `scripts/verify_social.py` vérifie ensuite l'identité du profil à partir de son profil public : un lien intégré ou cité sur une page officielle n'est jamais suffisant à lui seul.

### YouTube

Les chaînes sont découvertes depuis les sites officiels. Avec `YOUTUBE_API_KEY`, leur identité et leurs nouveaux uploads sont vérifiés via YouTube Data API avant qu'une publication puisse devenir une preuve candidate.

### X

Les liens X sont conservés comme pistes de découverte uniquement. Aucun compte n'est qualifié d'officiel sur la seule base d'un lien trouvé dans une page, et aucune timeline n'est lue tant qu'il n'existe pas de contrôle d'identité et de lecture compatible avec l'objectif de coût nul.

### Google Search Grounding

Search Grounding est actuellement désactivé pour préserver le chemin coût-zéro du projet Gemini. La découverte reste assurée par les sources officielles, sitemaps/RSS, GDELT et réseaux gratuits.

## Promotion automatique sans review humaine

`scripts/auto_promote_runner.py` applique le gate canonique aux pages web et PDF officielles. `scripts/promote_social.py` réutilise le même gate pour les publications de profils sociaux dont l'identité a déjà été vérifiée.

Seules les sources `tier_1_primary_official` peuvent modifier automatiquement le canon.

Pour chaque source :

1. vérification de provenance et d'identité ;
2. téléchargement/extraction directe pour le web et les PDF, ou texte exact de la publication sociale vérifiée ;
3. exclusion déterministe des pages explicitement rattachées à une ancienne élection lorsqu'elles ne constituent pas une réaffirmation 2027 ;
4. découpage des documents longs en chunks persistants ;
5. traitement progressif de tous les chunks sur plusieurs runs si nécessaire ;
6. première passe Gemini 3.5 Flash-Lite pour extraire des propositions atomiques et éventuels changements de statut ;
7. sortie contrainte par un JSON Schema fermé : acteurs, thèmes, certitudes et statuts sont des enums contrôlés ;
8. obligation de fournir une citation exacte de 18 mots maximum ;
9. contrôle déterministe que cette citation apparaît réellement dans la source ;
10. contrôle déterministe de l'entité autorisée et de la séparation candidat/parti ;
11. seconde passe Gemini indépendante qui tente de réfuter chaque extraction ;
12. comparaison ciblée avec les propositions courantes du même acteur et du même thème ;
13. rejet automatique des cas `DUPLICATE`, `CONTRADICTS` ou `AMBIGUOUS` ;
14. garde-fou chronologique déterministe : un document plus ancien ne peut jamais superséder une position plus récente ;
15. garde-fou équivalent sur les statuts de candidature : une preuve plus ancienne ne peut pas faire régresser le statut courant ;
16. versioning `supersedes` / `superseded_by` uniquement lorsqu'un remplacement est explicitement établi et chronologiquement valide ;
17. écriture canonique seulement lorsque la source entière éligible a été traitée ;
18. validation Python, audit npm, tests de retrieval, build Next.js et Playwright lorsqu'une donnée canonique change ;
19. commit automatique uniquement si tous les gates sont verts.

Le contenu récupéré est toujours traité comme une donnée non fiable. Les prompts interdisent explicitement de suivre des instructions présentes dans les pages ou publications analysées.

### Règle temporelle fondamentale

Une information peut être vraie sans être une position présidentielle 2027 courante. Une mesure issue explicitement d'une ancienne présidentielle, d'élections européennes, législatives, régionales ou municipales reste historique tant qu'une source actuelle ne la réaffirme pas explicitement.

Une ancienne source peut être conservée pour la traçabilité, mais ne peut jamais :

- devenir silencieusement `current` dans le canon 2027 ;
- superséder une position publiée plus récemment ;
- faire revenir un candidat vers un ancien statut.

### Règle sociale supplémentaire

Une publication sociale ne peut être attribuée qu'à l'entité propriétaire du profil vérifié. Une publication d'un compte de parti ne transfère donc jamais automatiquement une proposition au candidat du parti, et inversement.

## Données pouvant être modifiées automatiquement

Quand tous les gates passent :

- `corpus/2027/auto/**` reçoit une fiche documentaire sourcée et versionnée ;
- `proposals/auto/**` reçoit les propositions atomiques vérifiées ;
- `data/entities.json` peut être actualisé pour un changement de statut explicitement prouvé ;
- `registries/candidates.yaml` est synchronisé avec ce changement ;
- `status_history` conserve l'ancien état ;
- `research/veille/promotion-state.json` mémorise les preuves, chunks, retries et empreintes de propositions ;
- `research/veille/social-profiles-verified.json` contient uniquement les identités sociales ayant franchi le contrôle ;
- `research/veille/social-verified/**` contient les publications sociales réellement éligibles au gate canonique ;
- `research/veille/health.json` matérialise l'état opérationnel de la boucle autonome.

`official_candidate` dispose d'un verrou supplémentaire : il ne peut être créé automatiquement qu'à partir d'un domaine institutionnel autorisé, notamment le Conseil constitutionnel ou le ministère de l'Intérieur. Une publication sociale ne peut donc jamais attribuer ce statut.

## Gestion des erreurs sans intervention humaine

Les erreurs transitoires ne sont jamais abandonnées après un nombre fixe d'essais. Le système conserve leur état et les retente avec un backoff croissant : quelques heures, puis un jour, plusieurs jours et enfin périodiquement.

Cela couvre notamment :

- timeout d'un site officiel ;
- HTTP 429/5xx ;
- indisponibilité temporaire du modèle ;
- erreur ponctuelle d'extraction.

Une panne Gemini n'empêche pas les sites officiels, GDELT, Bluesky et la découverte sociale de continuer à être collectés. La promotion reprend automatiquement lorsque le fournisseur redevient disponible.

## Fraîcheur

La fraîcheur opérationnelle n'est plus confondue avec la date factuelle d'un statut politique.

- `status_as_of` indique la date à laquelle un statut de candidat est étayé ;
- `data/entities.json.snapshot_date` reste un snapshot canonique ;
- `research/veille/health.json.last_collection_success_at` mesure la fraîcheur réelle de la surveillance.

Ainsi, quinze jours sans changement politique réel ne provoquent plus artificiellement l'arrêt du pipeline.

## Gates avant commit

Une modification purement `research/veille/**` est légère et ne déclenche pas inutilement toute la chaîne web.

Lorsqu'une donnée canonique change, le workflow exécute avant le push :

```text
python scripts/validate.py
pytest veille + identité sociale + auto-promotion + health
npm audit --audit-level=high
npm run test:retrieval
npm run build
npm run test:e2e
```

Le validateur vérifie également les invariants de versioning :

- existence des propositions liées ;
- réciprocité `supersedes` / `superseded_by` ;
- même acteur et même thème ;
- absence de cycle ;
- chronologie monotone ;
- exclusion des anciennes élections du canon automatique courant.

Si l'un de ces contrôles échoue, aucune modification générée pendant le run n'est poussée sur `main`.

## Secrets

### Obligatoire pour la promotion canonique

`GEMINI_API_KEY`

Cette clé utilise `gemini-3.5-flash-lite` via l'Interactions API. Sa disponibilité est sondée à chaque run, mais une panne ne bloque jamais la collecte. Les appels de promotion demandent des sorties structurées sous JSON Schema et utilisent un niveau de réflexion faible adapté aux tâches d'extraction/classification.

### Facultatif mais recommandé pour la couverture YouTube

`YOUTUBE_API_KEY`

Sans cette clé, le reste de la veille demeure opérationnel ; les liens YouTube peuvent être découverts mais ne sont ni qualifiés d'identité officielle ni promus tant que le contrôle YouTube n'est pas disponible.

## Coût et quota

Les runners GitHub du dépôt public, les sites officiels, RSS/sitemaps, GDELT et Bluesky suivent le chemin gratuit. Gemini est utilisé sur son quota d'inférence disponible et le nombre de sources/chunks/publications traités par run est plafonné dans `registries/watch.yaml`.

Le backlog est drainé progressivement et durablement, en donnant la priorité aux pages les plus susceptibles de contenir un programme ou une position présidentielle actuelle.

Les commits de télémétrie seuls ne déclenchent plus inutilement la CI web complète ni un nouveau déploiement Netlify ; les changements canoniques, eux, passent toujours les gates complets.

## Auditabilité

Chaque promotion conserve :

- URL source ;
- niveau de source ;
- date de capture ;
- date publiée lorsqu'elle est établie et origine de cette date ;
- empreinte SHA-256 du texte extrait ;
- courte citation de preuve ;
- méthode de vérification ;
- progression des chunks pour les documents longs ;
- identifiant du document source ;
- historique de remplacement lorsqu'une position évolue ;
- pour les réseaux sociaux, état et méthode de vérification d'identité du profil.

Git fournit en plus l'historique complet et permet de revenir à n'importe quel état antérieur du corpus.
