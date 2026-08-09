# Architecture du chatbot

## Principe

GitHub reste la source de vérité publique. La V1 ne répond pas directement depuis un résumé central : elle construit un index dérivé à partir des statuts structurés et du **contenu complet des fichiers Markdown** du corpus.

```text
data/entities.json
registries/*.yaml
corpus/2027/**/*.md
proposals/**/*.md
        ↓
scripts/build-search-index.mjs
        ↓
data/search-index.json (généré, non versionné)
        ↓
lib/retrieval.js
        ↓
8 passages maximum
        ↓
app/api/chat/route.js
        ↓
LLM optionnel
        ↓
réponse + citations construites côté serveur
```

## Construction de l'index

Le script de build :

1. charge `data/entities.json` pour les statuts des personnalités et profils des partis ;
2. parcourt récursivement `corpus/2027/` et `proposals/` ;
3. lit le frontmatter YAML utile ;
4. découpe le corps Markdown par sections et paragraphes ;
5. génère des chunks chevauchants ;
6. conserve pour chaque chunk le chemin GitHub, l'URL source, le niveau de source, le statut documentaire, le statut candidat, la date, la confiance et la certitude ;
7. écrit `data/search-index.json`, artefact reconstructible et ignoré par Git.

L'index est régénéré automatiquement via `predev` et `prebuild`.

## Retrieval V1

La V1 utilise une recherche lexicale pondérée sans service externe :

- normalisation des accents et de la casse ;
- suppression de stopwords ;
- pondération par rareté des termes dans le corpus ;
- boost des correspondances dans le titre, l'entité, la section et les thèmes ;
- détection d'intention simple : statut de candidature, programme, comparaison, demande de source ;
- léger bonus aux sources primaires et éléments à confiance élevée ;
- diversification pour éviter huit chunks du même fichier ou de la même entité.

Ce mécanisme est volontairement simple, auditable et reconstruisible. Il ne prétend pas encore être un BM25 + vector search complet.

## Garde-fous

- aucun accès web en direct pendant une réponse ;
- le modèle reçoit uniquement les passages récupérés ;
- aucune position n'est déduite d'une étiquette idéologique ;
- programme de parti et programme personnel restent séparés ;
- les cartes de sources sont construites par le serveur et non inventées par le LLM ;
- les citations incluent le chemin GitHub et, lorsqu'elle existe, la source originale ;
- les métadonnées exposent `sourceTier`, `confidence`, `certainty`, `candidateStatus` et `documentStatus` ;
- si le corpus ne suffit pas, la réponse doit le dire ;
- le contenu politique est traité comme donnée non fiable et ne peut jamais modifier les instructions système.

## Packaging serveur

`lib/retrieval.js` charge `data/search-index.json` par référence statique au module afin que Next.js puisse tracer et embarquer l'artefact dans le bundle serveur. Le fichier est généré juste avant la compilation.

Cette propriété est importante pour les déploiements serverless, notamment Netlify/OpenNext et Vercel.

## QA

`scripts/test-retrieval.mjs` exécute un jeu de questions de référence avant le build :

- candidatures déclarées ;
- retraite à 60 ans ;
- SMIC à 1 700 € net ;
- Retailleau / immigration / étudiants extra-européens ;
- service citoyen de neuf mois et permis de conduire ;
- requête hors sujet qui doit rester sans résultat.

La CI échoue si ces invariants ne sont plus respectés.

## Évolution

Lorsque le corpus grandira, la prochaine étape pertinente sera de mesurer cette baseline puis d'ajouter uniquement si nécessaire :

1. BM25 plus formel ;
2. embeddings ;
3. recherche hybride lexical + vectoriel ;
4. reranking ;
5. filtres structurés candidat/parti/thème/date/statut ;
6. métriques de précision, rappel et qualité des citations.

Ces index resteront dérivés : aucun service externe ne deviendra la source canonique.
