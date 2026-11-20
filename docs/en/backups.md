# Backups

## Every night, encrypted

The `backup` service (`docker-compose.backup.yml`, offered by `setup.sh`) exports **every database** of the instance every night at 3 am into the `backups/` folder:

- `ticketbot-<date>.sql.gz.enc` — the compressed and **encrypted** archive (AES-256, key derived from `BACKUP_KEY` by PBKDF2);
- `ticketbot-<date>.sql.gz.enc.hmac` — its integrity check (HMAC-SHA256), verified before any restore.

Archives older than 30 days are deleted (`BACKUP_KEEP_DAYS`). Without `BACKUP_KEY`, the service refuses to run: nothing is ever written in clear. The container only has the rights it needs to write into `backups/`.

| Action | Command |
|---|---|
| Back up right now | `scripts/backup.sh` |
| List the backups | `ls -l backups/` |
| Restore | `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc` |

## The key

`BACKUP_KEY` is in `.env`, and the owner of the instance finds it in the dashboard: **Settings → Access and security → Backup key** (hidden by default, each display is written to the instance log). Only the owner sees it, because the archives hold every server.

::: danger Keep it off the server
Store `BACKUP_KEY` and `ENCRYPTION_KEY` in a password manager. If the server is lost, without them the backups and the transcripts are **permanently unreadable**.
:::

## Restore

`scripts/restore.sh` first checks the integrity of the archive (a modified archive or a wrong key is refused without touching anything), asks for confirmation, stops the bot, replaces the databases and restarts the bot. Migrations apply at start-up if the archive comes from an older version.

To restore on a **new machine**: install the bot, put your old `.env` back (same keys), copy the archive and its `.hmac` into `backups/`, then run the restore.

### A single server

To put **a single Discord server** back to the state of a backup without touching the others: **Instance → Health → Restore a server**. Pick the archive and the server, type its ID again to confirm. The bot and the other servers keep running.

1. The backup service checks the archive (HMAC) and rebuilds the server's database in a temporary database.
2. Its tables replace the current ones **in a single operation**: nothing is half restored.
3. The previous tables are kept in `ticketbot_guild_<ID>_prev`: **Cancel the restore** puts them back, **Delete the copy** erases them. This copy is not part of the nightly backups.
4. The bot applies its migrations if the archive comes from an older version.

From the command line: `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc --guild <server ID>`.

::: tip Why the backup service?
The bot never reads the archives and does not have the database administrator password: it drops a request into `backups/requests`, and the `backup` service, which already has both, does the restore. The service reloads its script by itself when an update changes it (`git pull`); if needed, `docker compose restart backup`.
:::

## Backup of a space, from the dashboard

On top of the nightly backups of the whole instance, a **founder** downloads at any time a full backup of **their space**: **Settings → Backup → Full backup of the space**. They choose a **passphrase** (12 characters at least); the archive (`.datick`) holds every table of the space (tickets, messages, contacts, organisations, settings, knowledge base, inventory, changes…) and its files (attachments, knowledge base images). Nothing of it is kept on the server. Five backups an hour at most; each is in the space's log.

**Restore**: **Instance → Servers → Restore a backup** (owner of the instance), on the same space or another, with the passphrase. Every table of the target space is replaced **at once** (one transaction: on an error, nothing changes), the space is in maintenance meanwhile, the files are copied back. An archive of an older version restores (the space keeps the schema of the installed version); one of a newer version is refused. From another space, it also brings its Discord settings (channels, roles), to review. The space's secrets (CRM, tracker tokens…) stay encrypted by the instance key: they only work on the same instance.

### The format, for reversibility

The archive is also the space's **complete export**, readable without Datick:

| Part | Content |
|---|---|
| Header | `DATICKS1` (8 bytes), salt (16), initialisation vector (12) |
| Body | AES-256-GCM, key = scrypt(passphrase, salt, 32 bytes, N = 2¹⁵, r = 8, p = 1), of the gzip of JSON lines |
| End | GCM authentication tag (16 bytes) |

The JSON lines: first `{ "format": "datick-space", "version": 1, "appVersion", "schemaVersion", "guildId", "guildName", "createdAt", "tables": […] }`, then one line `{ "t": "<table>", "r": { …columns } }` per table row (a binary value is written `{ "$b64": "…" }`, dates as in the database), then `{ "f": "files/<name>" | "kb/<name>", "b64": "…" }` per file, and finally `{ "end": true, "rows": …, "files": … }`.

To decrypt it without Datick (Node.js alone, no dependency):

```bash
DATICK_PASSPHRASE='your passphrase' node scripts/decrypt-space-backup.js datick-espace-….datick > space.jsonl
```

## Automatic check

A backup nobody ever read back may be unusable the day you need it. With `BACKUP_VERIFY` in `.env`, the service reads the latest archive back right after making it: integrity check, decryption, decompression and presence of the end of the SQL dump. Nothing is written in clear during the check.

| `BACKUP_VERIFY` | Check |
|---|---|
| `off` (default) | Never |
| `weekly` | On Sundays, after the backup |
| `daily` | After every backup |

To check right now: `docker compose run --rm backup verify`.

## Off the server

A backup on the same disk does not protect you from a disk failure. The optional `offsite` service (`docker-compose.offsite.yml`) copies the archives, already encrypted, to an external storage through [rclone](https://rclone.org/): S3, Backblaze B2, Scaleway, OVH Object Storage, SFTP to another machine, Google Drive… The storage never sees anything in clear.

1. Add the file to `COMPOSE_FILE` in `.env`, after the backup one:
   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml:docker-compose.backup.yml:docker-compose.offsite.yml
   ```
2. Create the destination with the rclone wizard (it asks the questions of the chosen provider and writes `rclone/rclone.conf`, to keep private):
   ```bash
   mkdir -p rclone && chmod 700 rclone
   docker compose run --rm --entrypoint rclone offsite config
   ```
3. Set the destination in `.env` — the name chosen in step 2, a colon, then the bucket or folder:
   ```
   BACKUP_REMOTE=b2:my-bucket/ticketbot
   ```
4. Start: `docker compose up -d`. To test right away: `docker compose run --rm offsite now`.

The service sends new archives every 15 minutes and deletes every day, on the destination, those older than `BACKUP_KEEP_DAYS`.

## Monitoring and alerts

**Instance → Health** shows the last backup, the last check and the last copy off the server. The bot warns the owner by DM (or the recipients of the [error alert](./instance), webhook included) when:

- the last backup failed, or none was made for 26 hours;
- the check of an archive failed;
- the copy off the server failed, or did not happen for 26 hours.

One alert per problem. The bot only reads the status files `backups/status/*.json`, never the archives.
