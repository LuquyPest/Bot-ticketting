# Installation

Un serveur, Docker, un nom de domaine : **une vingtaine de minutes**, étape par étape. Chaque installation est indépendante — ton bot, ta base, tes données, sans lien avec l'auteur ni avec une autre instance. Tu en es le seul administrateur : aucun compte à créer, tu te connectes avec ton compte Discord.

*English version: [Installation](../en/installation).*

## Ce que tu vas mettre en place

![Ton domaine mène à ton serveur, qui fait tourner le bot relié à Discord](/images/guide-overview.png)

Trois choses à relier : **ton application Discord** (étape 3), **ton serveur** qui fait tourner le bot (étapes 1, 4 et 5) et **ton domaine** qui y mène (étape 2).

## Ce qu'il te faut

| | Pourquoi |
|---|---|
| Un **serveur Linux** (VPS, 1 Go de RAM suffit) | Le bot tourne en continu ; une machine chez toi convient aussi si elle reste allumée |
| Un **nom de domaine** (ou un sous-domaine, comme `tickets.example.com`) | Discord n'autorise la connexion au dashboard qu'en HTTPS sur une adresse publique |
| Les **ports 80 et 443** ouverts | Pour le certificat HTTPS automatique |
| Un **compte Discord** | Il deviendra le propriétaire de ton instance |

## Étape 1 — Installer Docker

Sur le serveur, en SSH. La méthode officielle, pour Debian ou Ubuntu :

![Installer Docker puis vérifier sa version](/images/install-docker.png)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # puis déconnecte-toi et reconnecte-toi
```

::: tip Vérifier
`docker compose version` doit répondre par un numéro de version. Autres systèmes : [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
:::

## Étape 2 — Faire pointer le domaine

Chez ton fournisseur de domaine (OVH, Gandi, Cloudflare, Ionos…), ouvre la **zone DNS** et ajoute un enregistrement **A** vers l'adresse IP du serveur :

![Ajouter un enregistrement A dans la zone DNS](/images/guide-dns.png)

| Type | Nom | Valeur |
|---|---|---|
| `A` | `tickets` (pour `tickets.example.com`) | l'adresse IPv4 du serveur |

::: tip Vérifier
`ping tickets.example.com` doit répondre avec l'adresse de ton serveur. La propagation prend de quelques minutes à une heure.
:::

## Étape 3 — Créer le bot sur Discord

Ouvre le [portail développeur Discord](https://discord.com/developers/applications) et connecte-toi avec le compte qui administrera l'instance.

### Créer l'application

1. **New Application** → donne-lui le nom de ton bot → **Create**.
2. Page **General Information** : copie l'**Application ID**.

![Portail développeur : New Application, puis copier l'Application ID](/images/guide-discord-app.png)

### Le bot

3. Onglet **Bot** :
   - **Reset Token** → copie le **token** (il ne sera plus jamais affiché) ;
   - décoche **Public Bot** : toi seul pourras inviter le bot ;
   - dans *Privileged Gateway Intents*, active **Server Members Intent** et **Message Content Intent**, puis **Save Changes**.

![Onglet Bot : Reset Token, Public Bot désactivé, intents activés](/images/guide-discord-bot.png)

### La connexion au dashboard

4. Onglet **OAuth2** :
   - **Reset Secret** → copie le **Client Secret** ;
   - dans *Redirects*, **Add Redirect** : `https://tickets.example.com/api/auth/discord/callback` (avec ton domaine, cette fin exactement) → **Save Changes**.

![Onglet OAuth2 : Reset Secret, adresse de redirection](/images/guide-discord-oauth.png)

Tu as maintenant trois valeurs : l'**Application ID**, le **token** et le **Client Secret**.

::: warning Ne partage jamais le token ni le Client Secret
Ils donnent le contrôle de ton bot. S'ils fuient : **Reset Token** / **Reset Secret** dans le portail, puis relance `scripts/setup.sh`.
:::

## Étape 4 — Installer et configurer

```bash
git clone https://github.com/LuquyPest/Bot-ticketting.git
cd Bot-ticketting
scripts/setup.sh
```

