# Programmes politiques France 2027

Dépôt public, neutre et versionné pour rendre les candidatures, programmes, projets et propositions liés à l’élection présidentielle française de 2027 consultables par des humains comme par des agents/LLM.

> **Important :** une personnalité suivie ici n’est pas nécessairement un candidat officiel. `official_candidate` est réservé à la liste publiée par le Conseil constitutionnel. Les autres statuts décrivent uniquement l’état documentaire connu au jour du snapshot.

## Produit public

Le snapshot politique courant est défini dans `data/entities.json` et évolue avec la veille automatisée.

Le produit comprend :

- les personnalités, partis et mouvements suivis dans `data/entities.json` ;
- des documents politiques sourcés et versionnés dans `corpus/2027/` ;
- des propositions atomiques dans `proposals/` ;
- **sept modes publics d’exploration** : questions-réponses, comparaison, fiches personnalités, thèmes, historique versionné, boussole documentaire et quiz ;
- un index BM25-like déterministe reconstruit automatiquement à partir du contenu complet des Markdown ;
- une ontologie politique contrôlée pour comprendre les paraphrases sans transformer un terme vague en preuve ;
- des réponses extractives, sans génération de faits politiques par LLM ;
- un mini-LLM de secours limité à l’interprétation d’une formulation lorsque le retrieval déterministe échoue ;
- une revalidation déterministe obligatoire après toute interprétation du mini-LLM ;
- des suggestions contextuelles construites uniquement à partir de couples acteur × thème réellement répondables dans le corpus ;
- des citations liées à chaque réponse et conservées correctement dans les conversations multi-tours ;
- un mode Historique qui sépare les versions actives des versions remplacées, retirées ou archivées ;
- des garde-fous explicites contre l’attribution automatique d’un programme de parti à une personnalité ;
- une veille automatique multi-radars : sources officielles, flux officiels directs, sociaux vérifiés et radar presse secondaire ;
- une CI de production couvrant données, dépendances, retrieval, benchmark, adversarial QA, hardening, ontologie, build et tests navigateur desktop/mobile.

Le corpus reste **évolutif et non exhaustif** tant que la campagne se poursuit. Les niveaux `high`, `medium`, `low` et `unknown` qualifient la qualité de la preuve disponible, jamais les chances électorales. Une absence d’information dans le corpus ne signifie jamais opposition à une mesure.

## Source de vérité

Les données canoniques utilisées par l’application sont :

```text
data/entities.json          statuts des personnalités et partis suivis
corpus/2027/**/*.md         documents politiques
proposals/**/*.md           propositions atomiques
data/compass.json           questions/thèmes de l’interface
```

L’index de recherche est dérivé :

```text
data/entities.json
corpus/2027/**/*.md
proposals/**/*.md
        ↓
scripts/build-search-index.mjs
        ↓
data/search-index.json      généré, non versionné
        ↓
retrieval déterministe BM25 + ontologie
        ↓
si aucune preuve exploitable : mini-LLM de compréhension uniquement
        ↓
requête canonique revalidée par le retrieval déterministe
        ↓
réponse extractive + citations + suggestions corpus-grounded
```

`data/search-index.json` est reconstructible à chaque démarrage/build. Les fichiers source du dépôt restent la vérité canonique.

## Règles de neutralité et de preuve

Le système distingue systématiquement :

- statut d’une personnalité ;
- statut d’un document ;
- niveau de confiance de la preuve ;
- certitude d’une proposition ;
- programme de parti et position personnelle ;
- source primaire/directe et source secondaire ;
- document actuel, amendé, remplacé, retiré, brouillon ou archivé.

Le chatbot public ne recherche par défaut que les versions actives. Les versions `superseded`, `withdrawn`, `archived`, `rejected`, `draft` ou historiques restent conservées et sont consultables dans le mode **Historique**, mais ne contaminent pas une réponse portant sur l’état actuel.

Aucun modèle n’est autorisé à combler une lacune avec sa mémoire générale. Le mini-LLM éventuel ne reçoit qu’un catalogue d’identifiants d’acteurs et de concepts ; il ne rédige jamais la réponse politique. Chaque mapping qu’il propose doit être justifié par un fragment exact de la question courante, puis le résultat est revalidé par le moteur déterministe.

## Lancer localement

```bash
cp .env.example .env.local
npm install
npm run dev
```

`predev` et `prebuild` reconstruisent automatiquement l’index.

Le produit fonctionne sans clé LLM. Pour activer le fallback sémantique rare :

