# Commandes Discord

Les commandes sont réservées au staff, sur un serveur actif. Elles appliquent les mêmes règles que le dashboard : le compte doit être *support* ou *fondateur*, un *support* doit avoir la permission de grade indiquée, et dans le salon d'un ticket restreint, seuls ceux qui peuvent le voir peuvent agir. Les fondateurs ont tous les droits.

## Dans un ticket

| Commande | Permission | Effet |
|---|---|---|
| `/reply` | `reply_ticket` | Répond au membre avec ton pseudo (texte et/ou fichier) |
| `/areply` | `reply_ticket` | Répond anonymement, affiché « Support » |
| `/template` | `reply_ticket` | Envoie un modèle de réponse (autocomplétion, modèles du sujet en tête) ; applique ses actions si c'est une macro |
| `/note` | `reply_ticket` | Ajoute une note interne, jamais envoyée au membre |
| `/claim` · `/unclaim` | `claim_ticket` | S'ajoute aux personnes attribuées, ou s'en retire |
| `/priority` | `reply_ticket` | Faible, Normal ou Urgent |
| `/moveticket` | `reply_ticket` | Change l'étape : Ouvert, En attente, En cours (le salon change de catégorie) |
| `/rename` | `reply_ticket` | Change le titre — le salon porte toujours le même nom |
| `/adduser` · `/removeuser` | `manage_participants` | Ajoute ou retire un participant, prévenu en MP |
| `/vocal` | `reply_ticket` | Ouvre (ou ferme) le salon vocal temporaire du ticket |
| `/merge` | `close_ticket` + `reply_ticket` | Fusionne le ticket dans un autre ticket ouvert du même membre |

Boutons du salon : **Transcript** demande `view_transcripts`, **Fermer** demande `close_ticket`.

## Ailleurs sur le serveur

| Commande | Permission | Effet |
|---|---|---|
| `/contact` | `create_ticket` | Ouvre un ticket pour contacter un membre (message, sujet facultatif) |
| Clic droit sur un message → *Applications* → **Créer un ticket** | `create_ticket` | Transforme un message d'un salon public en ticket avec son auteur |
| `/reopen` | `close_ticket` | Rouvre le dernier ticket fermé d'un membre |
| `/oldtickets` | `view_tickets` | Historique paginé des tickets d'un membre |
| `/gettranscript` | `view_transcripts` | Lien temporaire (10 minutes) vers un transcript |
| `/blacklist` | chef support ou fondateur | Ajouter, retirer, lister les membres bloqués sur ce serveur |
| `/staffstats` | chef support ou fondateur | Statistiques détaillées par membre du staff |

::: tip Masquer le clic droit
Discord affiche « Créer un ticket » à tout le monde. Pour le réserver au staff : Paramètres du serveur → *Intégrations* → ton bot → *Créer un ticket* → rôles autorisés.
:::

## Pour les membres

| Commande | Effet |
|---|---|
| `/mestickets` (en MP avec le bot) | L'état de ses tickets ouverts sur tous les serveurs — aussi par le bouton **Mes tickets** des MP |
