# Architecture du chatbot

## Principe

GitHub reste la source de vérité publique. Le chatbot n’utilise pas un LLM pour rédiger librement une réponse politique : il reconstruit un index dérivé depuis les données canoniques, récupère des preuves par un moteur déterministe, puis compose une réponse extractive.

```text
data/entities.json
corpus/2027/**/*.md
proposals/**/*.md
        ↓
scripts/build-search-index.mjs
        ↓
data/search-index.json (généré, non versionné)
        ↓
BM25-like + ontologie + entités + nombres + relevance gates
        ↓
preuve suffisante ? ── oui ───────────────┐
        │                                  │
        non                                │
        ↓                                  │
mini-LLM de compréhension seulement       │
        ↓                                  │
mappings acteur/concept individuellement  │
ancrés dans la question courante           │
        ↓                                  │
requête canonique                          │
        ↓                                  │
revalidation déterministe ─────────────────┘
        ↓
composition extractive
        ↓
citations par réponse + suggestions validées
```

Aucun passage politique n’est donné au mini-LLM de secours pour qu’il « réponde ». Son rôle se limite à aider à mapper une formulation difficile vers des identifiants déjà connus.

## Construction de l'index

Le script de build :

1. charge `data/entities.json` ;
2. parcourt récursivement `corpus/2027/` et `proposals/` ;
3. lit le frontmatter utile ;
4. découpe le Markdown par sections et paragraphes ;
5. génère des chunks chevauchants ;
6. conserve le chemin GitHub, la source originale, les niveaux de preuve, dates et statuts ;
7. conserve aussi les métadonnées de version `recordId`, `proposalStatus`, `supersedes`, `supersededBy` et les documents sources ;
8. écrit `data/search-index.json`, artefact reconstructible.

L'index est régénéré via `predev`, `prebuild` et avant la suite de QA retrieval.

## Retrieval courant

Le moteur public utilise une recherche déterministe et locale :

- normalisation des accents, casse et séparateurs de milliers ;
- stopwords et normalisation morphologique légère ;
- scoring inspiré de BM25 ;
- boosts titre, section, thème, type de source et nature proposition/document ;
- détection explicite des personnalités et partis avec alias sûrs ;
- ontologie contrôlée séparant `aliases` de détection et `retrieval_terms` ;
- anchors obligatoires pour certains concepts sensibles aux faux positifs ;
- compatibilité stricte des nombres ;
- détection des qualificatifs résiduels : un thème valide ne peut plus faire passer une restriction hors corpus ;
- filtres stricts d’entité : demander une personnalité ne transfère jamais automatiquement le programme de son parti ;
- diversification des résultats ;
- refus explicite des classements subjectifs et des inférences par absence.

Les statuts `superseded`, `withdrawn`, `archived`, `rejected`, `draft` et historiques sont exclus du retrieval courant. Ils restent disponibles dans le mode Historique.

## Mini-LLM de secours

Le fallback sémantique n’est tenté que si le moteur déterministe termine sur `insufficient_relevance` ou `empty_query`.

Contraintes :

- modèle léger par défaut `gpt-5-nano` ;
- effort de raisonnement minimal ;
- `high confidence` obligatoire ;
- JSON Schema strict ;
- identifiants limités aux catalogues d’acteurs et concepts ;
- chaque identifiant possède son propre `evidence_span` copié mot pour mot depuis la question actuelle ;
- une entité doit être justifiée par son nom ou son alias ;
- un concept doit être justifié par un fragment sémantique distinct du simple nom de l’acteur ;
- aucun nombre absent de la question ne peut être injecté ;
- les comparaisons doivent disposer de leurs acteurs explicites ou hérités du contexte déterministe ;
- le résultat est transformé en requête canonique puis entièrement revalidé par le moteur déterministe ;
- le fallback ne rédige jamais la réponse ;
- timeout court, un seul retry borné si le fournisseur renvoie une complétion structurée vide, et circuit breaker après erreurs techniques répétées ;
- budget indépendant de **2 tentatives/minute/client**, même si le chat déterministe autorise davantage de navigation.

Sans clé fournisseur, en cas de timeout, de quota ou de panne, le chatbot continue à fonctionner en mode déterministe et préfère répondre « aucune donnée pertinente » plutôt que d’inventer.

## Composition de la réponse

Le composeur :

- sélectionne des phrases réellement présentes dans les preuves récupérées ;
- peut utiliser un titre canonique de proposition versionné ;
- élimine les titres de section et métadonnées techniques ;
- déduplique les formulations proches ;
- conserve la provenance par numéros de source ;
- explicite les acteurs demandés pour lesquels aucune preuve n’a été retrouvée ;
- n’interprète jamais une absence comme une opposition.