```text
LLM_RETRIEVAL_FALLBACK_ENABLED=true
LLM_FALLBACK_API_KEY=...
# OPENAI_API_KEY=...  # alternative acceptée
# LLM_API_KEY=...     # compatibilité historique uniquement
LLM_FALLBACK_API_URL=https://api.openai.com/v1/chat/completions
LLM_FALLBACK_MODEL=gpt-5-nano
LLM_FALLBACK_TIMEOUT_MS=5500
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

Le fallback n’est appelé que lorsque la recherche déterministe ne comprend pas suffisamment la formulation. Une panne, un timeout, un quota fournisseur ou une interprétation peu sûre ne bloque jamais le chemin déterministe. La rédaction de la réponse politique reste toujours extractive.

## Enrichissement autonome

La veille planifiée collecte les changements des sources officielles, découvre les nouvelles URL via sitemaps/feeds, surveille les profils sociaux vérifiés et utilise GDELT comme radar de presse secondaire.

Lorsqu’un site officiel protège son HTML contre les robots mais expose un endpoint structuré officiel, un **flux direct** peut être configuré comme radar alternatif. Ce flux sert uniquement à détecter de nouvelles URL : son titre n’est jamais considéré comme une preuve suffisante pour créer une proposition.

Les promotions canoniques restent soumises aux garde-fous de provenance, citations exactes, validation indépendante, chronologie et versionnement. Toute création ou modification canonique — y compris un nouveau fichier encore non suivi par Git — déclenche les gates web complets avant le push automatique.

## Gates de production

Exécution locale :

```bash
npm run validate:data
npm run test:retrieval
npm run build
npm run test:e2e
```

Les contrôles bloquants incluent notamment :

- cohérence et fraîcheur opérationnelle du corpus ;
- impossibilité de créer implicitement un `official_candidate` ;
- intégrité des références documents ↔ propositions et des chaînes de version ;
- exclusion des versions obsolètes du retrieval courant ;
- accès séparé aux versions historiques ;
- seuils hit@5, MRR et rejet hors corpus ;
- questions avec fautes et paraphrases ;
- refus des classements subjectifs et des inférences par absence ;
- rejet de `concept valide + qualificatif hors corpus` ;
- séparation stricte candidat / parti ;
- fidélité extractive des réponses ;
- validation de chaque suggestion par le retrieval déterministe ;
- validation de chaque mapping du fallback par son propre fragment de question ;
- couverture ontologique des propositions actives ;
- cohérence des sources dans les conversations multi-tours ;
- audit npm de niveau `high` ;
- build Next.js de production ;
- tests Playwright Chromium desktop et mobile, y compris vues denses sans débordement horizontal et navigation soutenue.

## Déploiement Netlify

Le dépôt contient `netlify.toml` :

- build : `npm run build` ;
- publish : `.next` ;
- Node.js 22 ;
- fichiers de données nécessaires aux Functions inclus explicitement.

Netlify prend en charge Next.js via OpenNext. Une Edge Function limite `/api/chat` à **30 requêtes par minute**, agrégées par IP et domaine. La route serveur conserve une défense équivalente. Le fallback LLM dispose en plus d’un budget indépendant beaucoup plus strict de **2 tentatives par minute et par client**, ainsi que d’un timeout et d’un circuit breaker en cas d’erreurs techniques répétées.

`/api/health` expose l’état du corpus, de la veille, le SHA réellement déployé et la disponibilité du fallback sans jamais exposer de secret.

Le smoke de Deploy Preview attend que Netlify serve exactement le head de la PR avant ses tests ; il vérifie également le vrai fallback lorsqu’il est configuré et un burst de navigation déterministe à travers la couche Edge.

Voir `docs/DEPLOYMENT.md` pour la checklist de mise en production et de Deploy Preview.

## Méthode et limites

1. Sources primaires d’abord.
2. Programme de parti ≠ engagement personnel d’une personnalité.
3. Déclaration ≠ investiture ≠ candidature officielle.
4. Absence d’information ≠ opposition.
5. Une ancienne version reste traçable mais n’est pas présentée comme actuelle.
6. Une évolution n’est affirmée que si les métadonnées ou la source la documentent explicitement ; l’ordre des dates seul ne crée pas un « revirement ».
7. Les droits de reproduction sont distingués de la simple accessibilité publique.
8. Les niveaux de confiance qualifient la preuve, pas les chances électorales.
9. Le corpus doit afficher ses lacunes plutôt que prétendre à une exhaustivité non démontrée.

Voir `METHODOLOGY.md`, `SOURCES_POLICY.md`, `NEUTRALITY_CHARTER.md`, `RIGHTS_AND_LICENSES.md`, `docs/CHATBOT_ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `research/missing-information.md` et les rapports de vérification versionnés.

## Licence

- code : MIT (`LICENSE-CODE`) ;
- métadonnées originales du projet : CC BY 4.0 (`LICENSE-DATA`) ;
- documents politiques tiers : droits de leurs auteurs/éditeurs respectifs.
