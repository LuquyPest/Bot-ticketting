Bot Discord de ticketing avec ce fonctionnement :

- l'utilisateur ouvre son ticket en **message privé** au bot
- le bot crée un **salon ticket** dans le serveur
- le staff répond depuis le salon avec des **slash commands**
- les messages du staff ne partent **jamais** au membre sauf via `/reply` ou `/areply`
- les transcripts sont générés **à la demande** et peuvent être archivés en **HTML**
- la fermeture se fait avec un **bouton unique** : **Fermer et enregistrer le transcript**

## Fonctionnement général

### Côté membre
- envoie un MP au bot
- si aucun ticket n'est ouvert, le bot crée un salon
- les messages suivants sont relayés dans le même ticket

### Côté support
- lit le ticket dans un salon privé
- peut répondre avec son pseudo ou anonymement
- peut déplacer le ticket, renommer le salon, ajouter ou retirer des membres, claim un ticket
- peut générer un transcript ou fermer le ticket avec transcript automatique

## Rôles

### supportRoleId
Rôle support standard.

Peut utiliser :
- `/reply`
- `/areply`
- `/adduser`
- `/removeuser`
- `/rename`
- `/claim`
- `/unclaim`
- `/moveticket`
- `/oldtickets`
- `/gettranscript`
- les boutons ticket

### chiefSupportRoleId
Rôle chef support.

Peut faire tout ce que le support fait, plus :
- `/staffstats`

## Commandes

### `/reply`
Répond au membre avec le pseudo de l'admin.

Options :
- `message` facultatif
- `fichier` facultatif

Il faut au moins un message, un fichier, ou les deux.

### `/areply`
Répond anonymement au membre.

Options :
- `message` facultatif
- `fichier` facultatif

### `/adduser`
Ajoute un utilisateur au ticket avec son ID Discord.

Option :
- `userid`

### `/removeuser`
Retire un utilisateur du ticket avec son ID Discord.

Option :
- `userid`

Le propriétaire du ticket ne peut pas être retiré.

### `/rename`
Renomme le salon ticket.

Option :
- `name`

### `/claim`
Marque le ticket comme pris en charge par l'admin qui exécute la commande.

### `/unclaim`
Retire la prise en charge.

### `/moveticket`
Déplace le ticket dans une autre catégorie par **nom exact**.

Option :
- `categorie`

Exemple :
- `/moveticket categorie: SAV`

### `/oldtickets`
Affiche l'historique des tickets d'un utilisateur dans un embed paginé.

Option :
- `userid`

Visible uniquement au staff car la réponse est éphémère.

### `/gettranscript`
Récupère un transcript HTML déjà enregistré avec son ID.

Option :
- `transcriptid`

### `/staffstats`
Affiche les statistiques staff.

Réservé au **chef support**.

Affiche :
- nombre de tickets claim
- nombre de tickets fermés

## Boutons présents dans un ticket

### `Transcript`
- génère un transcript HTML + TXT à partir du salon actuel
- enregistre le snapshot en base
- renvoie l'ID du transcript

### `Fermer et enregistrer le transcript`
- demande confirmation
- ferme le ticket
- enregistre le transcript en base
- le transcript contient aussi le **staff qui a fermé le ticket**

## Base de données

Le bot utilise MariaDB avec les tables suivantes :

### `tickets`
Stocke :
- les tickets ouverts et fermés
- le propriétaire
- le claim actuel
- la date de création
- la date de fermeture
- le staff qui a fermé

### `ticket_participants`
Stocke les utilisateurs ajoutés au ticket.

### `transcript_snapshots`
Stocke les transcripts générés **uniquement sur demande**.

Important :
- les messages ne sont **pas** sauvegardés en base en direct
- seul le transcript final est stocké quand on clique sur le bouton

### `admin_stats`
Stocke :
- nombre de tickets claim par admin
- nombre de tickets fermés par admin

## Logs

Les logs sont séparés par salon.

### `closeLogChannelId`
Reçoit les logs de fermeture de ticket.

Exemple :
- ticket fermé
- admin qui a fermé

### `claimLogChannelId`
Reçoit les logs de claim.

Exemple :
- ticket claim
- admin qui a claim

### `moveLogChannelId`
Reçoit les logs de déplacement.

Exemple :
- ticket déplacé
- catégorie cible
- admin qui a déplacé

### `addUserLogChannelId`
Reçoit les logs d'ajout d'utilisateur.

Exemple :
- utilisateur ajouté au ticket
- admin qui l'a ajouté

### `removeUserLogChannelId`
Reçoit les logs de retrait d'utilisateur.

Exemple :
- utilisateur retiré du ticket
- admin qui l'a retiré

## Transcript HTML

Le transcript HTML affiche :
- le salon
- le ticket ID
- le propriétaire
- la date de création
- la date de fermeture
- le staff qui a fermé
- tous les messages du salon au moment de la génération
- les pièces jointes
- un aperçu image quand c'est possible

## Démarrage

Le projet a été pensé pour être lancé avec **une seule commande** :

```bash
npm start
```

Le script de démarrage :
- vérifie `config.json`
- vérifie les dépendances
- vérifie MariaDB
- crée la base si besoin
- crée les tables si besoin
- vérifie le schéma
- vérifie les IDs Discord importants
- déploie les commandes slash
- lance le bot

## Fichiers importants

- `bootstrap.js` : vérification complète + démarrage automatique
- `index.js` : lancement du bot
- `deploy-commands.js` : enregistrement des slash commands
- `utils/ticketManager.js` : logique principale des tickets
- `utils/transcript.js` : génération HTML/TXT des transcripts
- `config.example.json` : modèle de configuration

## Notes utiles

- il n'y a **pas** de commande `/close`
- il n'y a **pas** de commande `/transcript`
- la fermeture se fait uniquement avec le bouton prévu
- le transcript manuel se fait uniquement avec le bouton prévu
- une seule pièce jointe staff est prévue via slash command

## Lancement rapide

1. Copier `config.example.json` en `config.json`
2. Remplir les IDs et le token
3. Faire `npm install`
4. Faire `npm start`
