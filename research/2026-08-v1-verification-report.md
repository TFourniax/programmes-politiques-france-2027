# Rapport de vérification V1 — 9 août 2026

## Objet

Ce rapport documente la passe de consolidation de la V1 du corpus et de l'interface de questions-réponses.

La V1 ne prétend pas que toutes les personnalités suivies sont candidates officielles ni que tous les programmes 2027 sont publiés. Elle vise à rendre explicites trois dimensions séparées :

1. statut de la personnalité ;
2. statut du document ;
3. certitude de la proposition.

## Autorité du statut `official_candidate`

Aucune personnalité du snapshot du 9 août 2026 n'est marquée `official_candidate`.

Ce statut reste réservé à la liste officielle publiée par le Conseil constitutionnel après la procédure de présentation des candidatures.

## Méthode de vérification

Pour les statuts des personnalités, la passe V1 a appliqué la hiérarchie suivante :

1. page de campagne, candidat ou parti directement attribuable ;
2. déclaration directe reproduite par un média identifiable ;
3. source secondaire nationale solide pour recouper et inventorier les candidatures ;
4. aucune donnée de niveau exploratoire n'est promue en statut ferme sans confirmation.

Le champ `status_confidence` qualifie la preuve du statut :

- `high` : source primaire claire, datée et directement attribuable ;
- `medium` : information solide mais dépendant encore d'une source secondaire ou d'une preuve primaire incomplète ;
- `low` : preuve fragile ou ambiguë ;
- `unverified` : piste non confirmée.

Ce niveau n'est jamais un score de probabilité électorale.

## Contrôle transversal

La liste a été confrontée à plusieurs recensements nationaux récents distinguant candidatures déclarées, candidatures probables, primaires, retraits et renoncements.

Cette comparaison sert à détecter les omissions et changements de statut ; elle ne remplace pas une source primaire lorsqu'une source primaire est disponible.

## Corrections importantes apportées à la V1

### Jean-Luc Mélenchon

Le vieux snapshot le classait encore comme `potential`. La V1 le classe `declared_presidential` avec confiance `high`.

La France insoumise a ouvert en juin 2026 la collecte des parrainages d'élus afin de permettre sa candidature à l'élection présidentielle de 2027. Une fiche documentaire dédiée a été ajoutée au corpus.

### Bruno Retailleau

Son historique distingue désormais sa déclaration de candidature de sa désignation comme candidat des Républicains. Son statut courant est `party_designated` : il a déclaré sa candidature puis a été choisi par son parti, sans que cela constitue une candidature officielle au sens du Conseil constitutionnel.

Un entretien programmatique officiel du 31 mai 2026 a été ajouté, ainsi que des propositions atomiques sur le référendum relatif à l'immigration et les étudiants extra-européens.

### Retraits et non-candidatures

La V1 conserve explicitement des statuts tels que `withdrawn` et `not_running` au lieu de supprimer les personnalités de l'inventaire. Cela permet de répondre à des questions temporelles et d'éviter de ressusciter une ancienne candidature dans le chatbot.

### Bernard Cazeneuve

Le snapshot a été actualisé pour refléter sa déclaration de candidature intervenue en juillet 2026, avec un niveau `medium` tant qu'une source primaire de campagne directement archivée dans le corpus n'a pas remplacé la source secondaire utilisée pour le statut.

## Programmes et propositions

Le corpus programmatique reste moins complet que l'inventaire des personnalités. Cette asymétrie est volontairement visible : suivre une personnalité ne signifie pas disposer déjà de son programme présidentiel 2027.

La passe V1 a renforcé des zones déjà sourcées :

- campagne de parrainages de Jean-Luc Mélenchon ;
- relation entre L'Avenir en commun et la présidentielle 2027 ;
- service citoyen de neuf mois dans le programme LFI ;
- propositions de Bruno Retailleau sur la révision constitutionnelle, le référendum et l'immigration ;
- proposition concernant les étudiants extra-européens.

## Architecture de réponse

Le chatbot ne recherche plus seulement dans un résumé JSON central.

À chaque build, le projet :

1. parcourt l'intégralité de `corpus/2027/**/*.md` et `proposals/**/*.md` ;
2. découpe les textes par sections et paragraphes ;
3. attache les métadonnées de provenance et de statut ;
4. produit un index full-text dérivé ;
5. effectue le retrieval avant toute synthèse LLM ;
6. transmet au LLM uniquement les passages récupérés ;
7. génère les cartes de citation côté serveur.

## QA de la V1

La CI doit valider :

- intégrité des frontmatters ;
- unicité des identifiants ;
- relations proposition → document source ;
- absence de promotion implicite en `official_candidate` ;
- construction de l'index full-text ;
- recherche de candidatures ;
- retraite à 60 ans ;
- SMIC à 1 700 € net ;
- Retailleau / immigration ;
- service citoyen de neuf mois ;
- absence de résultat pour une requête artificielle hors corpus ;
- compilation complète de l'application Next.js.

## Limites restantes

La V1 n'est pas un corpus exhaustif de toutes les propositions de tous les candidats.

Restent notamment à faire :

- remplacer progressivement les statuts `medium` par des preuves primaires ;
- intégrer les programmes présidentiels 2027 dès qu'ils sont publiés ;
- atomiser les mesures de façon homogène entre sensibilités ;
- enrichir les thèmes encore peu couverts ;
- conserver les versions successives ;
- augmenter le benchmark de retrieval ;
- ajouter ensuite BM25/vectoriel/reranking uniquement si les métriques démontrent un gain.

## Conclusion

La V1 doit être présentée comme une base **sourcée, traçable et prudente**, pas comme une base définitivement exhaustive.

Lorsqu'une donnée n'est pas suffisamment documentée, le comportement attendu est de rendre cette limite visible plutôt que de compléter par inférence politique ou par mémoire générale du modèle.
