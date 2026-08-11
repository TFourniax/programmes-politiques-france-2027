# Déploiement du produit

La cible de production recommandée est **Netlify**. Le dépôt est configuré pour Next.js App Router et reconstruit son index dérivé à chaque build.

## 1. Gates obligatoires avant production

La branche à déployer doit avoir passé :

```bash
npm run validate:data
npm run test:retrieval
npm run build
npm run test:e2e
```

La CI ajoute `npm audit --audit-level=high` et exécute les tests sur la branche/PR avant toute décision de merge.

## 2. Import Netlify

Importer :

```text
TFourniax/programmes-politiques-france-2027
```

Configuration versionnée dans `netlify.toml` :

```text
Build command : npm run build
Publish       : .next
Node.js       : 22
```

Netlify prend en charge Next.js via OpenNext.

## 3. Variables d’environnement

Le produit fonctionne sans LLM. Pour activer le **fallback de compréhension du retrieval uniquement** :

```text
LLM_API_KEY=...
# OPENAI_API_KEY=...   # alternative acceptée
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5-mini
LLM_RETRIEVAL_FALLBACK_ENABLED=true
LLM_FALLBACK_MODEL=gpt-5-mini
LLM_FALLBACK_TIMEOUT_MS=5500
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

La clé reste côté serveur. Le fallback ne rédige jamais la réponse politique. Sans clé, en cas de timeout, quota ou panne fournisseur, le chatbot continue en mode déterministe.

## 4. Protection de `/api/chat`

`netlify/edge-functions/chat-rate-limit.js` applique la limite plateforme :

```text
8 requêtes / 60 secondes
agrégation : IP + domaine
```

La Route Handler conserve une défense locale équivalente et limite en plus les **tentatives de fallback sémantique** à un budget plus strict par IP. Le fournisseur est protégé par un timeout court et un circuit breaker après erreurs répétées. Les maps mémoire locales sont bornées ; elles ne constituent toutefois pas la protection multi-instance principale, qui reste la limite Netlify Edge.

## 5. Deploy Preview obligatoire

Avant le passage en production :

1. ouvrir la Deploy Preview de la PR de release ;
2. vérifier `GET /api/health` ;
3. confirmer `ok: true`, le snapshot et les compteurs ;
4. contrôler `chat.engine = deterministic-bm25-ontology-v4` ;
5. contrôler `chat.responseGeneration = deterministic_extractive` ;
6. contrôler `chat.semanticFallback.enabled` et, si le fallback doit être actif, `configured: true` ;
7. tester les **sept modes** : Questionner, Comparer, Candidats, Thèmes, Historique, Boussole et Quiz ;
8. poser plusieurs questions précises avec et sans données ;
9. vérifier qu’un thème valide assorti d’un qualificatif hors corpus est refusé ;
10. vérifier une comparaison avec un acteur non documenté sur le thème : la lacune doit être explicite, pas transformée en position ;
11. vérifier qu’une position de parti n’est pas attribuée automatiquement à une personnalité ;
12. poser plusieurs questions successives puis recliquer sur une ancienne `Source N` : elle doit toujours ouvrir les sources de cette ancienne réponse ;
13. vérifier les suggestions : elles doivent être liées au parcours et toutes répondables ;
14. ouvrir Historique sur un acteur/thème et vérifier que les anciennes versions sont séparées de l’état actuel ;
15. vérifier desktop et mobile.

## 6. Smoke tests API

### Santé

```text
GET /api/health
```

Attendu : HTTP 200, `ok: true`, compteurs présents, état veille exposé et configuration du fallback visible sans secret.

### Historique

```text
GET /api/history?view=meta
GET /api/history?view=timeline&entity=renaissance&topic=nucleaire
```

Attendu : chronologie versionnée, statuts explicites et aucun changement de position inféré du seul ordre des dates.

### Chat

Tester notamment :

- `Qui est déclaré candidat à ce stade ?`
- `Qui propose un SMIC à 2 000 euros ?`
- `Quel programme propose d’abroger Parcoursup ?`
- `Qui propose la retraite à 60 ans ?`
- `Que propose Renaissance sur l'énergie des licornes ?` → refus ;
- `Qui ne propose pas de retraite par capitalisation ?` → refus d’inférence négative ;
- `Quel est le meilleur programme pour le pouvoir d’achat ?` → refus de classement ;
- une requête totalement hors corpus.

### Fallback réel

Si `semanticFallback.configured: true`, tester une formulation volontairement difficile dont le moteur déterministe ne trouve pas directement la correspondance mais que le catalogue sémantique peut mapper. Attendu :

```text
retrievalAssisted: true
```

La réponse doit rester `generated: false`, disposer de citations et signaler dans sa note que seule la compréhension de la formulation a été assistée.

## 7. Versions actuelles et historiques

Le retrieval courant exclut les entrées `superseded`, `withdrawn`, `archived`, `rejected`, `draft` ou historiques. Ces entrées restent dans Git et sont consultables dans le mode Historique.

Ne jamais modifier ou supprimer une ancienne donnée uniquement pour l’empêcher d’apparaître dans le chatbot : corriger le statut/versionnement ou le moteur dérivé.

## 8. Rollback

En cas de régression :

1. restaurer le dernier déploiement Netlify validé ;
2. ne pas modifier les données canoniques pour masquer un bug applicatif ;
3. corriger dans une branche dédiée ;
4. refaire l’ensemble des gates ;
5. ne repasser en production qu’après Deploy Preview verte.

`data/search-index.json` reste un artefact dérivé et peut être régénéré.

## 9. Plateformes alternatives

Une autre plateforme Next.js reste techniquement possible, mais il faut y reproduire explicitement le rate limiting plateforme. La configuration Netlify Edge ne s’applique pas automatiquement ailleurs.

## 10. Développement local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Les tests locaux valident la logique. La Deploy Preview reste nécessaire pour valider le packaging serverless, les variables d’environnement et la protection plateforme.
