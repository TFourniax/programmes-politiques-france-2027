# Déploiement de la V1

La cible de production recommandée pour cette V1 est **Netlify**. Le dépôt est configuré pour Next.js App Router et reconstruit son index full-text à chaque build.

## 1. Pré-requis avant mise en production

La branche à déployer doit avoir passé les gates suivantes :

```bash
npm run validate:data
npm run test:retrieval
npm run build
npm run test:e2e
```

La CI ajoute également un `npm audit --audit-level=high`.

Ne pas mettre en production une branche dont le snapshot politique est trop ancien : `scripts/validate.py` bloque au-delà de 14 jours.

## 2. Importer le dépôt dans Netlify

Importer :

```text
TFourniax/programmes-politiques-france-2027
```

Les réglages sont fournis dans `netlify.toml` :

```text
Build command : npm run build
Publish       : .next
Node.js       : 22
```

Netlify prend en charge Next.js via OpenNext ; aucun plugin Next.js supplémentaire n’est requis dans le dépôt.

## 3. Variables d’environnement

Le LLM est optionnel. Pour activer la synthèse structurée :

```text
LLM_API_KEY=...
# OPENAI_API_KEY=...   # alternative acceptée
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5-mini
LLM_TIMEOUT_MS=15000
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

La clé reste côté serveur. Sans clé, l’application continue à fonctionner en mode déterministe à partir des passages récupérés dans le corpus.

## 4. Protection de `/api/chat`

`netlify/edge-functions/chat-rate-limit.js` applique une limite Netlify native :

```text
8 requêtes / 60 secondes
agrégation : IP + domaine
```

Le limiteur mémoire présent dans la Route Handler reste un garde-fou local/best-effort ; la limite plateforme est celle sur laquelle s’appuie la protection multi-instance en production Netlify.

## 5. Deploy Preview obligatoire

Avant le premier passage en production :

1. ouvrir la Deploy Preview de la PR de release ;
2. vérifier `/api/health` ;
3. confirmer que `snapshotDate` correspond au snapshot attendu ;
4. vérifier que les compteurs candidats/documents/propositions sont non nuls et cohérents ;
5. tester les six modes de l’interface ;
6. poser plusieurs questions précises avec et sans données disponibles ;
7. vérifier que chaque réponse factuelle renvoie aux sources ;
8. tester une requête hors corpus et confirmer l’absence d’invention ;
9. vérifier au moins une fiche où seul le programme du parti est documenté afin de confirmer que celui-ci n’est pas attribué personnellement ;
10. vérifier desktop et mobile.

## 6. Smoke tests après déploiement

### Santé

```text
GET /api/health
```

Attendu : HTTP 200, `ok: true`, snapshot et compteurs présents.

### Chat

Tester notamment :

- `Qui est déclaré candidat à ce stade ?`
- `Qui propose un SMIC à 2 000 euros ?`
- `Quel programme propose d’abroger Parcoursup ?`
- `Qui propose la retraite à 60 ans ?`
- une requête volontairement sans rapport avec la politique française de 2027.

### Attribution

Contrôler qu’une mesure issue uniquement d’un programme de parti est présentée comme telle et n’est pas transformée en engagement personnel du candidat associé.

## 7. Rollback

En cas de régression :

1. restaurer le dernier déploiement Netlify validé ;
2. ne pas modifier les données canoniques pour masquer un bug applicatif ;
3. corriger dans une branche dédiée ;
4. refaire l’ensemble des gates avant un nouveau déploiement.

L’index `data/search-index.json` est dérivé : il peut être régénéré à partir des sources canoniques du dépôt.

## 8. Vercel

Vercel reste techniquement utilisable comme plateforme secondaire. Les mêmes variables d’environnement et gates de validation s’appliquent, mais la configuration de rate limiting Netlify n’y est évidemment pas utilisée.

## 9. Développement local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Pour simuler le plus fidèlement possible le comportement Netlify avant production, utiliser également une Deploy Preview Netlify en complément des tests locaux et de la CI.
