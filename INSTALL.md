# Installer son propre Ticket Bot

Un serveur, Docker, un nom de domaine : vingt minutes. Chaque installation est indépendante — ton bot, ta base, tes données, aucun lien avec l'auteur ni avec une autre instance. Tu en es le seul administrateur : pas de compte à créer, tu te connectes avec ton compte Discord.

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
2. Onglet **Bot** → **Reset Token** → copie le **token** (il ne sera plus affiché). Décoche **Public Bot** : toi seul pourras inviter le bot.
3. Toujours dans **Bot**, section *Privileged Gateway Intents* : active **Server Members Intent** et **Message Content Intent** (sans eux, le bot ne lit pas les messages privés).
4. Onglet **OAuth2** → copie le **Client Secret** (bouton *Reset Secret* si besoin). L'**Application ID** est sur la page *General Information*.
5. Toujours dans **OAuth2** → *Redirects* → **Add Redirect** : `https://tickets.example.com/api/auth/discord/callback` (avec ton domaine, exactement cette fin). Enregistre.

Tu as maintenant trois valeurs : le token, l'Application ID et le Client Secret. **Le compte Discord propriétaire de cette application sera le propriétaire de l'instance** (pour une application d'équipe : le propriétaire et les admins de l'équipe).

## 3. Installer

```bash
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting
scripts/setup.sh
```

Le script demande le token, l'ID d'application, le Client Secret, ton domaine, ton e-mail, le mode HTTPS et la sauvegarde nocturne, puis génère tous les mots de passe et secrets dans `.env` (fichier privé, `chmod 600`).

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

1. **Connexion** : ouvre `https://tickets.example.com` et connecte-toi avec Discord, avec le compte propriétaire de l'application. Tu es reconnu comme **propriétaire de l'instance**.
2. **Inviter le bot** : la page **Mes serveurs** propose « Inviter le bot » sur chaque serveur où tu as la permission *Gérer le serveur*. Le serveur est **prêt dès que le bot arrive** : tu en es fondateur et tu reçois un MP avec le lien du dashboard.
3. **Réglages** : dans le dashboard, *Paramètres* → rôles d'accès (quels rôles Discord sont staff), catégorie des salons de tickets, messages d'accueil… Tout se fait depuis le dashboard, rien dans les fichiers.
4. **Section Instance** (menu Administration, ou « Gérer l'instance » sur **Mes serveurs**) : tes serveurs, leurs fondateurs, la santé du bot, les erreurs et leur alerte (MP envoyé à toi par défaut), le journal, les adresses bloquées et le serveur de démonstration (désactivé par défaut).

Pour donner la main à quelqu'un d'autre sur l'instance, ajoute son ID Discord dans `OWNER_IDS` (`.env`) et redémarre. Pour qu'il gère un seul serveur, nomme-le plutôt fondateur de ce serveur.

## 5. Au quotidien

| Action | Commande |
|---|---|
| Mettre à jour | `docker compose pull && docker compose up -d` — voir [UPGRADE.md](UPGRADE.md) |
| Sauvegarder | automatique chaque nuit dans `backups/`, chiffrée avec `BACKUP_KEY` (service `backup`) ; à la demande : `scripts/backup.sh`. La clé est aussi affichée au propriétaire dans **Paramètres → Sécurité** : garde-la hors du serveur avec une copie du `.env` (`ENCRYPTION_KEY` déchiffre les transcripts) |
| Restaurer | `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc` (intégrité vérifiée avant toute écriture) |
| Voir les logs | `docker compose logs -f bot` |
| Redémarrer | `docker compose restart bot` |
| Arrêter | `docker compose down` (les données restent dans les volumes Docker) |
| Tout supprimer | `docker compose down -v` — supprime aussi les bases |
| Rester sur une version | `TICKETBOT_VERSION=v3.0` dans `.env` au lieu de `latest` |

## 6. Problèmes fréquents

**« Aucune configuration trouvée » au démarrage** → le `.env` manque ou est vide ; relance `scripts/setup.sh`.

**Le bot ne répond pas aux messages privés** → *Message Content Intent* n'est pas activé (étape 2.3). Après activation, `docker compose restart bot`.

**« Invalid OAuth2 redirect_uri » en se connectant** → l'URL de redirection du portail Discord doit être exactement `https://<ton domaine>/api/auth/discord/callback`, et `PUBLIC_URL` dans `.env` doit être `https://<ton domaine>` sans barre finale.

**Le certificat HTTPS n'arrive pas** → le DNS ne pointe pas encore vers le serveur, ou les ports 80/443 sont fermés (pare-feu, box). `docker compose logs caddy` dit pourquoi.

**Je ne vois pas « Instance » ni « Inviter le bot »** → tu n'es pas connecté avec le compte propriétaire de l'application Discord (portail développeur → *General Information* → *Owner*). Ajoute ton ID dans `OWNER_IDS` si c'est voulu, puis `docker compose up -d`.

**Le bot quitte un serveur dès son arrivée** → `ALLOWED_GUILDS` est renseigné et ce serveur n'y est pas.

**Afficher ma propre politique de confidentialité** → la page intégrée `/confidentialite` convient à la plupart des cas (avec l'e-mail `CONTACT_EMAIL`) ; pour la tienne, mets son adresse dans `PRIVACY_URL`.

**Je veux garder un `config.json`** → toujours possible : monte-le dans le conteneur (lignes commentées dans `docker-compose.yml`). Les variables d'environnement l'emportent sur ses valeurs.

Autres questions : les [Discussions GitHub](https://github.com/LuquyPest/Bot-ticketting/discussions) ; un bug : une [issue](https://github.com/LuquyPest/Bot-ticketting/issues/new/choose).
