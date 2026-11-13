# Problèmes fréquents

## Installation

**« Aucune configuration trouvée » au démarrage**
Le `.env` manque ou est vide : relance `scripts/setup.sh`.

**« Invalid OAuth2 redirect_uri » à la connexion**
L'adresse de redirection du portail Discord doit être exactement `https://<ton domaine>/api/auth/discord/callback`, et `PUBLIC_URL` vaut `https://<ton domaine>` sans barre finale.

**Le certificat HTTPS n'arrive pas (Caddy)**
Le DNS ne pointe pas encore vers le serveur, ou les ports 80 et 443 sont fermés : `docker compose logs caddy` dit pourquoi.

**Le service `backup` refuse de démarrer**
`BACKUP_KEY` manque dans le `.env` : `echo "BACKUP_KEY=$(openssl rand -hex 32)" >> .env`.

**MariaDB refuse la connexion**
`DB_HOST` doit rester `db`. Avec un `config.json`, son `database.password` doit valoir `DB_PASSWORD`.

## Bot Discord

**Le bot ne répond pas aux messages privés**
Active **Message Content Intent** dans le portail Discord (onglet *Bot*), puis `docker compose restart bot`.

**Les commandes slash n'apparaissent pas**
Attends une ou deux minutes. Sinon : `docker compose restart bot`.

**Le bot quitte un serveur dès son arrivée**
`ALLOWED_GUILDS` est renseigné et ce serveur n'y est pas : ajoute son ID ou vide la variable.

**Les salons des tickets restreints restent visibles**
Le bot n'a pas la permission **Gérer les rôles** : **Santé du serveur** le signale. Réinvite-le ou ajoute-lui la permission.

## Dashboard

**Je ne vois pas la section Instance, ni « Inviter le bot »**
Tu n'es pas connecté avec le compte propriétaire de l'application Discord. Ajoute ton ID dans `OWNER_IDS` si c'est voulu, puis `docker compose up -d`.

**Bloqué sur la page d'attente (« Nouveau »)**
Un fondateur doit t'attribuer un grade dans **Équipe**.

**Un membre du staff ne voit pas le serveur**
Vérifie que son rôle Discord est dans **Paramètres → Rôles d'accès**, puis qu'il se reconnecte.

**« Permission insuffisante » partout**
Un support n'a aucun droit sans grade : vérifie le grade associé à son rôle, ou attribue-lui un grade avec au moins `view_tickets`.

**J'ai perdu mon téléphone (2FA)**
Utilise un code de secours sur l'écran de vérification, puis réactive la 2FA depuis ton profil.

**Le temps réel ne marche pas derrière mon propre proxy**
Nginx : `proxy_buffering off;`, `proxy_cache off;`, `proxy_read_timeout 3600s;`.

## Toujours bloqué ?

Pose ta question dans les [Discussions](https://github.com/LuquyPest/Bot-ticketting/discussions), ou ouvre une [issue](https://github.com/LuquyPest/Bot-ticketting/issues/new/choose) avec la version, les étapes et les logs (`docker compose logs bot`) — **sans token ni secret**.
