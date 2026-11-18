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

**Ignorés** : réponses automatiques (absence, `Auto-Submitted`), retours d'erreur, listes de diffusion, l'adresse du support elle-même ; au-delà de 10 e-mails par heure d'un même expéditeur. Le texte cité de l'ancien message est retiré. La personne peut aussi suivre ses tickets dans l'[espace membre](./espace-membre), connectée par un lien reçu par e-mail.

**Plusieurs adresses** : sous **Autres adresses**, ajoute des adresses qui arrivent dans **la même boîte** (alias ou redirections : `facturation@`, `technique@`…), jusqu'à 20. Pour chacune :

| | |
|---|---|
| **Sujet** | Le sujet du ticket (parmi ceux de Paramètres → Tickets) ; l'objet de l'e-mail reste en tête du premier message. Sans sujet : l'objet de l'e-mail, comme pour l'adresse principale |
| **Tag** | Ajouté au ticket à son ouverture : avec les [rôles rattachés à des tags](./equipe#les-roles-rattaches-a-des-tags), le ticket va à cette équipe |
| **Répondre depuis cette adresse** | Les réponses du ticket partent de cette adresse, avec son nom affiché. Ton serveur d'envoi doit accepter cette adresse comme expéditeur ; sinon, laisse décoché : les réponses partent de l'adresse principale, dans le même fil |

L'adresse de réception est reconnue dans `To`, `Cc`, ou les en-têtes ajoutés par la boîte (`Delivered-To`, `X-Original-To`) pour une redirection. Les règles par sujet s'appliquent ensuite comme d'habitude. Un e-mail venant d'une de ces adresses est ignoré (pas de boucle). Chaque ajout, modification ou retrait est au journal.

**Pièces jointes** : gardées sur le serveur, téléchargeables depuis la fiche ticket (sous leur message, aperçu pour les images), avec les mêmes droits que le ticket. Tout se règle dans la même section :

| Réglage | Par défaut |
|---|---|
| Conserver les pièces jointes | oui (sinon, seul leur nom est noté) |
| Taille maximale par fichier | 10 Mo (jusqu'à 25) |
| Espace total du serveur | 500 Mo ; au-delà, les nouvelles ne sont plus gardées |
| Garder après la fermeture du ticket | 90 jours (0 = toujours) ; supprimées chaque nuit après ce délai |
| Types refusés | exécutables et scripts (`exe`, `bat`, `js`, `html`, `svg`…), modifiables |
| Publier aussi dans le salon Discord | oui, jusqu'à 8 Mo par fichier |

L'espace utilisé s'affiche, avec **Appliquer la conservation maintenant** et **Supprimer celles des tickets fermés**. Une pièce jointe refusée est notée avec la raison (« type refusé », « plus de 10 Mo »…). Les fichiers sont dans le volume Docker `attachments`, hors des sauvegardes nocturnes de la base.

::: tip Serveur mail sur ton réseau local
Par sécurité, les serveurs IMAP et SMTP doivent avoir une adresse publique (le bot ne se connecte jamais à une adresse interne choisie depuis le dashboard). Pour un serveur mail chez toi, `EMAIL_ALLOW_PRIVATE_HOSTS=true` dans `.env`.
:::

## Widget web

Un formulaire de ticket à coller sur **ton site**, pour les personnes sans compte Discord. **Paramètres → Intégrations → Widget web** :

1. Coche **Activer le widget**. Indique éventuellement les **sites autorisés** à l'afficher (un par ligne, `https://exemple.com`) ; vide, n'importe quel site peut l'afficher.
2. **Enregistrer** donne le code à coller avant la fin de la balise `<body>` :

   ```html
   <script src="https://ton-domaine/widget.js" data-datick-widget="…" async></script>
   ```

   Un bouton **Support** apparaît en bas à droite et ouvre le formulaire. Options : `data-label` (texte du bouton), `data-color` (`#5865f2`), `data-lang` (`fr`, `en`, `es`, `de`, `it`, `pt` ; sinon la langue du navigateur), `data-mode="inline"` (le formulaire s'affiche à l'endroit du code, hauteur réglable avec `data-height`).

La personne donne son nom (facultatif), son **adresse e-mail**, le sujet si l'espace en propose, et son message. Le ticket est le sien comme pour l'[espace membre](./espace-membre) sans Discord : la confirmation et les réponses du staff lui arrivent par l'[e-mail de l'instance](./instance#e-mail-de-l-instance), avec le lien pour suivre et répondre dans l'espace membre. **Sans e-mail de l'instance, le formulaire reste indisponible.** Les champs personnalisés et le formulaire d'intake ne sont pas demandés par le widget.

**Anti-spam**, sans service tiers : un champ caché que seuls les robots remplissent, au moins 3 secondes entre l'ouverture du formulaire et l'envoi (heure signée, valable 2 heures), **5 envois par heure et par adresse IP**, **3 par adresse e-mail**, 60 nouveaux tickets web par heure pour l'espace, la limite de tickets par jour de l'espace et la blacklist. **Nouveau code** invalide le code déjà collé (en cas d'abus) ; chaque modification est au journal.

## Sauvegarde de la configuration

**Paramètres → Sauvegarde** : export JSON de la configuration (paramètres, grades, tags, formulaires, panels, champs, FAQ, modèles, règles, procédures) et import sur ce serveur ou un autre. Les secrets ne sont jamais exportés.

## Venir d'un autre bot de tickets

**Paramètres → Sauvegarde → Importer depuis un autre bot** reprend les tickets **encore ouverts** d'un autre bot (Ticket Tool, Tickets, Helper.gg…), sans rien supprimer :

1. choisis la catégorie Discord où l'autre bot range ses tickets, puis **Analyser** ;
2. pour chaque salon, le dashboard retrouve le membre qui l'a ouvert (dans les permissions du salon, ou une mention dans son sujet) ; les salons sans membre identifiable sont signalés ;
3. coche les salons à reprendre et **Reprendre** : chacun devient un ticket de ce bot.

Options : copier les 100 derniers messages du salon dans l'historique du ticket (messages du membre et réponses du staff ; ceux des bots sont ignorés), prévenir chaque membre en MP — dans sa langue — qu'il peut désormais répondre au bot, et déplacer les salons dans la catégorie « Ouvert ». Ensuite, retire l'ancien bot de ton serveur : les nouveaux tickets passent par celui-ci.

Les anciens tickets **déjà fermés** ne sont pas importés : aucun de ces bots ne permet d'exporter ses données. Garde leurs transcripts là où l'autre bot les a mis.

