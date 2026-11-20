# High availability

Datick usually runs in **one** `bot` container. So that a failure of this container (or of its machine) does not cut the support off, you can run **several** on the same database and the same Redis: an **active–passive** high availability.

## How it works

- Only one container is **active**: the one holding the **lock** `leader:main` in Redis (20 seconds, renewed every 5 seconds). It connects to Discord, migrates the databases, runs the scheduled jobs and serves the dashboard.
- The others are **standing by**: their web server answers `/api/health` (alive, for Docker), but `/api/health/ready` answers **503**. The proxy therefore only sends traffic to the active one.
- When the active one stops, it **releases the lock**: a standby takes it within seconds. If it goes down without releasing it (machine failure), the lock expires and another one takes it in **about twenty seconds**.
- An active container that loses the lock (Redis unreachable, lock taken by another) **stops** at once: there are never two active containers. Docker restarts it, as a standby.
- **Sessions**, limits, real-time events and job queues already live in Redis: nobody is signed out when the active container changes (the dashboard reconnects by itself).

## Setting it up

With Caddy (`docker-compose.caddy.yml`), add `docker-compose.ha.yml`, which creates a second `bot-standby` container and a Caddyfile sending the traffic to the ready container:

```bash
# .env
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml:docker-compose.ha.yml
```

```bash
docker compose up -d
docker compose exec bot wget -qO- http://localhost:3000/api/health          # "role":"leader" or "standby"
```

With another proxy (Traefik, Nginx, HAProxy, a cloud load balancer), declare the containers as **upstreams** and use `/api/health/ready` as the **health check**: only the active one answers 200.

So that the machine itself is no longer a single point of failure, the containers go on **several machines**, with:

- a **replicated MariaDB** (Galera, or primary / replica with failover);
- a **highly available Redis** (Redis Sentinel, or a managed Redis);
- the **attachments** folder (`/app/data`) on shared storage (NFS, replicated volume).

## Good to know

- Failover takes up to about twenty seconds; meanwhile the dashboard shows « reconnecting ».
- `HA_LOCK_TTL_MS` changes the lock duration (20,000 by default; shorter = faster failover, but more sensitive to a slow Redis).
- A single container works as before: it takes the lock on start.
