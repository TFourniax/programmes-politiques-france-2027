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

La veille automatique applique également ces gates complets **avant tout push contenant une modification canonique**, y compris lorsqu'une promotion crée de nouveaux fichiers non encore suivis par Git.

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
LLM_RETRIEVAL_FALLBACK_ENABLED=true
LLM_FALLBACK_API_KEY=...
# OPENAI_API_KEY=...  # alternative acceptée
# LLM_API_KEY=...     # compatibilité historique uniquement
LLM_FALLBACK_API_URL=https://api.openai.com/v1/chat/completions
LLM_FALLBACK_MODEL=gpt-5-nano
LLM_FALLBACK_TIMEOUT_MS=5500
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

La clé reste côté serveur. Le fallback ne rédige jamais la réponse politique. Sans clé, en cas de timeout, quota ou panne fournisseur, le chatbot continue en mode déterministe.

Les anciennes variables génériques `LLM_API_URL` / `LLM_MODEL` du chatbot génératif ne pilotent pas ce fallback : l’intégration de secours est volontairement isolée.

## 4. Protection de `/api/chat`

`netlify/edge-functions/chat-rate-limit.js` applique la limite plateforme :

```text
30 requêtes / 60 secondes
agrégation : IP + domaine
```

Cette limite laisse un utilisateur explorer rapidement le corpus tout en bornant les abus. La Route Handler conserve une défense locale équivalente. Le **fallback sémantique LLM reste, lui, limité à 2 tentatives par minute et par client**, indépendamment de la limite générale.

Le fournisseur est protégé par un timeout court, un retry borné uniquement lorsqu’une complétion structurée revient vide, et un circuit breaker après erreurs techniques répétées. Les maps mémoire locales sont bornées ; elles ne constituent toutefois pas la protection multi-instance principale, qui reste la limite Netlify Edge.

## 5. Deploy Preview obligatoire

Avant le passage en production :

1. ouvrir la Deploy Preview de la PR de release ;
2. vérifier `GET /api/health` ;
3. confirmer `ok: true`, le snapshot et les compteurs ;
4. contrôler que `deployment.commitRef` correspond exactement au head de la PR ;
5. contrôler `chat.engine = deterministic-bm25-ontology-v4` ;
6. contrôler `chat.responseGeneration = deterministic_extractive` ;
7. contrôler `chat.semanticFallback.enabled` et, si le fallback doit être actif, `configured: true` ;
8. tester les **sept modes** : Questionner, Comparer, Candidats, Thèmes, Historique, Boussole et Quiz ;
9. poser plusieurs questions précises avec et sans données ;
10. vérifier qu’un thème valide assorti d’un qualificatif hors corpus est refusé ;
11. vérifier une comparaison avec un acteur non documenté sur le thème : la lacune doit être explicite, pas transformée en position ;
12. vérifier qu’une position de parti n’est pas attribuée automatiquement à une personnalité ;
13. poser plusieurs questions successives puis recliquer sur une ancienne `Source N` : elle doit toujours ouvrir les sources de cette ancienne réponse ;
14. vérifier les suggestions : elles doivent être liées au parcours et toutes répondables ;
15. ouvrir Historique sur un acteur/thème et vérifier que les anciennes versions sont séparées de l’état actuel ;
16. vérifier desktop et mobile, y compris l’absence de débordement horizontal des vues denses ;
17. vérifier qu’un burst de navigation humaine normale reste accepté par le rate limit.

Le workflow `Deploy preview smoke` attend automatiquement le **SHA exact** avant d’exécuter ses assertions ; un ancien preview encore en cache ne peut donc plus donner un faux vert ou un faux rouge.

## 6. Enrichissement autonome

La veille de production combine plusieurs radars complémentaires :

- sites, sitemaps, feeds découverts sur les domaines officiels ;
- flux officiels directs explicitement configurés lorsque le HTML public est protégé contre les robots ;
- profils sociaux vérifiés ;
- radar presse GDELT uniquement pour la découverte secondaire.

Un flux RSS officiel utilisé comme fallback de disponibilité sert **uniquement à découvrir des URL/titres**. Un titre de feed ne suffit jamais à créer une proposition canonique : la promotion exige toujours le contenu primaire complet et les garde-fous de preuve habituels.

Lorsqu’une promotion crée ou modifie des données dans `corpus/2027`, `proposals`, `data/entities.json` ou `registries/candidates.yaml`, le workflow détecte aussi les **fichiers non suivis** via `git status --porcelain --untracked-files=all`, puis exécute audit, retrieval QA, build et Playwright avant le push.

Les erreurs d’un radar secondaire comme GDELT ne bloquent pas la collecte primaire. Une source officielle durablement indisponible est en revanche suivie par le health/dead-man ; une voie alternative n’est déclarée saine que si elle est elle-même un endpoint officiel vérifiable.

## 7. Smoke tests API

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

## 8. Versions actuelles et historiques

Le retrieval courant exclut les entrées `superseded`, `withdrawn`, `archived`, `rejected`, `draft` ou historiques. Ces entrées restent dans Git et sont consultables dans le mode Historique.

Ne jamais modifier ou supprimer une ancienne donnée uniquement pour l’empêcher d’apparaître dans le chatbot : corriger le statut/versionnement ou le moteur dérivé.

## 9. Rollback

En cas de régression :

1. restaurer le dernier déploiement Netlify validé ;
2. ne pas modifier les données canoniques pour masquer un bug applicatif ;
3. corriger dans une branche dédiée ;
4. refaire l’ensemble des gates ;
5. ne repasser en production qu’après Deploy Preview verte.

`data/search-index.json` reste un artefact dérivé et peut être régénéré.

## 10. Plateformes alternatives

Une autre plateforme Next.js reste techniquement possible, mais il faut y reproduire explicitement le rate limiting plateforme. La configuration Netlify Edge ne s’applique pas automatiquement ailleurs.

## 11. Développement local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Les tests locaux valident la logique. La Deploy Preview reste nécessaire pour valider le packaging serverless, les variables d’environnement et la protection plateforme.
