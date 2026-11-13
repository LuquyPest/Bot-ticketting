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

## Ailleurs que sur le serveur

Une sauvegarde sur le même disque ne protège pas d'une panne du disque. Copie régulièrement `backups/` ailleurs (un autre serveur, un stockage en ligne) : les archives sont chiffrées, elles peuvent voyager sans risque.
