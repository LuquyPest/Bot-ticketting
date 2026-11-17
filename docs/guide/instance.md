# Section Instance

L'**instance**, c'est ton installation : ton bot Discord et tous les serveurs où il est. Elle a un propriétaire, et un seul endroit pour la gérer.

## Le propriétaire

Le **propriétaire de l'instance** est le compte Discord qui possède l'application du bot (portail développeur → *General Information*). Pour une application d'équipe : le propriétaire et les admins de l'équipe. Tu peux ajouter des co-propriétaires avec `OWNER_IDS` dans le `.env`.

- Il se connecte au dashboard avec son compte Discord, comme tout le monde : pas de compte à part, pas de mot de passe.
- Il est **fondateur sur chaque serveur** de l'instance.
- Lui seul voit la liste de tous les serveurs à la connexion, obtient le lien d'invitation du bot et accède à la section **Instance** (menu Administration, ou `/instance`).

## Les serveurs

Un serveur Discord est **actif dès que le bot le rejoint** : sa base est créée, la personne qui a invité le bot en devient fondateur et reçoit un MP avec le lien du dashboard. Il n'y a pas de validation.

::: warning Bot privé
Dans le portail Discord, onglet *Bot*, décoche **Public Bot** : sinon n'importe qui peut ajouter ton bot à son serveur, et ce serveur serait activé sur ton instance. `ALLOWED_GUILDS` restreint en plus la liste des serveurs acceptés ; un avertissement s'affiche au démarrage si le bot est public sans cette liste.
:::

**Plusieurs communautés** : un modèle de réponse créé avec la portée **Tous les serveurs** (fiche ticket → Modèles) est proposé au staff de chacun de tes serveurs, sans être recopié. Le staff l'utilise, toi seul le modifies ; il ne peut pas ajouter de tag, puisque les tags sont propres à chaque serveur.

**Un espace sans Discord** : **Instance → Serveurs → Créer un espace**. C'est un espace de support sans serveur Discord : tickets par [e-mail](./integrations#tickets-par-e-mail), espace membre, dashboard, avec ses propres réglages, son équipe et son journal, comme un serveur. Ses tickets n'ont pas de salon (format « Aucun salon »), et rien n'est jamais demandé à Discord à son sujet. Tu en es fondateur ; il apparaît dans **Mes serveurs** quelle que soit ta façon de te connecter.

**Relier ou délier Discord** : sur la ligne d'un espace sans Discord, le bouton **Relier à Discord** demande l'identifiant du serveur puis donne le lien d'invitation du bot, valable une heure. À l'arrivée du bot, l'espace devient celui du serveur : tickets, réglages, équipe et journal sont conservés, aucun nouvel espace n'est créé. À l'inverse, **Délier de Discord** (confirmé en tapant le nom) garde l'espace et tout son contenu : ses tickets ouverts continuent sans salon, le format passe à « Aucun salon », et le bot quitte le serveur. Réinviter le bot sur ce serveur le relie de nouveau.

## Les pages

