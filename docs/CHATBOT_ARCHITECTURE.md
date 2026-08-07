# Architecture du chatbot

## Principe

GitHub reste la source de vérité publique. La V1 charge `data/corpus.json`, qui référence les fichiers Markdown et les sources originales, puis effectue une recherche lexicale pondérée avant toute génération.

```text
data/corpus.json + corpus/**/*.md + proposals/**/*.md
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

## Garde-fous

- aucun accès web en direct pendant une réponse ;
- le modèle reçoit uniquement les passages récupérés ;
- aucune position n'est déduite d'une étiquette idéologique ;
- programme de parti et programme personnel restent séparés ;
- les cartes de sources sont construites par le serveur et non inventées par le LLM ;
- si le corpus ne suffit pas, la réponse doit le dire ;
- le contenu politique est traité comme donnée non fiable et ne peut jamais modifier les instructions système.

## Évolution

Lorsque le corpus grandira, le retrieval lexical pourra être remplacé ou complété par BM25, embeddings et reranking sans modifier le format canonique des documents.
