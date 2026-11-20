# Sauvegardes

## Chaque nuit, chiffrées

Le service `backup` (`docker-compose.backup.yml`, proposé par `setup.sh`) exporte **toutes les bases** de l'instance chaque nuit à 3 h dans le dossier `backups/` :

- `ticketbot-<date>.sql.gz.enc` — l'archive compressée et **chiffrée** (AES-256, clé dérivée de `BACKUP_KEY` par PBKDF2) ;
- `ticketbot-<date>.sql.gz.enc.hmac` — son contrôle d'intégrité (HMAC-SHA256), vérifié avant toute restauration.

Les archives de plus de 30 jours sont supprimées (`BACKUP_KEEP_DAYS`). Sans `BACKUP_KEY`, le service refuse de tourner : rien n'est jamais écrit en clair. Le conteneur n'a que les droits nécessaires pour écrire dans `backups/`.

| Action | Commande |
|---|---|
| Sauvegarder tout de suite | `scripts/backup.sh` |
| Voir les sauvegardes | `ls -l backups/` |
| Restaurer | `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc` |

## La clé

`BACKUP_KEY` est dans le `.env`, et le propriétaire de l'instance la retrouve dans le dashboard : **Paramètres → Accès et sécurité → Clé des sauvegardes** (masquée par défaut, chaque affichage est inscrit au journal de l'instance). Elle n'est montrée qu'au propriétaire, car les archives contiennent tous les serveurs.

::: danger Garde-la hors du serveur
Note `BACKUP_KEY` et `ENCRYPTION_KEY` dans un gestionnaire de mots de passe. Si le serveur est perdu, sans elles les sauvegardes et les transcripts sont **définitivement illisibles**.
:::

## Restaurer

`scripts/restore.sh` vérifie d'abord l'intégrité de l'archive (une archive modifiée ou une mauvaise clé est refusée sans rien toucher), demande confirmation, arrête le bot, remplace les bases et redémarre le bot. Les migrations s'appliquent au démarrage si l'archive vient d'une version plus ancienne.

Pour restaurer sur une **nouvelle machine** : installe le bot, remets ton ancien `.env` (mêmes clés), copie l'archive et son `.hmac` dans `backups/`, puis lance la restauration.

### Un seul serveur

Pour remettre **un seul serveur Discord** dans l'état d'une sauvegarde sans toucher aux autres : **Instance → Santé → Restaurer un serveur**. Choisis l'archive et le serveur, recopie son identifiant pour confirmer. Le bot et les autres serveurs continuent de tourner.

1. Le service de sauvegarde vérifie l'archive (HMAC) et reconstruit la base du serveur dans une base temporaire.
2. Ses tables prennent la place des tables actuelles **en une seule opération** : rien n'est à moitié restauré.
3. Les tables d'avant sont gardées dans `ticketbot_guild_<ID>_prev` : **Annuler la restauration** les remet en place, **Supprimer la copie** les efface. Cette copie n'entre pas dans les sauvegardes nocturnes.
4. Le bot applique ses migrations si l'archive vient d'une version plus ancienne.

En ligne de commande : `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc --guild <ID du serveur>`.

::: tip Pourquoi le service de sauvegarde ?
Le bot ne lit jamais les archives et n'a pas le mot de passe administrateur de la base : il dépose une demande dans `backups/requests`, et c'est le service `backup`, qui a déjà les deux, qui restaure. Le service recharge son script de lui-même quand une mise à jour le modifie (`git pull`) ; au besoin, `docker compose restart backup`.
:::

## Sauvegarde d'un espace, depuis le dashboard

En plus des sauvegardes de nuit de toute l'instance, un **fondateur** télécharge à tout moment une sauvegarde complète de **son espace** : **Paramètres → Sauvegarde → Sauvegarde complète de l'espace**. Il choisit une **phrase de passe** (12 caractères au moins) ; l'archive (`.datick`) contient toutes les tables de l'espace (tickets, messages, contacts, organisations, réglages, base de connaissances, parc, changements…) et ses fichiers (pièces jointes, images de la base). Rien n'en est gardé sur le serveur. Cinq sauvegardes par heure au plus ; chacune est au journal de l'espace.

