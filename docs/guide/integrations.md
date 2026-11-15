# Intégrations

## Panels Discord

**Panels** (fondateurs) : publie dans un salon un message avec des **boutons** pour ouvrir un ticket sans passer par les MP. Embed personnalisable (titre, description, couleur, image), jusqu'à 25 boutons avec libellé, emoji, style et sujet, et un formulaire facultatif ouvert au clic. Modifier le panel met à jour le message ; le supprimer retire le message.

## API publique

Activable par serveur (**Paramètres → Intégrations → API publique**), avec des **clés API** (page **Clés API**) créées par les fondateurs : permissions au choix, date d'expiration facultative. Seule une empreinte de la clé est conservée.

| Méthode | Route | Permission |
|---|---|---|
| `GET` | `/api/v1/tickets?status=open\|closed&page=1` | `read_tickets` |
| `GET` | `/api/v1/tickets/:id` (ticket et messages) | `read_tickets` |
| `POST` | `/api/v1/tickets/:id/close` | `close_tickets` |
| `GET` | `/api/v1/stats` | `read_stats` |

La clé s'envoie dans l'en-tête `Authorization: Bearer <clé>`. La description **OpenAPI 3** est publique sur `/api/v1/openapi.json`, et la page **Documentation API** du dashboard l'affiche avec un exemple `curl` et une réponse type pour chaque route. Les tickets confidentiels ne sont jamais accessibles par l'API.

## Webhooks sortants

**Paramètres → Intégrations** : une adresse HTTPS prévenue à l'ouverture, à la fermeture et à la prise en charge d'un ticket (`ticket_open`, `ticket_close`, `ticket_claim`).

- En-tête `X-TicketBot-Event`, et signature `X-TicketBot-Signature-256` (HMAC-SHA256) si un secret est défini.
- Adresses privées et internes refusées (protection anti-SSRF), délai de 5 secondes.
- Ticket confidentiel : seulement `{ ticketId, confidential: true }`.

## Notifications push

Chaque membre du staff peut recevoir les nouveaux messages et réponses en notification du navigateur (**Profil → Notifications**), seulement pour les tickets qu'il peut voir. Il faut les clés `VAPID_*` du `.env`, générées par `setup.sh`.

## Accès invités

**Accès invités** (fondateurs) : un lien temporaire en lecture seule vers des tickets choisis, pour une personne extérieure sans compte Discord (modérateur d'un partenaire, conseil…). Durée d'une heure à 30 jours, notes internes incluses ou non, chaque consultation inscrite au journal, révocable à tout moment.

## Tickets par e-mail

Pour les personnes qui ne sont pas sur Discord : chaque e-mail reçu sur l'adresse du support ouvre un ticket, exactement comme un MP au bot (même salon, ou fil, ou aucun salon ; mêmes sujets, règles et automatismes). **Paramètres → Intégrations → Tickets par e-mail**, fondateurs :

| | |
|---|---|
| **Adresse** | Celle du support (`support@ton-domaine`), avec un nom affiché facultatif |
| **Réception (IMAP)** | Serveur, port 993 (TLS) ou 143, identifiant et mot de passe de la boîte : elle est lue **chaque minute**, chaque e-mail traité est marqué comme lu |
| **Envoi (SMTP)** | Serveur, port 587, 465, 25 ou 2525, identifiant et mot de passe : les réponses partent de l'adresse du support |

**Tester la connexion** vérifie les deux avant d'activer. Les mots de passe sont chiffrés en base (`ENCRYPTION_KEY`) et ne sont jamais réaffichés.

**Ce qui part par e-mail** : tout ce que le bot aurait envoyé en MP — accusé de réception, réponses du staff (dashboard, `/reply`, modèles), changement d'étape, fermeture. Le sujet porte `[#<ticket>-<jeton>]` : une réponse arrive dans son ticket seulement avec ce jeton **et** depuis l'adresse qui l'a ouvert — un expéditeur usurpé ne peut pas écrire dans le ticket de quelqu'un d'autre.

**Ignorés** : réponses automatiques (absence, `Auto-Submitted`), retours d'erreur, listes de diffusion, l'adresse du support elle-même ; au-delà de 10 e-mails par heure d'un même expéditeur. Le texte cité de l'ancien message est retiré. Les **pièces jointes** sont listées par leur nom mais pas conservées. L'espace membre reste réservé aux comptes Discord.

::: tip Serveur mail sur ton réseau local
Par sécurité, les serveurs IMAP et SMTP doivent avoir une adresse publique (le bot ne se connecte jamais à une adresse interne choisie depuis le dashboard). Pour un serveur mail chez toi, `EMAIL_ALLOW_PRIVATE_HOSTS=true` dans `.env`.
:::

## Sauvegarde de la configuration

**Paramètres → Sauvegarde** : export JSON de la configuration (paramètres, grades, tags, formulaires, panels, champs, FAQ, modèles, règles, procédures) et import sur ce serveur ou un autre. Les secrets ne sont jamais exportés.

## Venir d'un autre bot de tickets

**Paramètres → Sauvegarde → Importer depuis un autre bot** reprend les tickets **encore ouverts** d'un autre bot (Ticket Tool, Tickets, Helper.gg…), sans rien supprimer :

1. choisis la catégorie Discord où l'autre bot range ses tickets, puis **Analyser** ;
2. pour chaque salon, le dashboard retrouve le membre qui l'a ouvert (dans les permissions du salon, ou une mention dans son sujet) ; les salons sans membre identifiable sont signalés ;
3. coche les salons à reprendre et **Reprendre** : chacun devient un ticket de ce bot.

Options : copier les 100 derniers messages du salon dans l'historique du ticket (messages du membre et réponses du staff ; ceux des bots sont ignorés), prévenir chaque membre en MP — dans sa langue — qu'il peut désormais répondre au bot, et déplacer les salons dans la catégorie « Ouvert ». Ensuite, retire l'ancien bot de ton serveur : les nouveaux tickets passent par celui-ci.

Les anciens tickets **déjà fermés** ne sont pas importés : aucun de ces bots ne permet d'exporter ses données. Garde leurs transcripts là où l'autre bot les a mis.

