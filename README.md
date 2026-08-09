# Programmes politiques France 2027

Dépôt public, neutre et versionné pour rendre les programmes, projets et positions liés à l’élection présidentielle française de 2027 consultables par des humains comme par des agents/LLM.

> **Important :** une personnalité suivie ici n’est pas nécessairement un candidat officiel. Les statuts `potential`, `declared_primary`, `declared_conditional`, `declared_presidential`, `party_designated` et `official_candidate` sont volontairement distincts. `official_candidate` est réservé à la liste publiée par le Conseil constitutionnel.

## État de la V1

Instantané des statuts : **9 août 2026**.

La V1 fournit :

- **40 personnalités suivies** et **22 partis/mouvements** dans `data/entities.json` et les registres YAML ;
- des documents politiques sourcés et versionnables dans `corpus/2027/` ;
- des propositions atomiques dans `proposals/` ;
- une interface Next.js de questions-réponses ;
- un index full-text reconstruit automatiquement à partir du **contenu complet des Markdown**, et pas seulement de résumés ;
- une recherche lexicale pondérée par rareté, titre, entité, section, thème et type de contenu ;
- des réponses accompagnées des fichiers GitHub et sources originales utilisés ;
- un fallback déterministe lorsque le LLM est absent, indisponible ou trop lent ;
- des tests de retrieval sur des questions politiques réelles et des contrôles de cohérence du corpus.

Le corpus reste **incomplet par construction tant que la campagne évolue**. Un statut peut être `high`, `medium`, `low` ou `unverified` selon la qualité de la preuve disponible. Une absence de document ne signifie jamais absence de position politique.

## Source de vérité et index

Les fichiers canoniques sont :

```text
data/entities.json          statuts des personnalités + partis suivis
registries/*.yaml           registres publics/machine-readable
corpus/2027/**/*.md         documents politiques
proposals/**/*.md           propositions atomiques
```

Au démarrage et au build :

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
app/api/chat/route.js
        ↓
LLM optionnel
        ↓
réponse + citations GitHub + sources originales
```

`data/search-index.json` est un artefact dérivé et reconstructible ; GitHub reste la source canonique.

## Garde-fous du chatbot

Le modèle n’est jamais autorisé à compléter une lacune avec sa mémoire générale. Il reçoit uniquement les passages récupérés dans le dépôt.

Le système distingue notamment :

- statut d’une personne ;
- statut d’un document ;
- niveau de confiance de la preuve ;
- certitude d’une proposition ;
- programme d’un parti et programme personnel d’un candidat ;
- source primaire et source secondaire.

Si le corpus ne contient pas assez d’information, l’interface doit répondre qu’elle ne dispose pas de matière suffisante plutôt que d’inventer.

## Lancer localement

```bash
cp .env.example .env.local
npm install
npm run dev
```

Le script `predev` construit automatiquement l’index full-text.

Sans `LLM_API_KEY` ni `OPENAI_API_KEY`, le moteur fonctionne en mode déterministe et renvoie les passages les plus pertinents du corpus. Avec une clé, le modèle synthétise uniquement les passages récupérés.

Variables :

```text
LLM_API_KEY=...
# OPENAI_API_KEY=...   # alternative acceptée
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5-mini
LLM_TIMEOUT_MS=15000
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

Le modèle par défaut est `gpt-5-mini`. L’API, le modèle et le timeout restent configurables par variables d’environnement. Si l’appel LLM échoue ou dépasse le timeout, l’application retombe sur une réponse déterministe fondée sur les passages récupérés.

## QA

```bash
npm run test:retrieval
python scripts/validate.py
pytest -q
npm run build
```

Les tests de retrieval couvrent notamment :

- recherche des candidatures déclarées ;
- retraite à 60 ans ;
- SMIC à 1 700 € net ;
- propositions de Bruno Retailleau sur l’immigration ;
- service citoyen de neuf mois ;
- contrat des compteurs documents/propositions affichés dans l’interface ;
- requête sans rapport avec le corpus, qui doit produire zéro résultat.

La CI exécute ces contrôles avant le build de l’application.

## Déploiement Netlify

Le dépôt contient `netlify.toml` :

- build : `npm run build` ;
- publish : `.next` ;
- Node.js 22.

Netlify détecte Next.js et utilise son adaptateur OpenNext pour l’App Router et les Route Handlers. Il n’est pas nécessaire d’épingler un plugin Next.js spécifique.

Dans Netlify, ajouter les variables d’environnement si le mode LLM doit être activé :

```text
LLM_API_KEY=...
# ou OPENAI_API_KEY=...
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5-mini
LLM_TIMEOUT_MS=15000
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

Sans clé LLM, l’interface reste utilisable en mode déterministe.

## Méthode et limites

Principes :

1. Sources primaires d’abord.
2. Programme de parti ≠ programme personnel d’un candidat.
3. Déclaration ≠ investiture ≠ candidature officielle.
4. Une absence d’information ≠ opposition.
5. Les anciennes versions restent identifiables comme telles.
6. Les droits de reproduction sont distingués de la simple accessibilité publique.
7. Les niveaux de confiance qualifient la preuve, pas les chances électorales.

Voir `METHODOLOGY.md`, `SOURCES_POLICY.md`, `NEUTRALITY_CHARTER.md`, `RIGHTS_AND_LICENSES.md`, `docs/CHATBOT_ARCHITECTURE.md`, `research/missing-information.md` et `research/2026-08-v1-verification-report.md`.

## Licence

- code : MIT (`LICENSE-CODE`) ;
- métadonnées originales du projet : CC BY 4.0 (`LICENSE-DATA`) ;
- documents politiques tiers : droits de leurs auteurs/éditeurs respectifs.
