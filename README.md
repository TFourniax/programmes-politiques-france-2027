# Programmes politiques France 2027

Dépôt public, neutre et versionné pour rendre les programmes, projets et positions liés à l’élection présidentielle française de 2027 facilement consultables par des humains comme par des agents/LLM.

> **Important :** une personnalité suivie ici n’est pas nécessairement un candidat officiel. Les statuts `potential`, `declared_primary`, `declared_conditional`, `declared_presidential`, `party_designated` et `official_candidate` sont volontairement distincts. `official_candidate` est réservé à la liste publiée par le Conseil constitutionnel.

## Ce que contient la V1

- **40 personnalités suivies** ;
- **22 partis et mouvements** ;
- **13 documents** qualifiés et datés ;
- **7 propositions atomiques** ;
- un registre central `data/corpus.json` ;
- des documents politiques en Markdown dans `corpus/` ;
- des mesures atomiques dans `proposals/` ;
- une interface Next.js pour questionner la base ;
- un moteur de retrieval qui ne cherche que dans le dépôt ;
- des réponses accompagnées des fichiers GitHub et sources originales utilisés.

Le corpus est **vivant** : il doit être enrichi jusqu’au scrutin. Les lacunes connues sont consignées dans `research/missing-information.md`.

## Lancer le chatbot

```bash
cp .env.example .env.local
npm install
npm run dev
```

Sans `LLM_API_KEY`, le moteur fonctionne en mode déterministe et renvoie les passages les plus pertinents du corpus. Avec une clé, le modèle produit une synthèse à partir de ces passages uniquement.

Variables :

```text
LLM_API_KEY=...
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-5.2
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/TFourniax/programmes-politiques-france-2027
```

## Architecture

```text
data/corpus.json
corpus/**/*.md
proposals/**/*.md
        ↓
lib/retrieval.js
        ↓
app/api/chat/route.js
        ↓
LLM optionnel
        ↓
Réponse + citations GitHub + sources originales
```

Le modèle n’est jamais autorisé à compléter une lacune avec sa mémoire générale. Une absence de donnée doit produire « non trouvé dans le corpus », pas une supposition.

## Principes de neutralité

1. Sources primaires d’abord.
2. Programme de parti ≠ programme personnel d’un candidat.
3. Déclaration ≠ investiture ≠ candidature officielle.
4. Une absence d’information ≠ opposition.
5. Les anciennes versions restent identifiables comme telles.
6. Les droits de reproduction sont distingués de la simple accessibilité publique.

Voir `METHODOLOGY.md`, `SOURCES_POLICY.md`, `NEUTRALITY_CHARTER.md`, `RIGHTS_AND_LICENSES.md` et `AGENTS.md`.

## Déploiement

Le projet est compatible Vercel. Connecter ce dépôt, définir les variables d’environnement ci-dessus et déployer. Le workflow `.github/workflows/webapp.yml` vérifie également le build Next.js.

## Licence

- code : MIT (`LICENSE-CODE`) ;
- métadonnées originales du projet : CC BY 4.0 (`LICENSE-DATA`) ;
- documents politiques tiers : droits de leurs auteurs/éditeurs respectifs.
