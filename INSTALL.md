# Installer son propre Ticket Bot

Un serveur, Docker, un nom de domaine : vingt minutes. Chaque installation est indépendante — ton bot, ta base, tes données, aucun lien avec l'auteur ni avec une autre instance.

*English version: [INSTALL.en.md](INSTALL.en.md).*

## 1. Ce qu'il te faut

| | Pourquoi |
|---|---|
| Un serveur Linux (1 Go de RAM suffit) avec **Docker** et **Docker Compose v2** | tout tourne en conteneurs : MariaDB, Redis, le bot et son dashboard |
| Un **nom de domaine** pointant vers ce serveur (`tickets.example.com`) | Discord n'accepte la connexion au dashboard qu'en HTTPS sur une adresse publique |
| Les **ports 80 et 443** ouverts | certificats HTTPS automatiques (Let's Encrypt) — sauf si tu as déjà un reverse proxy |
| Une **application Discord** (étape 2) | le bot et la connexion « Se connecter avec Discord » |

Installation de Docker : <https://docs.docker.com/engine/install/>.

## 2. Créer l'application Discord

Sur <https://discord.com/developers/applications> :

1. **New Application**, donne-lui le nom de ton bot.
2. Onglet **Bot** → **Reset Token** → copie le **token** (il ne sera plus affiché).
3. Toujours dans **Bot**, section *Privileged Gateway Intents* : active **Server Members Intent** et **Message Content Intent** (sans eux, le bot ne lit pas les messages privés).
4. Onglet **OAuth2** → copie le **Client Secret** (bouton *Reset Secret* si besoin). L'**Application ID** est sur la page *General Information*.
5. Toujours dans **OAuth2** → *Redirects* → **Add Redirect** : `https://tickets.example.com/api/auth/discord/callback` (avec ton domaine, exactement cette fin). Enregistre.

Tu as maintenant trois valeurs : le token, l'Application ID et le Client Secret.

## 3. Installer

```bash
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting
scripts/setup.sh
```

Le script demande le token, l'ID d'application, le Client Secret, ton domaine, ton e-mail et le mode HTTPS, puis génère tous les mots de passe et secrets dans `.env` (fichier privé, `chmod 600`). Il affiche à la fin l'identifiant et le mot de passe du compte **super-admin** : note-les.

Trois modes HTTPS :

- **Caddy inclus** (par défaut) : rien à configurer, certificats automatiques. Ports 80 et 443 requis.
- **Traefik existant** : le bot rejoint le réseau Docker `proxy` avec les labels pour les entrypoints `web`/`websecure` et le résolveur `letsencrypt` ; adapte `docker-compose.traefik.yml` si tes noms diffèrent.
- **Aucun** : le dashboard écoute sur `127.0.0.1:3000` ; mets ton propre proxy devant (Nginx : `proxy_buffering off;` pour le temps réel) et renseigne `TRUSTED_PROXY_HOST` ou `TRUST_PROXY_HOPS` dans `.env`.

Puis :

```bash
docker compose pull          # image publiée (ghcr.io/luquypest/bot-ticketting)
docker compose up -d
docker compose logs -f bot   # « Tout est prêt » = démarré ; Ctrl+C pour quitter les logs
```

Première ouverture de `https://tickets.example.com` : le certificat peut prendre une minute.

Sans le script, copie `.env.example` en `.env` et remplis-le à la main : chaque variable y est commentée.

## 4. Premier démarrage

1. **Panneau super-admin** : `https://tickets.example.com/sa`, avec l'identifiant et le mot de passe affichés par le script. Il te demande de scanner un QR code (Google Authenticator, Authy, Bitwarden…) : la double authentification est obligatoire pour ce compte.
2. **Inviter le bot** : connecte-toi sur `https://tickets.example.com` avec Discord → la page de choix du serveur propose un lien d'invitation avec les bonnes permissions. Il faut la permission *Gérer le serveur* sur le serveur Discord.
3. **Activation** : avec `AUTO_APPROVE_GUILDS=true` (choix par défaut du script), le serveur est actif dès l'arrivée du bot et la personne qui l'a invité devient **fondateur** du dashboard. Sinon, approuve-le dans `/sa` → Serveurs.
4. **Réglages** : dans le dashboard, *Paramètres* → rôles d'accès (quels rôles Discord sont staff), catégorie des salons de tickets, messages d'accueil… Tout le reste se fait depuis le dashboard, rien dans les fichiers.

Retire ensuite `SA_PASSWORD` du `.env` (le compte est créé, la ligne ne sert plus) et redémarre : `docker compose up -d`.

## 5. Au quotidien

| Action | Commande |
|---|---|
| Mettre à jour | `docker compose pull && docker compose up -d` — voir [UPGRADE.md](UPGRADE.md) |
| Sauvegarder | `scripts/backup.sh` (toutes les bases → `backups/`, à mettre en cron) ; garde aussi une copie du `.env` |
| Restaurer | `scripts/restore.sh backups/ticketbot-<date>.sql.gz` |
| Voir les logs | `docker compose logs -f bot` |
| Redémarrer | `docker compose restart bot` |
| Arrêter | `docker compose down` (les données restent dans les volumes Docker) |
| Tout supprimer | `docker compose down -v` — supprime aussi les bases |
| Rester sur une version | `TICKETBOT_VERSION=v2.24` dans `.env` au lieu de `latest` |

## 6. Problèmes fréquents

**« Aucune configuration trouvée » au démarrage** → le `.env` manque ou est vide ; relance `scripts/setup.sh`.

**Le bot ne répond pas aux messages privés** → *Message Content Intent* n'est pas activé (étape 2.3). Après activation, `docker compose restart bot`.

**« Invalid OAuth2 redirect_uri » en se connectant** → l'URL de redirection du portail Discord doit être exactement `https://<ton domaine>/api/auth/discord/callback`, et `PUBLIC_URL` dans `.env` doit être `https://<ton domaine>` sans barre finale.

**Le certificat HTTPS n'arrive pas** → le DNS ne pointe pas encore vers le serveur, ou les ports 80/443 sont fermés (pare-feu, box). `docker compose logs caddy` dit pourquoi.

**Mon serveur reste « en attente »** → `AUTO_APPROVE_GUILDS` n'est pas à `true` : approuve-le dans `/sa`, ou mets la variable à `true` et redémarre (les serveurs en attente sont alors activés).

**Je n'ai plus le mot de passe super-admin** → mets de nouvelles valeurs `SA_USERNAME`/`SA_PASSWORD` dans `.env`… non : elles ne servent qu'à la création du premier compte. Réinitialise-le en base : `docker compose exec db mariadb -uroot -p"$DB_ROOT_PASSWORD" ticketbot_global -e "DELETE FROM superadmins"` puis redémarre avec `SA_USERNAME`/`SA_PASSWORD` renseignés.

**Je veux garder un `config.json`** → toujours possible : monte-le dans le conteneur (lignes commentées dans `docker-compose.yml`). Les variables d'environnement l'emportent sur ses valeurs.

Autres questions : les [Discussions GitHub](https://github.com/LuquyPest/Bot-ticketting/discussions) ; un bug : une [issue](https://github.com/LuquyPest/Bot-ticketting/issues/new/choose).
