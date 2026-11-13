# Mettre à jour

Les versions sont publiées sur la page [Releases](https://github.com/LuquyPest/Bot-ticketting/releases) avec leurs notes (les mêmes que la page *Patchnotes* du dashboard). Chaque version a son image Docker : `ghcr.io/luquypest/bot-ticketting:v3.0`, et `latest` pointe sur la dernière.

## Mise à jour ordinaire

```bash
scripts/backup.sh                              # par prudence
docker compose pull && docker compose up -d    # nouvelle image, redémarrage du bot seul
docker compose logs -f bot                     # « Tout est prêt » = terminé
```

Les **migrations de base de données s'appliquent toutes seules** au démarrage, pour la base globale et pour chaque serveur Discord, une seule fois chacune et dans l'ordre. Aucune commande à lancer, aucune interruption pour les membres : le bot est indisponible le temps du redémarrage (quelques secondes), les messages privés reçus pendant ce temps sont lus à la reprise.

Pour rester sur une version précise, mets `TICKETBOT_VERSION=v3.0` dans `.env` au lieu de `latest` ; la mise à jour se fait alors en changeant cette valeur.

## Revenir en arrière

Une version antérieure ne connaît pas les migrations plus récentes mais les tolère presque toujours (colonnes en plus). Si une version pose problème : `TICKETBOT_VERSION=` suivi de la version précédente dans `.env`, puis `docker compose up -d`. En cas de doute, restaure la sauvegarde faite avant la mise à jour : `scripts/restore.sh backups/ticketbot-<date>.sql.gz`.

## Sauvegardes chiffrées (v3.0.4)

Les sauvegardes sont désormais chiffrées : ajoute une clé dans `.env` avant la mise à jour, sinon le service `backup` refuse de démarrer.

```bash
echo "BACKUP_KEY=$(openssl rand -hex 32)" >> .env
```

Les anciennes archives `.sql.gz` en clair restent restaurables avec `scripts/restore.sh` ; supprime-les une fois qu'une sauvegarde chiffrée existe.

## Passer de la v2 à la v3.0 (instance personnelle)

La v3.0 abandonne le modèle « service » : plus de panneau super-admin, de managers, de formules, de limites, d'annonces, de page de statut publique ni de validation des serveurs. **Le propriétaire de l'application Discord administre l'instance** depuis la section **Instance** du dashboard, avec sa connexion Discord.

Avant de mettre à jour :

1. Vérifie dans le portail Discord (*General Information*) que le propriétaire de l'application est bien ton compte. Sinon, mets ton ID dans `OWNER_IDS` (`.env`).
2. Les serveurs encore **« en attente »** seront activés au démarrage. Si tu n'en veux pas, retire-les avant (panneau `/sa` de la v2 → Supprimer : le bot les quitte).
3. Sauvegarde : `scripts/backup.sh`.

Puis `docker compose pull && docker compose up -d`. Ensuite :

- retire de `.env` `SA_USERNAME`, `SA_PASSWORD` et `AUTO_APPROVE_GUILDS` (ignorés) ;
- la conservation des transcripts n'est plus une limite par serveur : `TRANSCRIPT_RETENTION_DAYS` (vide = indéfiniment) ;
- les réglages (alerte d'erreurs, démonstration) sont repris ; sur une nouvelle installation, la démonstration est désactivée par défaut ;
- ajoute la sauvegarde nocturne : `:docker-compose.backup.yml` à la fin de `COMPOSE_FILE`.

Les tables de l'ancien modèle restent en base, inutilisées, pour permettre un retour à la v2.24 : `superadmins`, `managers`, `plans`, `announcements`, `status_events`, `sa_auth_logs`, `sa_audit_log`, `sa_settings`. Une fois la v3 adoptée, tu peux les supprimer :

```bash
docker compose exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ticketbot_global -e "ALTER TABLE guilds DROP FOREIGN KEY IF EXISTS fk_guild_approver; DROP TABLE IF EXISTS managers, superadmins, plans, announcements, status_events, sa_auth_logs, sa_audit_log, sa_settings"'
```

## Installations faites avant la v2.24 (config.json + Traefik)

La v2.24 lit la configuration dans `.env` ; `config.json` reste accepté, mais le `docker-compose.yml` ne le monte plus par défaut et le Traefik n'y est plus. Deux options :

**A. Passer au `.env` (recommandé)** — recopie dans `.env` les valeurs de `config.json` :

| `config.json` | `.env` |
|---|---|
| `token` | `DISCORD_TOKEN` |
| `clientId` | `DISCORD_CLIENT_ID` |
| `dashboard.discordClientSecret` | `DISCORD_CLIENT_SECRET` |
| `webServerBaseUrl` | `PUBLIC_URL` (+ `PUBLIC_HOST` = le domaine seul) |
| `dashboard.sessionSecret` | `SESSION_SECRET` |
| `dashboard.encryptionKey` | `ENCRYPTION_KEY` — **indispensable**, sinon les transcripts et secrets 2FA deviennent illisibles |
| `vapid.publicKey` / `privateKey` / `contact` | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTACT` |
| `database.password` | `DB_PASSWORD` (déjà présent) |
| `trustProxyHops` / `trustedProxyHost` | `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_HOST` |

Ajoute `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml` (si tu utilises Traefik), puis `docker compose up -d`. Les réglages rares (`retention`, `rateLimits`, `previousEncryptionKeys`, `database.tenantConnectionLimit`) n'ont pas de variable : garde un `config.json` pour eux (option B) ; il peut ne contenir que ces clés.

**B. Garder `config.json`** — décommente dans `docker-compose.yml` les lignes `volumes` et `user` du service `bot` (ou mets-les dans un `docker-compose.override.yml` à toi), et ajoute `COMPOSE_FILE` + `PUBLIC_HOST` dans `.env` pour Traefik.

## Développement : construire l'image soi-même

`docker compose up -d --build` reconstruit l'image depuis les sources au lieu de la tirer. Le dépôt déclenche la publication d'une version avec `scripts/release.sh vX.Y` (tag Git → action *Release* : image amd64 + arm64 sur GHCR et release GitHub avec les notes des patchnotes).