Lorsque le fallback a seulement aidé à comprendre la formulation, l’interface l’indique explicitement tout en précisant que la réponse politique reste extractive et revalidée.

## Suggestions contextuelles

Les suggestions « Pour aller plus loin » ne sont pas générées librement. Elles sont construites à partir :

1. du thème courant ;
2. des acteurs présents dans la réponse ;
3. des derniers thèmes/acteurs de la session ;
4. uniquement de couples acteur × concept présents dans les versions actives du corpus.

Chaque suggestion est rejouée dans le retrieval déterministe. Elle est supprimée si elle n’est pas répondable, si elle déclenche un refus ou si elle fuit vers une autre entité.

Un petit `sessionContext` structuré peut être renvoyé par le navigateur, mais ses identifiants sont revalidés côté serveur et ne servent jamais directement de preuve factuelle.

## Historique

`lib/history.js` et `/api/history` lisent les mêmes données versionnées mais autorisent aussi les anciennes versions.

La vue Historique :

- filtre par acteur et éventuellement par thème ;
- distingue versions actives et anciennes ;
- expose dates, statuts et sources ;
- affiche `supersedes` / `superseded_by` lorsqu’ils existent ;
- ne déduit jamais un changement de position du seul ordre chronologique ;
- garde le contexte de parti séparé lorsqu’on consulte une personnalité.

Le corpus peut donc conserver l’historique sans contaminer la réponse « actuelle » du chatbot.

## Sources en conversation

Les citations sont stockées avec chaque message assistant. Les références `Source 1`, `Source 2`, etc. sont relatives à cette réponse précise ; sélectionner une source d’un ancien tour recharge ses propres citations dans la sidebar. Une nouvelle question ne peut donc plus modifier la signification d’un ancien numéro de source.

## Enrichissement automatique

Le produit sépare clairement **découverte** et **preuve canonique** :

- le crawler officiel suit les sites/sitemaps/feeds des partis et candidats ;
- des flux officiels directs peuvent être configurés lorsqu’un site HTML protège les robots ;
- ces flux alternatifs ne créent que des événements de découverte et ne suffisent jamais, par leur seul titre, à promouvoir une position ;
- les profils sociaux doivent être confirmés puis vérifiés avant toute promotion ;
- GDELT reste un radar secondaire `discovery_only` et n’est jamais une source canonique autonome ;
- toute nouvelle donnée canonique passe par les contrôles de provenance, citations exactes, vérification indépendante, chronologie/versionnement et validation du corpus.

Le workflow de veille détecte les modifications **et les nouveaux fichiers non suivis** dans les zones canoniques. En présence d’un changement canonique, il exécute audit dépendances, retrieval QA, build et Playwright avant le push du bot.

## Sécurité et limites d’usage

- aucun accès web en direct pendant une réponse politique ;
- contenu politique traité comme donnée non fiable ;
- payload question limité et historique tronqué ;
- contexte de session borné et validé ;
- détails internes de ranking non exposés intégralement au navigateur ;
- rate limit Netlify Edge : **30 requêtes/minute par IP + domaine** ;
- défense en profondeur équivalente dans la route serveur ;
- budget du fallback LLM plus strict : **2 tentatives/minute/client** ;
- état des maps locales borné pour éviter une croissance mémoire illimitée ;
- `/api/health` expose la disponibilité du moteur/fallback sans exposer les secrets.

La limite générale est volontairement suffisamment haute pour permettre une exploration humaine rapide ou plusieurs utilisateurs derrière une même IP, tandis que la partie potentiellement coûteuse reste fortement bornée.

## QA

`npm run test:retrieval` reconstruit l’index puis exécute :

- retrieval historique existant ;
- benchmark déterministe positif/négatif ;
- fidélité extractive ;
- audit adversarial ;
- tests fallback et suggestions ;
- hardening produit : versions actives, qualificatifs hors corpus, session, rate limit, historique ;
- couverture ontologique des propositions actives ;
- simulations de réponses.

Playwright vérifie également l’API et l’interface desktop/mobile, y compris les parcours multi-tours, la séparation candidat/parti, l’historique, la stabilité des sources par réponse, les vues denses sans débordement horizontal et le comportement de la limite serveur sous navigation soutenue.

Le smoke du Deploy Preview attend le **SHA exact** réellement servi par Netlify, vérifie le fallback sur le fournisseur réel lorsqu’il est configuré et effectue un burst de questions déterministes à travers la vraie couche Edge.

## Évolution

Le moteur reste volontairement sans embeddings tant que les métriques et les usages réels ne montrent pas de déficit nécessitant cette complexité. Si un vector search est ajouté un jour, il restera un index dérivé et soumis aux mêmes filtres de version, d’entité et de preuve ; GitHub restera la source canonique.
