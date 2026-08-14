# Releases de recherche

## But
Fournir des snapshots citables, reproductibles et immuables du corpus sans transformer chaque commit de veille en release académique.

## Convention
Les snapshots destinés à la recherche utilisent des tags `dataset-vYYYY.MM[.N]`. Chaque release doit contenir au minimum :
- le commit source ;
- le rapport de couverture ;
- le graphe de provenance dérivé ;
- les schémas ;
- les politiques de méthode, source, droits et correction ;
- un checksum SHA-256 de l'archive.

## Automatisation
Le workflow `research-release.yml` valide le corpus, reconstruit les vues dérivées et attache une archive au tag. Un lancement manuel produit le même paquet comme artifact sans créer artificiellement un tag.

## DOI
Le dépôt est préparé avec `CITATION.cff` et `.zenodo.json`. L'attribution effective d'un DOI nécessite de connecter ce dépôt à un service d'archivage tel que Zenodo puis de publier une release. Cette étape externe ne change pas le canon et ne doit jamais être simulée dans les métadonnées avant qu'un DOI réel existe.

## Version citée
Toute publication utilisant les données devrait citer le tag ou commit exact afin de distinguer les positions qui ont évolué pendant la campagne.
