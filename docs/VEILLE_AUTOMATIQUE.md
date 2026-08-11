# Veille automatique quotidienne

## Objectif

Maintenir une boîte de réception de recherche fraîche autour de l'élection présidentielle française de 2027 sans introduire de coût d'infrastructure et sans contaminer le corpus canonique avec des informations non vérifiées.

La veille est volontairement séparée du corpus :

- `corpus/`, `proposals/` et les registres canoniques ne sont jamais modifiés automatiquement par la veille ;
- les résultats arrivent dans `research/veille/` ;
- chaque résultat conserve sa provenance, son mode de découverte et son état de vérification ;
- une information exploratoire doit ensuite être validée selon `SOURCES_POLICY.md` et `METHODOLOGY.md` avant intégration canonique.

## Sources utilisées en V1

### 1. Sites officiels — coût 0

Le script construit automatiquement la liste des URLs officielles à partir de :

- `registries/sources.yaml` pour les sources de niveau 1 ;
- `registries/parties.yaml` pour les sites et pages programme ;
- `registries/candidates.yaml` lorsque la preuve de statut est elle-même une source officielle.

Pour chaque URL, la veille calcule une empreinte SHA-256 du contenu utile. Une modification produit un événement `official_source_changed`.

Le script inspecte aussi les `robots.txt`, sitemaps XML et flux RSS/Atom détectés afin d'identifier de nouvelles pages pertinentes : programme, proposition, candidature, communiqué, discours, actualité liée à 2027, etc.

Le premier passage constitue une baseline et n'interprète pas les pages déjà présentes comme des nouveautés.

### 2. GDELT — coût 0

GDELT sert de radar presse sur les dernières 24 heures. Les requêtes sont lancées pour les personnalités suivies dans `registries/candidates.yaml`.

Afin de limiter le bruit, la V1 ne conserve par défaut que les résultats provenant de domaines de presse reconnus listés dans `registries/watch.yaml`.

Ces résultats restent `discovery_only` et ne valent jamais validation d'une proposition ou d'un statut.

### 3. Google Search Grounding via Gemini 2.5 Flash-Lite — quota gratuit

Le connecteur est prêt mais facultatif. Il est automatiquement ignoré si le secret GitHub `GEMINI_API_KEY` n'existe pas.

Lorsqu'il est activé, Gemini utilise Google Search pour rechercher les nouveautés des dernières heures sur chaque personnalité suivie. Le pipeline n'utilise pas la réponse du modèle comme vérité : il récupère uniquement les URLs de grounding comme pistes à examiner.

Cela permet d'obtenir la couverture de Google Search sans dépendre d'un moteur SERP payant.

## Sorties

Chaque exécution écrit :

- `research/veille/state.json` : état technique, empreintes et URLs déjà vues ;
- `research/veille/YYYY-MM-DD.jsonl` : événements machine-readable du jour ;
- `research/veille/YYYY-MM-DD.md` : rapport quotidien lisible.

Types d'événements principaux :

- `official_source_changed` ;
- `official_new_url` ;
- `official_new_feed_item` ;
- `press_discovery` ;
- `web_discovery` ;
- `source_fetch_error`.

## Niveaux de confiance

- source officielle détectée : `tier_1_primary_official`, mais `needs_review` tant que le contenu n'a pas été qualifié ;
- presse/GDELT : `tier_3_reliable_secondary` quand le domaine est dans l'allowlist, `discovery_only` ;
- autre résultat Google : `tier_4_exploratory`, `discovery_only`.

Une source peut donc être excellente sans que l'affirmation détectée soit automatiquement intégrée. La qualité de la source et la validation de la donnée restent deux objets différents.

## Exécution automatique

`.github/workflows/daily-watch.yml` s'exécute une fois par jour et peut aussi être lancé manuellement.

Le workflow :

1. installe les dépendances déjà utilisées par le projet ;
2. lance `scripts/daily_watch.py` ;
3. exécute les tests de veille ;
4. commit les fichiers de `research/veille/` uniquement s'ils ont changé.

Le dépôt étant public et utilisant un runner GitHub standard, cette exécution n'ajoute pas de coût d'infrastructure.

## Activation de Google Search Grounding

Créer une clé Gemini API dans Google AI Studio puis ajouter un secret de repository :

`GEMINI_API_KEY`

Aucune autre modification du code n'est nécessaire. En l'absence du secret, la veille officielle + GDELT continue de fonctionner normalement.

## X / Twitter

La configuration contient déjà une section `x`, désactivée en V1. Aucun scraping ni appel API X n'est effectué afin de conserver un coût nul.

Le futur connecteur X devra respecter la même règle :

- collecte de comptes officiels uniquement ;
- lecture incrémentale à partir du dernier post connu ;
- déclaration publique distincte d'un programme officiel ;
- aucun passage automatique dans le corpus canonique ;
- budget de lecture plafonné explicitement avant activation.

## Principe de sécurité éditoriale

Le contenu récupéré sur Internet est de la donnée non fiable et peut contenir des instructions malveillantes ou trompeuses. Le pipeline ne lui accorde aucune autorité d'exécution et n'utilise jamais le contenu d'une page pour modifier les règles de fonctionnement du dépôt.
