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

`BACKUP_KEY` est dans le `.env`, et le propriétaire de l'instance la retrouve dans le dashboard : **Paramètres → Sécurité → Clé des sauvegardes** (masquée par défaut, chaque affichage est inscrit au journal de l'instance). Elle n'est montrée qu'au propriétaire, car les archives contiennent tous les serveurs.

::: danger Garde-la hors du serveur
Note `BACKUP_KEY` et `ENCRYPTION_KEY` dans un gestionnaire de mots de passe. Si le serveur est perdu, sans elles les sauvegardes et les transcripts sont **définitivement illisibles**.
:::

## Restaurer

`scripts/restore.sh` vérifie d'abord l'intégrité de l'archive (une archive modifiée ou une mauvaise clé est refusée sans rien toucher), demande confirmation, arrête le bot, remplace les bases et redémarre le bot. Les migrations s'appliquent au démarrage si l'archive vient d'une version plus ancienne.

Pour restaurer sur une **nouvelle machine** : installe le bot, remets ton ancien `.env` (mêmes clés), copie l'archive et son `.hmac` dans `backups/`, puis lance la restauration.

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