| Page | |
|---|---|
| **Vue d'ensemble** | Serveurs, tickets ouverts, tickets par jour sur 30 jours, staff, erreurs des dernières 24 heures, tableau par serveur |
| **Serveurs** | Suspendre, réactiver, mettre en maintenance, supprimer (le bot quitte le serveur et sa base est effacée) ; nommer ou retirer des fondateurs |
| **Santé** | Version en cours et [mise à jour](./mise-a-jour), état des [sauvegardes](./sauvegardes#suivi-et-alertes), connexion Discord, base, Redis, tâches planifiées, mémoire, version de schéma de chaque base ; serveur de démonstration, [métriques Prometheus](#supervision-prometheus) |
| **Erreurs** | Journal centralisé des erreurs du bot, du dashboard et des navigateurs, avec filtres ; **alerte** par MP (au propriétaire par défaut) ou webhook au-delà d'un seuil, et en cas de déconnexion de Discord |
| **Journal** | Chaque modification faite depuis la section, avec son auteur et le serveur concerné |
| **Blocages** | Adresses IP bloquées par les limites de connexion ou d'API, avec déblocage |

## Démonstration

Un serveur fictif rempli de données réalistes, ouvert à tous depuis la page de connexion (« Découvrir le dashboard ») ou directement à l'adresse `/demo` de ton domaine. **Désactivé par défaut**, il s'active dans **Instance → Santé**. Isolé de tout le reste : aucun MP n'en part, les actions vers Discord et vers l'extérieur sont refusées, et il est remis à zéro chaque nuit.

## E-mail de l'instance

Le serveur d'envoi (SMTP) que Datick utilise pour **écrire lui-même aux personnes** : invitations, liens de connexion, réinitialisations de mot de passe. Il se règle dans **Instance → Santé → E-mail de l'instance** : serveur, port (587, 465, 25 ou 2525), identifiant et mot de passe facultatifs, adresse et nom de l'expéditeur. **Envoyer le test** vérifie tout de suite.

Il est distinct des boîtes de support de chaque espace ([tickets par e-mail](./integrations#tickets-par-e-mail)), avec les mêmes protections : serveur à adresse publique seulement (`EMAIL_ALLOW_PRIVATE_HOSTS=true` pour un serveur chez toi), mot de passe chiffré et jamais réaffiché, chaque modification au journal de l'instance. Les e-mails partent en français ou en anglais selon la personne.

## Supervision (Prometheus)

Pour suivre l'instance dans **Prometheus**, **Grafana** ou **Uptime Kuma**. **Désactivé par défaut** : **Instance → Santé → Métriques Prometheus → Activer** crée un jeton, affiché une seule fois (seule son empreinte est gardée). L'adresse `https://ton-domaine/metrics` répond alors à qui présente ce jeton, et `404` à tout le monde tant que c'est coupé.

```yaml
scrape_configs:
  - job_name: ticketbot
    scheme: https
    authorization:
      credentials: tbm_…        # le jeton
    static_configs:
      - targets: ['tickets.example.com']
```

| Métrique | Contenu |
|---|---|
| `ticketbot_tickets_open`, `_unassigned`, `_waiting` | Tickets ouverts, sans personne assignée, en attente — par serveur (`guild_id`, `guild`) |
| `ticketbot_tickets_opened_24h`, `_closed_24h` | Ouverts et fermés sur 24 heures |
| `ticketbot_oldest_unanswered_ticket_seconds` | Âge du plus vieux ticket ouvert sans réponse du staff |
| `ticketbot_discord_connected`, `_discord_ping_seconds` | Connexion à Discord |
| `ticketbot_database_up`, `ticketbot_redis_up` (et `_latency_seconds`) | Base et Redis |
| `ticketbot_jobs{state}` | Tâches planifiées en attente, en cours, en échec |
| `ticketbot_backup_last_success_timestamp_seconds{kind}`, `ticketbot_backup_problems` | [Sauvegardes](./sauvegardes) : dernière réussite, vérification, copie hors du serveur |
| `ticketbot_update_available`, `ticketbot_info{version}` | Version |

Uniquement des chiffres : aucun sujet de ticket ni nom de membre. Les valeurs sont recalculées au plus toutes les 15 secondes. **Uptime Kuma** : moniteur *HTTP(s) - Mot-clé* sur `/metrics`, en-tête `Authorization: Bearer tbm_…`, mot-clé `ticketbot_discord_connected 1`.

## Confidentialité

Une page de confidentialité est intégrée (`/confidentialite`) et liée depuis la connexion et l'espace membre : ce qui est enregistré, pourquoi, qui y a accès, combien de temps. Indique un e-mail de contact avec `CONTACT_EMAIL`, ou remplace la page par la tienne avec `PRIVACY_URL`.