**Restaurer** : **Instance → Serveurs → Restaurer une sauvegarde** (propriétaire de l'instance), sur le même espace ou un autre, avec la phrase de passe. Toutes les tables de l'espace visé sont remplacées **d'un coup** (une transaction : en cas d'erreur, rien ne change), l'espace est en maintenance le temps de l'opération, les fichiers sont recopiés. Une archive d'une version plus ancienne se restaure (l'espace garde le schéma de la version installée) ; celle d'une version plus récente est refusée. Venue d'un autre espace, elle en reprend aussi les réglages Discord (salons, rôles), à revoir. Les secrets de l'espace (jetons du CRM, des outils…) y restent chiffrés par la clé de l'instance : ils ne servent que sur la même instance.

### Le format, pour la réversibilité

L'archive est aussi l'**export complet** de l'espace, lisible sans Datick :

| Partie | Contenu |
|---|---|
| En-tête | `DATICKS1` (8 octets), sel (16), vecteur d'initialisation (12) |
| Corps | AES-256-GCM, clé = scrypt(phrase de passe, sel, 32 octets, N = 2¹⁵, r = 8, p = 1), du gzip de lignes JSON |
| Fin | Étiquette d'authentification GCM (16 octets) |

Les lignes JSON : d'abord `{ "format": "datick-space", "version": 1, "appVersion", "schemaVersion", "guildId", "guildName", "createdAt", "tables": […] }`, puis une ligne `{ "t": "<table>", "r": { …colonnes } }` par ligne de table (une valeur binaire s'écrit `{ "$b64": "…" }`, les dates telles qu'en base), puis `{ "f": "files/<nom>" | "kb/<nom>", "b64": "…" }` par fichier, et enfin `{ "end": true, "rows": …, "files": … }`.

Pour la déchiffrer sans Datick (Node.js seul, aucune dépendance) :

```bash
DATICK_PASSPHRASE='ta phrase de passe' node scripts/decrypt-space-backup.js datick-espace-….datick > espace.jsonl
```

## Vérification automatique

Une sauvegarde qu'on n'a jamais relue peut être inutilisable le jour où on en a besoin. Avec `BACKUP_VERIFY` dans `.env`, le service relit la dernière archive juste après l'avoir faite : contrôle d'intégrité, déchiffrement, décompression et présence de la fin du dump SQL. Rien n'est écrit en clair pendant la vérification.

| `BACKUP_VERIFY` | Vérification |
|---|---|
| `off` (défaut) | Jamais |
| `weekly` | Le dimanche, après la sauvegarde |
| `daily` | Après chaque sauvegarde |

Pour vérifier tout de suite : `docker compose run --rm backup verify`.

## Ailleurs que sur le serveur

Une sauvegarde sur le même disque ne protège pas d'une panne du disque. Le service facultatif `offsite` (`docker-compose.offsite.yml`) copie les archives, déjà chiffrées, vers un stockage externe grâce à [rclone](https://rclone.org/) : S3, Backblaze B2, Scaleway, OVH Object Storage, SFTP vers une autre machine, Google Drive… Le stockage ne voit jamais rien en clair.

1. Ajoute le fichier à `COMPOSE_FILE` dans `.env`, après celui de la sauvegarde :
   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml:docker-compose.backup.yml:docker-compose.offsite.yml
   ```
2. Crée la destination avec l'assistant de rclone (il pose les questions du fournisseur choisi et écrit `rclone/rclone.conf`, à garder privé) :
   ```bash
   mkdir -p rclone && chmod 700 rclone
   docker compose run --rm --entrypoint rclone offsite config
   ```
3. Indique la destination dans `.env` — le nom choisi à l'étape 2, deux-points, puis le bucket ou le dossier :
   ```
   BACKUP_REMOTE=b2:mon-bucket/ticketbot
   ```
4. Démarre : `docker compose up -d`. Pour tester tout de suite : `docker compose run --rm offsite now`.

Le service envoie les nouvelles archives toutes les 15 minutes et supprime chaque jour, sur la destination, celles qui ont dépassé `BACKUP_KEEP_DAYS`.

## Suivi et alertes

**Instance → Santé** affiche la dernière sauvegarde, la dernière vérification et la dernière copie hors du serveur. Le bot prévient le propriétaire en MP (ou les destinataires de l'[alerte d'erreurs](./instance), webhook compris) quand :

- la dernière sauvegarde a échoué, ou aucune n'a été faite depuis 26 heures ;
- la vérification d'une archive a échoué ;
- la copie hors du serveur a échoué, ou n'a pas eu lieu depuis 26 heures.

Une seule alerte par problème. Le bot ne lit que les fichiers d'état `backups/status/*.json`, jamais les archives.
