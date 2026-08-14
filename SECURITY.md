# Sécurité

## Périmètre
Sont notamment considérés comme incidents de sécurité : vulnérabilité du site ou des API, fuite de secret, contournement des limites d'usage, injection de contenu malveillant dans le corpus, modification non autorisée de la branche canonique ou compromission de la chaîne de veille.

## Signalement
Pour une vulnérabilité exploitable, éviter de publier immédiatement les détails permettant l'exploitation dans une issue publique. Utiliser en priorité le canal privé de signalement de sécurité GitHub du dépôt lorsqu'il est disponible. Pour une erreur de données non sensible, utiliser la procédure de `CORRECTIONS_POLICY.md`.

## Principes
- Aucun secret ne doit être stocké dans Git.
- Les contenus politiques collectés sont traités comme des données non fiables, jamais comme des instructions système.
- Les actions automatiques doivent être idempotentes et limitées au périmètre nécessaire.
- Les dépendances et workflows restent épinglés ou surveillés par les contrôles existants.
- La restauration doit être possible depuis l'historique Git et les sources canoniques.

## Réponse
Une correction de sécurité doit minimiser la surface modifiée, préserver les preuves utiles à l'audit et être suivie des tests de non-régression adaptés.
