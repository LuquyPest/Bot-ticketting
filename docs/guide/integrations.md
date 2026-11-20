# Intégrations

## Panels Discord

**Panels** (fondateurs) : publie dans un salon un message avec des **boutons** pour ouvrir un ticket sans passer par les MP. Embed personnalisable (titre, description, couleur, image), jusqu'à 25 boutons avec libellé, emoji, style et sujet, et un formulaire facultatif ouvert au clic. Modifier le panel met à jour le message ; le supprimer retire le message.

## API publique

Activable par espace (**Paramètres → Intégrations → API publique**), avec des **clés API** (page **Clés API**) créées par les fondateurs : permissions au choix, date d'expiration facultative. Seule une empreinte de la clé est conservée. Les mêmes clés servent pour les deux versions.

**v3** (recommandée : la v2 plus l'écriture) — toutes les routes de la v2 sous `/api/v3/…`, et :

| Méthode | Route | Permission |
|---|---|---|
| `POST` | `/api/v3/tickets` — ouvrir un ticket au nom d'une adresse e-mail (`requester`, `subject`, `message`, `priority`, `tags`, `cc`, `fields`, `notify`) | `create_tickets` |
| `POST` | `/api/v3/tickets/:id/reply` — répondre au demandeur par son canal (`message`, `anonymous` ; un fichier en multipart, champ `file`) | `reply_tickets` |
| `POST` | `/api/v3/tickets/:id/notes` — note interne | `reply_tickets` |
| `PATCH` | `/api/v3/tickets/:id` — `priority`, `stage`, `team_id`, `assignees_add` / `_remove`, `tags_add` / `_remove`, `fields`, `cc_add` / `_remove` | `update_tickets` |
| `POST` / `DELETE` | `/api/v3/tickets/:id/links` (`ticket_id`, `relation` : `related`, `duplicate_of`, `has_duplicate`, `blocks`, `blocked_by`, `child`, `parent`) et `/api/v3/tickets/:id/links/:other` — lier, délier ; chaque ticket renvoie ses `links` | `update_tickets` |
| `GET` / `PUT` | `/api/v3/assets` (filtres `type`, `status`, `serial`, `q` ; `PUT` crée ou met à jour l'élément de même `serial`) et `/api/v3/assets/:id` — le [parc](./tickets#le-parc), s'il est activé | `read_assets` / `write_assets` |

Une clé agit **à son nom** (« API · nom de la clé ») : chaque action est au journal, source *API*, et ne compte jamais comme un membre du staff dans les statistiques. Une modification est **vérifiée en entier avant d'écrire** : une erreur ne change rien. L'en-tête `Idempotency-Key` sur `POST /tickets` renvoie le même ticket si la requête est rejouée (24 h), pratique pour un outil qui réessaie. Écritures : 120 par minute et par clé. Les tickets confidentiels n'existent pas pour une clé.

**v2** :

| Méthode | Route | Permission |
|---|---|---|
| `GET` | `/api/v2/space` (l'espace de la clé et ses permissions) | toute clé |
| `GET` | `/api/v2/tickets?status=open\|closed&contact_id=&limit=&cursor=` | `read_tickets` |
| `GET` | `/api/v2/tickets/:id` (ticket, messages, pièces jointes) | `read_tickets` |
| `GET` | `/api/v2/tickets/:id/attachments/:fileId` (téléchargement) | `read_tickets` |
| `POST` | `/api/v2/tickets/:id/close` | `close_tickets` |
| `GET` | `/api/v2/contacts?q=&limit=&cursor=` | `read_contacts` |
| `GET` | `/api/v2/contacts/:id` | `read_contacts` |
| `GET` | `/api/v2/stats` | `read_stats` |

Les listes répondent `{ "data": [...], "next_cursor": "…" }` : repasse `next_cursor` en `?cursor=` pour la page suivante, `null` à la fin (100 éléments par page au plus, 50 par défaut). Un ticket donne son demandeur avec son type (`owner.kind` : `discord`, `email` ou `web`), sa fiche contact (`contact_id`), son étape et ses tags. Les contacts exposent leurs identités, jamais les notes internes du staff ; la permission `read_contacts` est à cocher à part.

**v1**, maintenue sans changement :

| Méthode | Route | Permission |
|---|---|---|
| `GET` | `/api/v1/tickets?status=open\|closed&page=1` | `read_tickets` |
| `GET` | `/api/v1/tickets/:id` (ticket et messages) | `read_tickets` |
| `POST` | `/api/v1/tickets/:id/close` | `close_tickets` |
| `GET` | `/api/v1/stats` | `read_stats` |

La clé s'envoie dans l'en-tête `Authorization: Bearer <clé>`. La description **OpenAPI 3** est publique sur `/api/v3/openapi.json`, `/api/v2/openapi.json` et `/api/v1/openapi.json`, et la page **Documentation API** du dashboard l'affiche avec un exemple `curl` et une réponse type pour chaque route. Les tickets confidentiels ne sont jamais accessibles par l'API.

## Webhooks sortants

**Paramètres → Intégrations** : une adresse HTTPS prévenue à l'ouverture, à la fermeture et à la prise en charge d'un ticket (`ticket_open`, `ticket_close`, `ticket_claim`).

- En-tête `X-TicketBot-Event`, et signature `X-TicketBot-Signature-256` (HMAC-SHA256) si un secret est défini.
- Adresses privées et internes refusées (protection anti-SSRF), délai de 5 secondes.
- Ticket confidentiel : seulement `{ ticketId, confidential: true }`.

## Notifications push

Chaque membre du staff peut recevoir les nouveaux messages et réponses en notification du navigateur (**Profil → Notifications**), seulement pour les tickets qu'il peut voir. Il faut les clés `VAPID_*` du `.env`, générées par `setup.sh`.

## Le dashboard sur téléphone

Le dashboard **s'installe comme une application** (PWA), sur Android, iPhone et ordinateur : menu du navigateur → **Installer l'application** (Chrome, Edge) ou **Partager → Sur l'écran d'accueil** (Safari). Il s'ouvre alors en plein écran, sous le nom de l'instance, avec des raccourcis (appui long sur l'icône) vers **Ma file**, **Tickets** et **Tous mes espaces**, et reçoit les notifications push ci-dessus. Sans réseau, une page « Pas de connexion » s'affiche au lieu d'une erreur ; aucun ticket n'est gardé sur le téléphone. Rien à régler : il faut seulement que l'instance soit servie en HTTPS.

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

### Gmail et Microsoft 365, sans mot de passe

Google et Microsoft refusent les mots de passe ordinaires en IMAP et en SMTP (Microsoft a coupé cette connexion, Google exige des mots de passe d'application). Dans **Connexion à la boîte**, choisis **Google (Gmail, Workspace)** ou **Microsoft 365 (Outlook)**, puis **Se connecter avec…** : tu choisis la boîte du support chez le fournisseur et tu autorises Datick à la lire et à envoyer depuis elle.

- Les serveurs et le compte se règlent tout seuls ; aucun mot de passe n'est enregistré. Datick garde un **jeton d'accès** renouvelé tout seul, chiffré en base comme les mots de passe.
- **Reconnecter** si le fournisseur retire l'accès (mot de passe du compte changé, accès révoqué) : le message d'erreur sous les réglages le dit. **Déconnecter** retire l'accès (chez Google, il est aussi révoqué) et coupe la lecture de la boîte.
- Il faut d'abord que le propriétaire de l'instance déclare l'application, une fois pour tous les espaces : [Instance → Connexion → Boîtes e-mail](./instance#boites-e-mail-gmail-microsoft-365).

### Recevoir par webhook (Mailgun, Postmark, SendGrid, Amazon SES)

Au lieu de relever la boîte chaque minute, un service d'e-mails peut **envoyer chaque message à Datick dès qu'il arrive**. Dans **Arrivée des e-mails**, choisis **Envoyés par un service (webhook)** et le service, puis colle chez lui l'**adresse de réception** affichée (elle contient un secret propre à l'espace) :

| Service | Où la coller | Vérification |
|---|---|---|
| **Mailgun** | *Receiving → Create route*, action `forward` vers l'adresse (ajoute `/mime` à la fin pour recevoir le message brut) | La **clé de signature des webhooks** (*Sending → Webhooks*) : chaque requête est signée, une requête rejouée est refusée |
| **Postmark** | *Default Inbound Stream → Settings → Webhook URL* ; coche *Include raw email content* pour le message d'origine | Le secret de l'adresse |
| **SendGrid** | *Settings → Inbound Parse*, avec **POST the raw, full MIME message** coché | Le secret de l'adresse |
| **Amazon SES** | Règle de réception avec une action **SNS** (encodage Base64) vers un sujet, puis un abonnement HTTPS du sujet vers l'adresse (confirmé tout seul) | La **signature d'Amazon** sur chaque message, et l'**ARN du sujet** indiqué |

Un e-mail reçu ainsi suit exactement le même chemin qu'un e-mail relevé : fils, règles, pièces jointes, réponses automatiques ignorées. Les **réponses** partent toujours par le **SMTP** de la boîte (ou Google / Microsoft). **Nouvelle adresse** remplace l'adresse de réception (en cas de fuite) : l'ancienne cesse aussitôt de marcher. Une erreur (signature refusée, message brut manquant) s'affiche sous les réglages.

**Ce qui part par e-mail** : tout ce que le bot aurait envoyé en MP — accusé de réception, réponses du staff (dashboard, `/reply`, modèles), changement d'étape, fermeture. Le sujet porte `[#<ticket>-<jeton>]` : une réponse arrive dans son ticket seulement avec ce jeton **et** depuis l'adresse qui l'a ouvert — un expéditeur usurpé ne peut pas écrire dans le ticket de quelqu'un d'autre. Un **nouvel e-mail**, sans ce jeton ni réponse à un message du support, ouvre un **nouveau ticket**, même si la personne en a déjà un d'ouvert. Quand elle a plusieurs tickets ouverts, chaque réponse du staff part dans le fil du ticket concerné.

**Copies** : les personnes en copie (Cc) de l'e-mail qui ouvre un ticket, et ses autres destinataires, deviennent les **copies** du ticket (hors adresses du support et demandeur, 10 au plus). Elles reçoivent en copie tout ce qui part au demandeur, et peuvent **répondre dans le fil** : leur message entre dans le ticket, à leur nom. Quelqu'un que le demandeur met en copie plus tard s'ajoute aussi. Sur la fiche, le panneau **Copies** les liste ; qui peut répondre au ticket en ajoute ou en retire (au journal). Un ticket **confidentiel** n'a jamais de copie.

**Mise en forme et signatures** : les réponses partent en **HTML**, avec une version texte à côté : gras, italique, listes, citations, code et liens écrits comme dans un message (`**gras**`, `- élément`, `[texte](https://…)`). Elles sont présentées aux couleurs de l'espace (nom, logo et couleur de l'[espace membre](./espace-membre#aux-couleurs-du-serveur)), sauf si **Mettre en forme aux couleurs de l'espace** est décoché. Sous chaque réponse du staff viennent la **signature de la personne** (Profil → Signature des e-mails, propre à chaque espace, jamais sous une réponse anonyme), puis la **signature de l'espace** (réglée ici). Aucun HTML écrit par quelqu'un n'est repris tel quel : seules ces marques deviennent de la mise en forme, et seuls les liens `https://` et `mailto:` sont cliquables.

**Modèle des e-mails** (sous la même case, fondateurs et permission **Paramètres**) : un **logo** (adresse https) et une **couleur** propres aux e-mails, sinon ceux de l'espace membre ; un **en-tête** au-dessus du message (horaires, avertissement) et un **pied de page** (raison sociale, mentions, liens), en markdown. L'**aperçu** montre un e-mail d'exemple pendant qu'on écrit. Il s'applique aux réponses du staff et aux messages automatiques envoyés par e-mail. Tout vider revient au modèle de l'espace membre.

**Filtrage** (*Filtrage des e-mails reçus*) — avant qu'un e-mail devienne un ticket :

| Règle | Effet |
|---|---|
| **Expéditeurs refusés** | Domaines (sous-domaines compris) ou adresses : ignorés, sans réponse |
| **Seulement ces domaines** | Vide = tout le monde ; sinon les autres expéditeurs vont en **quarantaine** (pratique pour un support interne) |
| **Spam signalé par le serveur de messagerie** | Lu dans les en-têtes posés par SpamAssassin, Microsoft 365 (SCL), Mailgun, Amazon SES, ou un échec **DMARC** (expéditeur peut-être usurpé) : **quarantaine** (par défaut), ignoré, ou laissé passer comme avant. Le **score** à partir duquel filtrer se règle (5 par défaut) |
| **Taille maximale** | Au-delà (10 Mo au plus) : quarantaine |

Les réponses automatiques (absences, robots, retours d'erreur) sont toujours ignorées, tout comme les **boucles** : le même message reçu plus de 3 fois en 24 h du même expéditeur, ou notre propre message qui revient (nos e-mails portent l'en-tête `X-Loop`).

La **quarantaine** liste les messages mis de côté, avec la raison, pendant **30 jours** (500 au plus). **Libérer** traite le message comme s'il venait d'arriver (un ticket, ou la réponse à un ticket) ; **Supprimer** l'efface. Les deux sont au journal ; réservé aux fondateurs.

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

La personne donne son nom (facultatif), son **adresse e-mail**, le sujet si l'espace en propose, et son message. Le ticket est le sien comme pour l'[espace membre](./espace-membre) sans Discord : la confirmation et les réponses du staff lui arrivent par l'[e-mail de l'instance](./instance#e-mail-de-l-instance), avec le lien pour suivre et répondre dans l'espace membre. **Sans e-mail de l'instance, le formulaire reste indisponible.** Les champs personnalisés et le formulaire d'intake ne sont pas demandés par le widget. Le visiteur peut joindre jusqu'à 3 fichiers, avec les règles des pièces jointes des e-mails. Si la [base de connaissances publique](./espace-membre#base-de-connaissances-publique) est en ligne, les articles qui ressemblent au message sont proposés pendant la saisie, chacun ouvert dans un nouvel onglet.

**Anti-spam**, sans service tiers : un champ caché que seuls les robots remplissent, au moins 3 secondes entre l'ouverture du formulaire et l'envoi (heure signée, valable 2 heures), **5 envois par heure et par adresse IP**, **3 par adresse e-mail**, 60 nouveaux tickets web par heure pour l'espace, la limite de tickets par jour de l'espace et la blacklist. **Nouveau code** invalide le code déjà collé (en cas d'abus) ; chaque modification est au journal.

## Slack et Microsoft Teams

**Paramètres → Intégrations → Slack et Microsoft Teams** (fondateurs) relie un canal de chaque outil ; **Paramètres → Notifications** choisit ce qui y part (canal « Slack » ou « Teams » : un message par événement, quels que soient les destinataires). Un ticket confidentiel n'y donne que son numéro.

| | Slack | Microsoft Teams |
|---|---|---|
| **Relier** | Une app Slack avec *Incoming Webhooks* : colle l'adresse `https://hooks.slack.com/services/…` | Dans le canal, *Workflows* → « publier dans un canal quand une requête webhook est reçue » : colle l'adresse donnée |
| **Prendre** | Un vrai bouton : colle le *Signing secret* de l'app (*Basic Information → App Credentials*) et, dans *Interactivity*, l'adresse affichée (`…/api/chat/slack/actions/<espace>`). La première fois, la personne reçoit (visible d'elle seule) un lien pour relier son compte Slack à son compte ; ensuite « Prendre » lui attribue le ticket, avec ses droits | Ouvre le ticket dans le dashboard, qui propose de le prendre (Teams ne renvoie pas les clics d'un webhook) |
| **Répondre** | Ouvre le ticket dans le dashboard | Ouvre le ticket dans le dashboard |

Chaque appel de Slack est vérifié (signature HMAC de l'app, 5 minutes au plus) ; le bouton refuse une personne sans la permission **Prendre en charge** ou qui ne voit pas le ticket. Les adresses de webhook et le secret sont chiffrés et jamais réaffichés ; **Tester** envoie un message d'essai.

## CRM : HubSpot ou Salesforce

**Paramètres → Intégrations → CRM** (fondateurs) branche le CRM de l'espace, **en lecture seule** :

- **Fiche du demandeur** sur chaque ticket : nom, poste, société (secteur, chiffre d'affaires), propriétaire, étape, téléphone et un lien vers la fiche. Elle est cherchée par l'adresse e-mail du demandeur (ticket par e-mail ou web, ou adresse de sa fiche contact) et gardée 10 minutes ; seuls ceux qui voient le ticket la voient.
- **Synchronisation** des sociétés vers les **organisations** (avec le domaine de leur site) et des contacts vers les **contacts** (rattachés à leur société), à la main (**Synchroniser maintenant**, trois fois au plus en 10 minutes) ou chaque nuit. Une seconde synchronisation met à jour ce qu'elle a déjà créé, sans doublon ; chaque passage est au journal.

| CRM | Ce qu'il faut |
|---|---|
| **HubSpot** | Un **jeton d'application privée** (Paramètres HubSpot → Intégrations → Applications privées) avec les droits de lecture des contacts, des sociétés et des propriétaires ; l'ID du portail (facultatif) pour les liens |
| **Salesforce** | L'adresse de l'instance (`https://societe.my.salesforce.com`) et une **application connectée** avec le flux *client credentials* (identifiant et secret), ou un jeton d'accès |

Le jeton et le secret sont **chiffrés** et jamais renvoyés au navigateur ; Datick n'appelle que `api.hubapi.com` ou l'instance Salesforce indiquée, et n'écrit jamais dans le CRM.

## Sauvegarde de la configuration

**Paramètres → Sauvegarde** : export JSON de la configuration (paramètres, grades, tags, formulaires, panels, champs, FAQ et articles, modèles et macros, règles, procédures, statuts personnalisés, équipes) et import sur ce serveur ou un autre. Les secrets ne sont jamais exportés.

Depuis la v6, l'export contient aussi les **objectifs SLA** (sans leurs niveaux d'escalade, qui nomment des personnes), le **catalogue de services** et les **modèles de tâches** ; les organisations, champs et objectifs cités par les règles le sont par leur nom. L'import fusionne par nom et ne supprime rien. Une macro qui change le statut retrouve le statut du même nom dans l'espace d'arrivée. La catégorie Discord d'un statut n'est reprise que si tu coches la reprise des salons. Les équipes arrivent avec leurs réglages, leurs sujets et leurs tags, mais sans membres : ce sont des comptes propres à chaque espace, et une équipe déjà présente garde les siens.

## Venir d'un autre bot de tickets

**Paramètres → Sauvegarde → Importer depuis un autre bot** reprend les tickets **encore ouverts** d'un autre bot (Ticket Tool, Tickets, Helper.gg…), sans rien supprimer :

1. choisis la catégorie Discord où l'autre bot range ses tickets, puis **Analyser** ;
2. pour chaque salon, le dashboard retrouve le membre qui l'a ouvert (dans les permissions du salon, ou une mention dans son sujet) ; les salons sans membre identifiable sont signalés ;
3. coche les salons à reprendre et **Reprendre** : chacun devient un ticket de ce bot.

Options : copier les 100 derniers messages du salon dans l'historique du ticket (messages du membre et réponses du staff ; ceux des bots sont ignorés), prévenir chaque membre en MP — dans sa langue — qu'il peut désormais répondre au bot, et déplacer les salons dans la catégorie « Ouvert ». Ensuite, retire l'ancien bot de ton serveur : les nouveaux tickets passent par celui-ci.

Les anciens tickets **déjà fermés** ne sont pas importés : aucun de ces bots ne permet d'exporter ses données. Garde leurs transcripts là où l'autre bot les a mis.

## Venir d'un autre outil d'assistance

**Paramètres → Sauvegarde → Importer depuis un autre outil** (fondateurs) reprend un export de **Zendesk, Freshdesk, GLPI, osTicket, Zammad**, ou n'importe quel CSV / JSON aux colonnes courantes :

1. exporte depuis l'autre outil (CSV, JSON, ou un objet JSON par ligne) ; découpe les exports de plus de 10 Mo ou 5 000 lignes ;
2. choisis l'outil et ce que contient le fichier : **tickets**, **contacts**, **organisations** ou **articles** de la base ;
3. **Essai à blanc** : rien n'est écrit, le dashboard compte les lignes et montre comment il a compris la première (sujet, demandeur, statut…) ;
4. **Importer**.

Les colonnes sont reconnues par leur nom, en anglais ou en français, majuscules et accents ignorés (`subject`, `Titre`, `requester.email`, `Demandeur`, `Statut`…). Le demandeur est retrouvé par son **adresse e-mail** : il retrouve ses tickets dans l'espace membre comme pour un ticket par e-mail. Les statuts résolus ou fermés (y compris les codes de GLPI et Freshdesk) donnent des tickets fermés, les autres des tickets ouverts ; la priorité, les dates et l'organisation sont reprises, l'organisation créée si besoin. Quand l'export contient la conversation (`comments`, `conversations`, `articles`), les messages publics deviennent l'historique du ticket et les notes privées des notes internes. Les articles arrivent **en brouillon**, sans HTML, à relire avant publication. Chaque ligne déjà importée est retenue par son identifiant d'origine (`ID`, `Contact ID`, `Company ID`…, ou, sans colonne d'identifiant, par son contenu) : reprendre le même export ne crée pas de doublon. Coche **Mettre à jour ce qui est déjà importé** pour reprendre un export plus récent : les noms et organisations des contacts, les domaines des organisations, le texte des articles (l'ancien reste dans les versions précédentes) et, pour un ticket, son statut et sa priorité seulement (sa conversation reste celle importée la première fois). Chaque import est inscrit au journal d'audit.

