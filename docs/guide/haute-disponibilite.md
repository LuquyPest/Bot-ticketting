# Haute disponibilité

Datick tourne d'habitude dans **un** conteneur `bot`. Pour qu'une panne de ce conteneur (ou de sa machine) ne coupe pas le support, on peut en lancer **plusieurs** sur la même base et le même Redis : c'est une haute disponibilité **active-passive**.

## Comment ça marche

- Un seul conteneur est **actif** : celui qui tient le **verrou** `leader:main` dans Redis (20 secondes, renouvelé toutes les 5 secondes). Il se connecte à Discord, migre les bases, lance les tâches planifiées et sert le dashboard.
- Les autres sont **en attente** : leur serveur web répond à `/api/health` (vivant, pour Docker), mais `/api/health/ready` répond **503**. Le proxy n'envoie donc le trafic qu'à l'actif.
- Si l'actif s'arrête, il **rend le verrou** : un conteneur en attente le prend en quelques secondes. S'il tombe sans le rendre (panne de machine), le verrou expire et un autre le prend en **une vingtaine de secondes**.
- Un conteneur actif qui perd le verrou (Redis injoignable, verrou pris par un autre) **s'arrête** aussitôt : il n'y a jamais deux conteneurs actifs. Docker le relance, en attente.
- Les **sessions**, les limites, les événements temps réel et les files de tâches sont déjà dans Redis : personne n'est déconnecté au changement d'actif (le dashboard se reconnecte tout seul).

## Mettre en place

Avec Caddy (`docker-compose.caddy.yml`), ajoute `docker-compose.ha.yml`, qui crée un second conteneur `bot-standby` et un Caddyfile qui envoie le trafic au conteneur prêt :

```bash
# .env
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml:docker-compose.ha.yml
```

```bash
docker compose up -d
docker compose exec bot wget -qO- http://localhost:3000/api/health          # "role":"leader" ou "standby"
```

Avec un autre proxy (Traefik, Nginx, HAProxy, un répartiteur cloud), déclare les conteneurs en **amont** et utilise `/api/health/ready` comme **contrôle de santé** : seul l'actif répond 200.

Pour que la machine elle-même ne soit plus un point unique de panne, les conteneurs vont sur **plusieurs machines**, avec :

- une base **MariaDB répliquée** (Galera, ou primaire / réplique avec bascule) ;
- un **Redis haute disponibilité** (Redis Sentinel, ou un Redis géré) ;
- le dossier des **pièces jointes** (`/app/data`) sur un stockage partagé (NFS, volume répliqué).

## À savoir

- La bascule prend jusqu'à une vingtaine de secondes ; pendant ce temps, le dashboard affiche « reconnexion ».
- `HA_LOCK_TTL_MS` change la durée du verrou (20 000 par défaut ; plus court = bascule plus rapide, mais plus sensible à un Redis lent).
- Un conteneur seul fonctionne comme avant : il prend le verrou au démarrage.
