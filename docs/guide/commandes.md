# Commandes Discord

Les commandes sont réservées au staff, sur un serveur actif. Elles appliquent les mêmes règles que le dashboard : le compte doit être *support* ou *fondateur*, un *support* doit avoir la permission de grade indiquée, et dans le salon d'un ticket restreint, seuls ceux qui peuvent le voir peuvent agir. Les fondateurs ont tous les droits.

Discord affiche les descriptions, options et choix des commandes **dans la langue de l'application Discord de chacun** : français, anglais, espagnol, allemand, italien ou portugais (anglais pour toute autre langue). Le nom des commandes reste le même partout (`/reply`, `/claim`…) 

Les **réponses du bot au staff** (commandes, boutons, `/setup`) et ses messages dans les salons de tickets et de journal suivent **Paramètres → Général → Langue du bot pour le staff** : français (par défaut), anglais, espagnol, allemand, italien, portugais, ou **automatique** — la langue Discord de chacun pour ce que lui seul voit, celle du serveur pour ce que tout le monde voit. Elle est indépendante de la langue des messages aux membres. Les messages d'erreur détaillés venant du dashboard (déplacement, fusion…) restent en français.

## Configurer le serveur : `/setup`

Pour les **fondateurs** (et le propriétaire de l'instance), visible des membres qui ont *Gérer le serveur*. Un assistant en trois étapes, en message visible de toi seul :

1. **Rôles du staff** : rôles support et, au choix, chef support ;
2. **Catégories** : une par étape (*Ouvert*, *En attente*, *En cours*), existantes ou **créées par le bot**, masquées à tout le monde sauf au staff ;
3. **Panel** : un message avec un bouton « Ouvrir un ticket » dans le salon choisi, ou rien.

Les réglages passent par les mêmes contrôles que le dashboard et apparaissent dans **Paramètres → Sauvegarde → Historique** (source « Assistant /setup »). La suite — sujets, messages, grades, FAQ — se règle sur le dashboard.

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
