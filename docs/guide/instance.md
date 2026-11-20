# Section Instance

L'**instance**, c'est ton installation : tous ses **espaces** (un par équipe ou communauté de support), avec ou sans serveur Discord relié. Elle a un propriétaire, et un seul endroit pour la gérer.

## Le propriétaire

Le **propriétaire de l'instance** est le compte Discord qui possède l'application du bot (portail développeur → *General Information*). Pour une application d'équipe : le propriétaire et les admins de l'équipe. Tu peux ajouter des co-propriétaires avec `OWNER_IDS` dans le `.env`.

- Il se connecte au dashboard comme tout le monde, avec les [moyens de connexion](#moyens-de-connexion) de l'instance.
- Il est **fondateur dans chaque espace** de l'instance.
- Lui seul voit la liste de tous les espaces à la connexion, obtient le lien d'invitation du bot et accède à la section **Instance** (menu Administration, ou `/instance`).

## Les espaces

Un espace, c'est l'endroit où vivent des tickets, une équipe et des réglages (jusqu'à la v3, on parlait de « serveur »). Inviter le bot sur un serveur Discord **crée un espace relié à ce serveur, actif dès son arrivée** : sa base est créée, la personne qui a invité le bot en devient fondateur et reçoit un MP avec le lien du dashboard. Il n'y a pas de validation.

::: warning Bot privé
Dans le portail Discord, onglet *Bot*, décoche **Public Bot** : sinon n'importe qui peut ajouter ton bot à son serveur, et ce serveur deviendrait un espace de ton instance. `ALLOWED_GUILDS` restreint en plus la liste des serveurs Discord acceptés ; un avertissement s'affiche au démarrage si le bot est public sans cette liste.
:::

**Plusieurs communautés** : un modèle de réponse créé avec la portée **Tous les espaces** (fiche ticket → Modèles) est proposé au staff de chacun de tes espaces, sans être recopié. Le staff l'utilise, toi seul le modifies ; il ne peut pas ajouter de tag, puisque les tags sont propres à chaque espace.

**Un espace sans Discord** : **Instance → Espaces → Créer un espace**. C'est un espace de support sans serveur Discord : tickets par [e-mail](./integrations#tickets-par-e-mail), espace membre, dashboard, avec ses propres réglages, son équipe et son journal. Ses tickets n'ont pas de salon (format « Aucun salon »), rien n'est jamais demandé à Discord à son sujet, et le dashboard y masque les fonctions propres à Discord (panels, rôles, santé du serveur, newsletter, salons). Tu en es fondateur ; il apparaît dans **Mes espaces** quelle que soit ta façon de te connecter.

**Comme un autre espace** : à la création, choisis « Comme « *espace* » » pour reprendre sa configuration, celle de l'[export de configuration](./integrations#sauvegarde-de-la-configuration) : statuts, sujets, champs, grades, tags, formulaires, objectifs SLA, règles, catalogue de services, modèles de tâches et de réponses, base de connaissances. L'équipe, les tickets, les contacts et les salons Discord ne sont jamais repris ; le nouvel espace reste sans Discord.

**Relier ou délier Discord** : sur la ligne d'un espace sans Discord, le bouton **Relier à Discord** demande l'identifiant du serveur Discord puis donne le lien d'invitation du bot, valable une heure. À l'arrivée du bot, l'espace devient celui du serveur : tickets, réglages, équipe et journal sont conservés, aucun nouvel espace n'est créé. À l'inverse, **Délier de Discord** (confirmé en tapant le nom) garde l'espace et tout son contenu : ses tickets ouverts continuent sans salon, le format passe à « Aucun salon », et le bot quitte le serveur. Réinviter le bot sur ce serveur le relie de nouveau.

## Les pages

| Page | |
|---|---|
| **Vue d'ensemble** | Espaces, tickets ouverts, tickets par jour sur 30 jours, staff, erreurs des dernières 24 heures, tableau par espace |
| **Espaces** | Créer, relier à Discord ou délier, suspendre, réactiver, mettre en maintenance, supprimer (sa base est effacée, le bot quitte le serveur Discord relié) ; nommer ou retirer des fondateurs |
| **Connexion** | Les [moyens de connexion](#moyens-de-connexion) du dashboard : Discord, Google, Microsoft, OpenID Connect, annuaire LDAP / AD |
| **Santé** | Version en cours et [mise à jour](./mise-a-jour), état des [sauvegardes](./sauvegardes#suivi-et-alertes), connexion Discord, base, Redis, tâches planifiées, mémoire, version de schéma de chaque base, **serveurs Discord** (diagnostic de chacun, ci-dessous) ; espace de démonstration (tickets, équipes à niveaux, compétences, organisations et contrats, parc, changements, mise en production, comité et page de statut fictifs ; rien n'y part vers l'extérieur), [métriques Prometheus](#supervision-prometheus) |
| **Erreurs** | Journal centralisé des erreurs du bot, du dashboard et des navigateurs, avec filtres ; **alerte** par MP (au propriétaire par défaut) ou webhook au-delà d'un seuil, et en cas de déconnexion de Discord |
| **Journal** | Chaque modification faite depuis la section, avec son auteur et l'espace concerné |
| **Blocages** | Adresses IP bloquées par les limites de connexion ou d'API, avec déblocage |

## Moyens de connexion

**Instance → Connexion** choisit comment on se connecte au dashboard. **L'adresse e-mail et le mot de passe** restent toujours possibles : c'est le secours si un fournisseur tombe.

| Fournisseur | À régler |
|---|---|
| **Discord** | Rien : il utilise l'application Discord de l'instance. **Activé** sur une instance venue de la v3 |
| **Google** | Console Google Cloud → API et services → Identifiants → *ID client OAuth* (application Web) : colle l'identifiant et le secret |
| **Microsoft** | Portail Azure → Microsoft Entra ID → *Inscriptions d'applications* (plateforme Web), puis *Certificats et secrets*. Annuaire : `common` (tous les comptes), `organizations` (comptes professionnels) ou l'identifiant de ton annuaire |
| **OpenID Connect** | Keycloak, Authentik, Okta, Zitadel… : un nom affiché, l'adresse du fournisseur (*issuer*, en `https://`), l'identifiant et le secret d'un client confidentiel |

Chaque fournisseur affiche son **adresse de retour**, à déclarer telle quelle chez lui (`https://ton-domaine/api/auth/oidc/google/callback`, etc.). Les secrets sont chiffrés en base, jamais réaffichés, et masqués dans le journal de l'instance.

**Qui peut se connecter ainsi** : personne ne reçoit de compte en se connectant ; les comptes viennent des [invitations](./equipe#les-comptes), de Discord ou de l'installation. À la première connexion Google, Microsoft ou OpenID Connect, l'identité est reliée au compte qui a **la même adresse e-mail confirmée**, et seulement si le fournisseur garantit cette adresse. Sinon, chacun la relie lui-même depuis **Profil → Connexion → Relier**, une fois connecté. Microsoft ne garantit pas les adresses de ses comptes : sauf si ton application renvoie la revendication facultative `xms_edov`, chacun relie Microsoft depuis son profil.

**Discord** : couper la connexion Discord ne coupe pas l'intégration (bot, MP, salons, panels) ; l'espace membre garde aussi sa connexion Discord pour les demandeurs. Tu ne peux pas couper le dernier moyen de connexion de ton propre compte : définis d'abord un mot de passe ou relie un autre fournisseur dans **Profil → Connexion**.

### SAML 2.0

**Instance → Connexion → SAML 2.0** branche le fournisseur d'identité de l'organisation (Entra ID, Okta, ADFS, Keycloak, Authentik…). Datick y est déclaré comme fournisseur de service avec deux adresses affichées dans le formulaire : l'**identifiant (entity ID) et les métadonnées** `https://<ton domaine>/api/auth/saml/metadata`, et l'**adresse de retour (ACS)** `…/api/auth/saml/acs` (liaison HTTP-POST). Il faut l'adresse de connexion du fournisseur (SSO, liaison HTTP-Redirect), son **certificat de signature** (PEM) et, au besoin, son identifiant, les noms des attributs (adresse, nom, groupes) et un **groupe autorisé**.

- La **réponse et l'assertion doivent être signées** par ce certificat ; le destinataire, l'audience, la demande à laquelle elle répond (gardée 10 minutes, consommée une fois), la date (3 minutes d'écart au plus) sont vérifiés ; une réponse rejouée est refusée.
- La personne est reconnue par son identifiant (NameID), sinon rattachée au compte qui a la même **adresse vérifiée** ; personne n'obtient de compte en se connectant ainsi. La double authentification du compte s'applique.
- L'instance doit être servie en **https**. Le bouton « Continuer avec … » apparaît sur la page de connexion.
- **Vérifier le réglage** lit le certificat (et sa date de fin) et joint l'adresse du fournisseur ; **Connexion d'essai** ouvre le fournisseur dans un nouvel onglet et affiche ce qu'il renvoie (identifiant, adresse, groupes, compte Datick trouvé), sans ouvrir de session.
- **Déconnexion unique (SLO)**, facultative : avec l'adresse de déconnexion du fournisseur (liaison HTTP-Redirect), se déconnecter de Datick renvoie vers celle du fournisseur, et une demande de déconnexion **signée** du fournisseur ferme toutes les sessions Datick de la personne (une demande non signée est refusée). L'adresse `…/api/auth/saml/slo` est alors à déclarer chez le fournisseur et figure dans les métadonnées. Si le fournisseur exige des demandes signées, donne une clé privée et un certificat propres à Datick (la clé est chiffrée, jamais renvoyée).

### Annuaire LDAP / Active Directory

Sous les fournisseurs, **Annuaire LDAP / Active Directory** permet au staff de se connecter avec **son identifiant et son mot de passe de l'annuaire** (formulaire « Continuer avec… » sur la page de connexion). Les boutons **OpenLDAP** et **Active Directory** remplissent les valeurs habituelles.

| Réglage | Exemple |
|---|---|
| **Adresse du serveur** | `ldaps://annuaire.example.com:636`, ou `ldap://annuaire.example.com:389` avec **StartTLS** coché : jamais en clair |
| **Compte de service** | Un compte en lecture seule (`cn=datick,ou=services,dc=example,dc=com`) et son mot de passe, chiffré en base et jamais réaffiché |
| **Base de recherche** | `ou=people,dc=example,dc=com` |
| **Attribut de l'identifiant** | `uid` (OpenLDAP), `sAMAccountName` (Active Directory) |
| **Filtre des personnes** | `(objectClass=person)` ; pour Active Directory, les comptes désactivés sont écartés |
| **Groupe autorisé** | Facultatif : seuls ses membres se connectent (`member`, `uniqueMember` ou `memberUid`) |
| **Certificat de l'autorité** | Si l'annuaire utilise une autorité interne. Le certificat du serveur est toujours vérifié, sauf si tu décoches la vérification (déconseillé) |

**Tester** vérifie le compte de service et compte les personnes trouvées, avant d'enregistrer. À la connexion, la personne est cherchée avec le compte de service, puis son mot de passe est vérifié par l'annuaire lui-même : Datick ne le garde pas. Comme pour les autres fournisseurs, personne ne reçoit de compte : le compte de l'annuaire est relié au compte qui a **la même adresse e-mail confirmée**, puis reconnu par son identifiant stable (`entryUUID`, `objectGUID`). La double authentification du compte s'applique ; 10 échecs en un quart d'heure bloquent l'identifiant.

Les fondateurs importent aussi les personnes de l'annuaire comme **contacts**, rattachés à leur organisation : **Paramètres → Sauvegarde → Importer depuis un autre outil → Annuaire LDAP / AD** (réservé au propriétaire de l'instance), avec la base et le filtre des contacts réglés ici.

**Synchronisation** : choisis une fréquence (**chaque heure**, **chaque jour**, ou à la main) et les espaces qui reçoivent les contacts ; les personnes de l'annuaire y deviennent des contacts, et celles déjà importées sont **mises à jour** (nom, organisation). **Synchroniser maintenant** lance tout de suite ; la date et le résultat de la dernière synchronisation s'affichent dessous.

**Comptes créés à la connexion** (désactivé par défaut) : un membre du **groupe autorisé** qui n'a pas encore de compte en reçoit un à sa première connexion, avec l'adresse de l'annuaire (tenue pour confirmée), et rejoint les espaces choisis avec le rôle **support** (un fondateur lui donne ensuite d'autres droits). Il faut un groupe autorisé ; une adresse déjà prise par un compte, même non confirmée, n'en reçoit pas un second. Chaque compte créé est inscrit au journal de l'instance.

### Boîtes e-mail (Gmail, Microsoft 365)

Sous les moyens de connexion, **Boîtes e-mail** déclare les applications avec lesquelles les espaces connectent leur boîte de support [sans mot de passe](./integrations#gmail-et-microsoft-365-sans-mot-de-passe). Chacune affiche son adresse de retour (`https://ton-domaine/api/email/oauth/google/callback`, etc.) ; le secret est chiffré et jamais réaffiché.

| Fournisseur | À régler |
|---|---|
| **Google** | Console Google Cloud : active l'**API Gmail**, puis *ID client OAuth* (application Web). Pour Google Workspace, audience **Interne** : en mode *Test*, Google coupe l'accès au bout de 7 jours |
| **Microsoft** | Portail Azure → Microsoft Entra ID → *Inscriptions d'applications* (plateforme Web), autorisations déléguées d'*Office 365 Exchange Online* : `IMAP.AccessAsUser.All`, `SMTP.Send`, plus `offline_access`. L'envoi SMTP authentifié doit être permis sur la boîte. Annuaire : `common`, `organizations` ou l'identifiant de ton annuaire |

Ce peut être la même application que pour la connexion au dashboard, avec les deux adresses de retour déclarées.

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
| `ticketbot_live_chats`, `ticketbot_live_chats_waiting` | Chats en direct en cours, et ceux sans réponse du staff (par serveur) |
| `ticketbot_monitoring_alerts_firing`, `ticketbot_monitoring_alerts_24h` | Alertes de supervision encore actives, et reçues sur 24 h (par serveur) |
| `ticketbot_sms_today{result}` | SMS envoyés (`sent`) et en échec (`failed`) aujourd'hui (UTC, par serveur) |
| `ticketbot_backup_last_success_timestamp_seconds{kind}`, `ticketbot_backup_problems` | [Sauvegardes](./sauvegardes) : dernière réussite, vérification, copie hors du serveur |
| `ticketbot_update_available`, `ticketbot_info{version}` | Version |

Uniquement des chiffres : aucun sujet de ticket ni nom de membre. Les valeurs sont recalculées au plus toutes les 15 secondes. **Uptime Kuma** : moniteur *HTTP(s) - Mot-clé* sur `/metrics`, en-tête `Authorization: Bearer tbm_…`, mot-clé `ticketbot_discord_connected 1`.

## Confidentialité

Une page de confidentialité est intégrée (`/confidentialite`) et liée depuis la connexion et l'espace membre : ce qui est enregistré, pourquoi, qui y a accès, combien de temps. Indique un e-mail de contact avec `CONTACT_EMAIL`, ou remplace la page par la tienne avec `PRIVACY_URL`.
