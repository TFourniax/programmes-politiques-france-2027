# Publication

## État du dépôt

Ce dépôt est public et destiné à devenir la source canonique du corpus France 2027.

## Import du corpus

Le corpus complet doit être importé en conservant :

- les registres YAML ;
- les fichiers Markdown ;
- les schémas JSON ;
- les fichiers générés reconstructibles ;
- les rapports de recherche ;
- les scripts de validation.

## Commandes attendues après import local

```bash
python -m pip install -r requirements.txt
python scripts/validate.py
python scripts/build_catalog.py
pytest -q
```

## Règle de publication

Ne pas publier comme `current` ou `official` un élément qui n’a pas été vérifié. Les candidatures officielles ne pourront être marquées `official_candidate` qu’après publication de la liste du Conseil constitutionnel.

## Versionnement

Les imports de corpus doivent se faire par lots datés :

- `bootstrap-project` pour la structure ;
- `corpus-pilot` pour le corpus pilote ;
- `deep-research-YYYY-MM-DD` pour les enrichissements de recherche approfondie.