Le script pose quelques questions et **génère tout le reste** : mots de passe, clés de chiffrement, clés des notifications. Le token et le Client Secret sont saisis sans s'afficher.

![setup.sh pose ses questions puis écrit le fichier .env](/images/install-setup.png)

| Question | Réponse |
|---|---|
| HTTPS | **1** (Caddy inclus) dans la plupart des cas. **2** si tu as déjà un Traefik, **3** si tu as ton propre reverse proxy |
| Sauvegarder chaque nuit | **o** : une sauvegarde chiffrée de toutes les bases, chaque nuit, dans `backups/` |

Tout est écrit dans le fichier `.env`, privé (lisible par toi seul). Garde-en une copie hors du serveur : il contient les clés qui déchiffrent les transcripts et les sauvegardes.

## Étape 5 — Démarrer

```bash
docker compose pull && docker compose up -d
docker compose logs -f bot
```

Docker télécharge l'image publiée, démarre la base, Redis, le bot, Caddy et la sauvegarde. Le bot vérifie sa configuration et se connecte à Discord :

![Démarrage des conteneurs puis du bot](/images/install-start.png)

« **Connecté en tant que** » : c'est bon. `Ctrl+C` pour quitter les logs (le bot continue de tourner).

::: tip Si ça ne démarre pas
Le message d'erreur dit ce qui manque. Les cas courants sont dans [Problèmes fréquents](./problemes#installation).
:::

## Étape 6 — Se connecter

Ouvre `https://tickets.example.com` (la première fois, le certificat HTTPS peut prendre une minute) et clique **Connexion avec Discord**, avec le compte propriétaire de l'application.

![Page de connexion du dashboard](/images/install-login.png)

Le dashboard porte le nom et l'avatar de ton bot. Tu es reconnu comme **propriétaire de l'instance**.

## Étape 7 — Inviter le bot sur ton serveur

La page **Mes serveurs** liste les serveurs Discord où tu as la permission *Gérer le serveur*. Clique **Inviter le bot** sur le tien et valide dans la fenêtre Discord.

![Mes serveurs : « Inviter le bot » sur un serveur, « Accéder » sur un serveur déjà actif](/images/install-servers.png)

Le serveur est **prêt dès que le bot arrive** : tu en es fondateur et tu reçois un MP avec le lien du dashboard. Clique **Accéder**.

## Étape 8 — Régler l'essentiel

**Paramètres → Rôles d'accès** : choisis les rôles Discord de ton staff et les catégories où ranger les tickets.

![Paramètres → Rôles d'accès : rôles du staff et catégories des étapes](/images/install-roles.png)

Puis envoie un message privé au bot depuis un autre compte : le ticket apparaît dans **Tickets** et dans la catégorie « Ouvert » de ton serveur. **C'est installé.**

La suite — sujets, messages, grades, FAQ, panels : [Premiers pas](./premiers-pas).

## Au quotidien

| Action | Commande |
|---|---|
| Mettre à jour | `docker compose pull && docker compose up -d` — [Mises à jour](./mise-a-jour) |
| Sauvegarder maintenant | `scripts/backup.sh` — [Sauvegardes](./sauvegardes) |
| Restaurer | `scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc` |
| Voir les logs | `docker compose logs -f bot` |
| Redémarrer le bot | `docker compose restart bot` |
| Tout arrêter | `docker compose down` (les données restent) |
| Rester sur une version | `TICKETBOT_VERSION=v3.0.4` dans `.env` au lieu de `latest` |

::: details Installer sans le script
Copie `.env.example` en `.env` et remplis-le : chaque variable y est commentée, et toutes sont décrites dans [Configuration](./configuration). Génère chaque secret avec `openssl rand -hex 32`.
:::

::: details Utiliser ton propre reverse proxy (Nginx, Traefik…)
Avec le choix **3**, le dashboard écoute sur `127.0.0.1:3000` : fais pointer ton proxy dessus. Pour Nginx, ajoute `proxy_buffering off;` (temps réel). Avec un **Traefik** existant (choix **2**), le bot rejoint le réseau Docker `proxy` avec les entrypoints `web` / `websecure` et le résolveur `letsencrypt` : adapte `docker-compose.traefik.yml` si les tiens s'appellent autrement.
:::
