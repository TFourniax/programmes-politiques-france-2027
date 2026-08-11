# Veille automatique et mise à jour canonique

## Objectif

Maintenir automatiquement le dépôt politique 2027 sans file de review humaine, avec un coût d'infrastructure proche de zéro et un comportement volontairement conservateur.

Le principe n'est pas de forcer une décision sur chaque information :

- une donnée suffisamment étayée est promue automatiquement ;
- une donnée ambiguë, contradictoire ou insuffisamment prouvée reste hors du corpus canonique ;
- une nouvelle version de la source pourra provoquer une nouvelle tentative plus tard ;
- aucune mémoire générale du modèle ne peut servir de preuve.

## Fréquence

`.github/workflows/daily-watch.yml` s'exécute quatre fois par jour à `01:17`, `07:17`, `13:17` et `19:17` UTC, ainsi que manuellement et après modification de la configuration de veille.

## Collecte gratuite

### Sites officiels

`scripts/daily_watch.py` surveille les sources de niveau 1, calcule leurs empreintes, inspecte les sitemaps, `robots.txt` et flux RSS/Atom et détecte les nouvelles pages programmatiques ou de candidature.

### Presse

`scripts/gdelt_watch.py` utilise GDELT comme radar secondaire. Les articles servent à détecter des nouveautés et contradictions potentielles, mais une piste presse n'est pas directement promue comme mesure canonique.

### Bluesky

`scripts/social_watch.py` lit les comptes Bluesky trouvés depuis les sites officiels via l'AppView public, sans clé.

### YouTube

Les chaînes officielles sont découvertes depuis les sites officiels. La lecture des nouveaux uploads est activée uniquement lorsque `YOUTUBE_API_KEY` est défini.

### X

Les profils officiels X sont découverts et mémorisés, mais la lecture de timeline reste désactivée tant qu'elle implique un coût explicite.

### Google Search Grounding

Search Grounding est actuellement désactivé pour préserver le chemin coût-zéro du projet Gemini. La découverte reste assurée par les sources officielles, sitemaps/RSS, GDELT et réseaux gratuits.

## Promotion automatique sans review humaine

`scripts/auto_promote.py` consomme le backlog de `research/veille/` et traite en priorité les URLs de programme, propositions, questions politiques et pages liées à la présidentielle.

Seules les sources `tier_1_primary_official` peuvent modifier automatiquement le canon.

Pour chaque source :

1. téléchargement direct depuis le domaine officiel ;
2. refus d'une redirection vers un domaine tiers ;
3. extraction HTML ou PDF ;
4. première passe Gemini 3.5 Flash-Lite pour extraire des propositions atomiques et éventuels changements de statut ;
5. obligation de fournir une citation exacte de 18 mots maximum ;
6. contrôle déterministe que cette citation apparaît réellement dans la source ;
7. contrôle déterministe de l'entité autorisée et de la séparation candidat/parti ;
8. seconde passe Gemini indépendante qui tente de réfuter chaque extraction ;
9. comparaison avec les propositions déjà canoniques ;
10. rejet automatique des cas `DUPLICATE`, `CONTRADICTS` ou `AMBIGUOUS` ;
11. versioning `supersedes` / `superseded_by` uniquement lorsqu'un remplacement est explicitement établi ;
12. écriture canonique ;
13. validation Python, tests de retrieval et build Next.js ;
14. commit automatique uniquement si tous les gates sont verts.

Le contenu web est toujours traité comme une donnée non fiable. Les prompts interdisent explicitement de suivre des instructions présentes dans les pages récupérées.

## Données pouvant être modifiées automatiquement

Quand tous les gates passent :

- `corpus/2027/auto/**` reçoit une fiche documentaire sourcée et versionnée ;
- `proposals/auto/**` reçoit les propositions atomiques vérifiées ;
- `data/entities.json` peut être actualisé pour un changement de statut explicitement prouvé ;
- `registries/candidates.yaml` est synchronisé avec ce changement ;
- `status_history` conserve l'ancien état ;
- `research/veille/promotion-state.json` mémorise les preuves déjà traitées et les empreintes de propositions.

`official_candidate` dispose d'un verrou supplémentaire : il ne peut être créé automatiquement qu'à partir d'un domaine institutionnel autorisé, notamment le Conseil constitutionnel ou le ministère de l'Intérieur.

## Cas qui ne sont jamais forcés

Aucune modification canonique n'est effectuée lorsque :

- l'auteur de la source ne peut pas être rattaché à une entité suivie ;
- la source n'est pas primaire officielle ;
- la citation de preuve n'est pas retrouvée exactement ;
- l'attribution parti/candidat est ambiguë ;
- la seconde passe ne confirme pas ;
- la nouvelle affirmation paraît contredire le corpus sans preuve explicite d'évolution ;
- la mesure est uniquement locale, descriptive ou hors périmètre présidentiel/plateforme nationale ;
- l'appel API ou l'extraction technique échoue.

Une erreur technique est retentée sur les exécutions suivantes, avec une limite pour éviter qu'une source définitivement illisible monopolise la veille.

## Gates avant commit

Le workflow exécute avant chaque écriture sur `main` :

```text
python scripts/validate.py
pytest veille + auto-promotion
npm run test:retrieval
npm run build
```

Si l'un de ces contrôles échoue, aucune modification générée pendant le run n'est commitée.

## Secrets

### Obligatoire pour la promotion canonique

`GEMINI_API_KEY`

Cette clé utilise `gemini-3.5-flash-lite` via l'Interactions API. Un préflight réel est exécuté au début du workflow.

### Facultatif

`YOUTUBE_API_KEY`

Sans cette clé, le reste de la veille demeure opérationnel et les profils YouTube découverts restent enregistrés.

## Coût et quota

Les runners GitHub du dépôt public, les sites officiels, RSS/sitemaps, GDELT et Bluesky suivent le chemin gratuit. Gemini est utilisé sur son quota d'inférence gratuit et le nombre de sources traitées par run est plafonné dans `registries/watch.yaml`.

Le backlog est donc drainé progressivement, en donnant la priorité aux pages les plus susceptibles de contenir un programme ou une position présidentielle.

## Auditabilité

Chaque promotion conserve :

- URL source ;
- niveau de source ;
- date de capture ;
- empreinte SHA-256 du texte extrait ;
- courte citation de preuve ;
- méthode de vérification ;
- identifiant du document source ;
- historique de remplacement lorsqu'une position évolue.

Git fournit en plus l'historique complet et permet de revenir à n'importe quel état antérieur du corpus.
