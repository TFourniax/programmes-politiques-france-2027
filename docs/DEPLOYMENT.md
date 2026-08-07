# Déploiement

## Vercel

1. Importer `TFourniax/programmes-politiques-france-2027` dans Vercel.
2. Définir :

```text
LLM_API_KEY=...
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5.2
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

3. Déployer.

La clé API reste côté serveur. Sans clé, le chatbot fonctionne en mode déterministe en renvoyant les passages pertinents du corpus.

## Local

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Vérification

```bash
npm run build
```

Le workflow `.github/workflows/webapp.yml` exécute également le build sur les push et pull requests.
