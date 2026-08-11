# Programmes politiques France 2027

Dépôt public, neutre et versionné pour rendre les candidatures, programmes, projets et propositions liés à l’élection présidentielle française de 2027 consultables par des humains comme par des agents/LLM.

> **Important :** une personnalité suivie ici n’est pas nécessairement un candidat officiel. `official_candidate` est réservé à la liste publiée par le Conseil constitutionnel. Les autres statuts décrivent uniquement l’état documentaire connu au jour du snapshot.

## État de la V1

Snapshot politique : **10 août 2026**.

La V1 comprend :

- **40 personnalités suivies** et plus de **25 partis/mouvements** dans `data/entities.json` ;
- des documents politiques sourcés et versionnés dans `corpus/2027/` ;
- des propositions atomiques dans `proposals/` ;
- six modes publics d’exploration : questions-réponses, comparaison, fiches personnalités, thèmes, boussole documentaire et quiz ;
- un index full-text reconstruit automatiquement à partir du contenu complet des Markdown ;
- une recherche pondérée par contenu, rareté, titre, entité, section, thème et type de source ;
- des citations vers le fichier GitHub et la source originale ;
- un fallback déterministe lorsque le LLM est absent, indisponible ou trop lent ;
- des garde-fous explicites contre l’attribution automatique d’un programme de parti à une personnalité ;
- une CI de production couvrant données, sécurité npm, retrieval, benchmark, build et tests navigateur desktop/mobile.

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
lib/retrieval.js
        ↓
API / interface
        ↓
LLM optionnel
        ↓
réponse + citations
```

`data/search-index.json` est reconstruisible à chaque démarrage/build. Les fichiers source du dépôt restent la vérité canonique.

## Règles de neutralité et de preuve

Le système distingue systématiquement :

- statut d’une personnalité ;
- statut d’un document ;
- niveau de confiance de la preuve ;
- certitude d’une proposition ;
- programme de parti et position personnelle ;
- source primaire/directe et source secondaire ;
- document actuel, amendé, remplacé, retiré, brouillon ou archivé.

Le modèle n’est pas autorisé à combler une lacune avec sa mémoire générale. Le contexte factuel fourni au LLM provient exclusivement des passages récupérés dans le corpus. Si les preuves sont insuffisantes, l’interface doit l’indiquer.

## Lancer localement

```bash
cp .env.example .env.local
npm install
npm run dev
```

`predev` et `prebuild` reconstruisent automatiquement l’index full-text.

Variables facultatives pour activer la synthèse LLM :

```text
LLM_API_KEY=...
# OPENAI_API_KEY=...   # alternative acceptée
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5-mini
LLM_TIMEOUT_MS=15000
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

Sans clé LLM, le produit reste fonctionnel en mode déterministe.

## Gates de production

Exécution locale :

```bash
npm run validate:data
npm run test:retrieval
npm run build
npm run test:e2e
```

Les contrôles bloquants incluent notamment :

- fraîcheur du snapshot politique : maximum 14 jours ;
- cohérence des statuts et impossibilité de créer implicitement un `official_candidate` ;
- exigence de source primaire/directe pour un statut candidat à confiance `high` ;
- intégrité des références documents ↔ propositions ;
- seuils minimaux de profondeur du corpus ;
- recherche de mesures de référence via un benchmark avec seuils hit@5 et MRR ;
- rejet des requêtes sans rapport avec le corpus ;
- impossibilité pour le modèle d’introduire une entité absente des preuves récupérées ;
- audit npm de niveau `high` ;
- build Next.js de production ;
- tests Playwright Chromium desktop et mobile.

## Déploiement Netlify

Le dépôt contient `netlify.toml` :

- build : `npm run build` ;
- publish : `.next` ;
- Node.js 22 ;
- fichiers de données nécessaires aux Functions inclus explicitement.

Netlify prend en charge Next.js via OpenNext. Une Edge Function applique également une limite native à `/api/chat` de **8 requêtes par minute**, agrégée par IP et domaine. La route `/api/health` permet de vérifier le snapshot et les compteurs du corpus après déploiement.

Voir `docs/DEPLOYMENT.md` pour la checklist de mise en production et de Deploy Preview.

## Méthode et limites

1. Sources primaires d’abord.
2. Programme de parti ≠ engagement personnel d’une personnalité.
3. Déclaration ≠ investiture ≠ candidature officielle.
4. Absence d’information ≠ opposition.
5. Les évolutions de position doivent rester traçables dans le temps.
6. Les droits de reproduction sont distingués de la simple accessibilité publique.
7. Les niveaux de confiance qualifient la preuve, pas les chances électorales.
8. Le corpus doit afficher ses lacunes plutôt que prétendre à une exhaustivité non démontrée.

Voir `METHODOLOGY.md`, `SOURCES_POLICY.md`, `NEUTRALITY_CHARTER.md`, `RIGHTS_AND_LICENSES.md`, `docs/CHATBOT_ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `research/missing-information.md` et `research/2026-08-v1-verification-report.md`.

## Licence

- code : MIT (`LICENSE-CODE`) ;
- métadonnées originales du projet : CC BY 4.0 (`LICENSE-DATA`) ;
- documents politiques tiers : droits de leurs auteurs/éditeurs respectifs.
