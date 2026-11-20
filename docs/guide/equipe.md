# Équipe et permissions

## Les comptes

| Rôle | Accès |
|---|---|
| **Nouveau** | Page d'attente, aucun accès, jusqu'à ce qu'un grade lui soit attribué |
| **Support** | Le dashboard, limité aux **permissions de ses grades** — sans grade, aucun droit |
| **Fondateur** | Tout, sur son serveur : paramètres, équipe, blacklist, transcripts, clés API… |

Le **fondateur** d'un serveur est la personne qui a invité le bot (à défaut, le propriétaire du serveur) ; il peut en nommer d'autres. Le **propriétaire de l'instance** est fondateur sur tous les serveurs.

**Accès par rôle Discord** : les membres qui ont un rôle *support* ou *chef support* choisi dans **Paramètres → Accès et sécurité** obtiennent un compte à leur connexion, avec le grade associé. Ils le perdent avec le rôle Discord (vérifié à la connexion puis toutes les 5 minutes). Les comptes gérés à la main dans **Équipe** ne sont jamais touchés par cette synchronisation.

À la connexion, un membre du staff qui n'a accès qu'à un serveur arrive directement sur son dashboard.

**Inviter par e-mail** : **Équipe → Gestion → Inviter par e-mail**, avec le rôle (*Support* ou *Fondateur*) et, pour le support, un grade, puisque sans grade il n'a aucun droit. La personne reçoit un lien valable **7 jours**, qui ne sert qu'**une fois** :
- sans compte, elle crée le sien (nom et mot de passe), l'adresse étant confirmée par le lien ;
- avec un compte qui utilise déjà cette adresse, elle se connecte d'abord, puis revient à l'invitation ;
- déjà connectée, c'est ce compte qui rejoint l'équipe.

L'invitation part par l'[e-mail de l'instance](./instance), qui doit être configuré. La liste montre les invitations en attente, acceptées, révoquées et expirées ; **Révoquer** annule un lien pas encore utilisé, et inviter à nouveau la même adresse remplace l'invitation en attente. Seul un fondateur invite un fondateur ; un membre avec la permission `manage_users` invite au rôle support, avec un grade dont il a déjà les permissions. Un membre invité est géré à la main : la synchronisation des rôles Discord ne le retire jamais.

## Les grades

Un grade est un ensemble de permissions. Chaque action du dashboard et des commandes Discord est vérifiée côté serveur.

| Permission | Autorise |
|---|---|
| `view_tickets` | Voir les tickets, notes, historique, recherche, notifications |
| `reply_ticket` | Répondre, noter, programmer, renommer, changer d'étape ou de sujet, tags |
| `claim_ticket` | Prendre en charge ou libérer un ticket |
| `close_ticket` | Fermer ou rouvrir un ticket |
| `manage_participants` | Ajouter ou retirer des participants |
| `create_ticket` | Ouvrir un ticket pour un membre |
| `view_transcripts` | Consulter les transcripts |
| `manage_users` | Attribuer des grades (pas à soi-même, ni un grade plus puissant que les siens), inviter au rôle support |
| `manage_grades` | Créer et modifier des grades, restreindre la visibilité d'un ticket |
| `manage_settings` | Tags, FAQ, champs, procédures, incidents, santé du serveur |
| `view_audit` | Consulter le journal |

Un grade peut avoir un **parent** : les membres du parent voient aussi ce que voient les grades enfants. Un ticket **restreint à un grade** n'est visible que de ce grade, de ses parents et des fondateurs — sur Discord aussi, où son salon est fermé aux autres.

## Les rôles rattachés à des tags

**Rôles** (fondateurs) : des groupes de membres du staff, rattachés à un ou plusieurs **tags**. Un ticket qui porte l'un de ces tags n'est plus visible que des membres du rôle et des fondateurs, partout : liste, fiche, recherche, statistiques, notifications, commandes Discord, salon du ticket. Utile pour une équipe Comptabilité, Modération, Partenariats…

## Les équipes et leurs files

**Équipe → Équipes** (fondateurs) regroupe le staff en équipes (« Facturation », « Technique »…), jusqu'à 30 :

| Réglage | |
|---|---|
| **Membres** | Le staff de l'espace qui en fait partie (une personne peut être dans plusieurs équipes) |
| **Sujets et tags** | Un nouveau ticket d'un de ces sujets, ou portant un de ces tags (posés par les [règles par sujet](./tickets) ou par une [adresse e-mail](./integrations#tickets-par-e-mail)), va à l'équipe |
| **Attribution** | *Aucune* : le ticket attend dans la file de l'équipe. *Tour à tour* : chaque membre à son tour. *Selon la charge* : au membre qui a le moins de tickets ouverts |
| **Plafond** | Tickets ouverts au plus par personne ; au-delà, on passe au suivant (0 = sans plafond) |
| **Objectif interne (OLA)** | Le temps que l'équipe se donne pour un ticket, compté **depuis son arrivée chez elle**, en heures ouvrées de ses horaires, en pause pendant l'attente du demandeur ; avec ses niveaux d'escalade (par exemple « à 100 %, passer à l'équipe Niveau 2 ») |

L'attribution automatique passe les membres **absents** ou **en vacances**, ceux qui **ne peuvent pas voir** le ticket (grade, rôles rattachés à des tags) et ceux au plafond ; si personne n'est disponible, le ticket reste dans la file de l'équipe. Les tickets **confidentiels** ne sont jamais routés. L'attribution est notée au journal du ticket et la personne est prévenue comme pour une attribution à la main.

### Niveaux de support et escalade

Une équipe peut avoir un **niveau** (1, 2, 3… : *Niveau* dans son réglage). Sur la fiche d'un ticket ouvert, **Escalader au niveau N** (permission d'attribuer) le confie à l'équipe du **niveau suivant** — le plus bas au-dessus de celui de son équipe ; un ticket sans équipe, ou dont l'équipe n'a pas de niveau, va au niveau le plus bas. Un **motif** est demandé : il est noté en note interne et au journal. Les personnes attribuées lâchent le ticket (sauf **Garder les personnes attribuées**), et la nouvelle équipe l'attribue comme elle le fait d'habitude. Une [règle](./automatismes#les-regles-automatiques) peut aussi escalader (action **Escalader au niveau supérieur**). Un ticket confidentiel ne change jamais d'équipe.

Dans **Analytiques → Rapports**, la colonne **Escaladés** compte, par équipe, les tickets qu'elle a fait monter et leur part ; pour les autres regroupements, les tickets escaladés au moins une fois. Elle est dans les exports.

### Compétences et langues

**Équipe → Compétences** : les fondateurs créent les compétences de l'espace (« Réseau », « Comptabilité »…) et disent qui a lesquelles ; chacun indique les **langues** dans lesquelles il répond. Un ticket **demande** des compétences : celles de son **sujet** (réglées plus bas sur la même page ; une catégorie couvre ses sous-catégories), celles qu'une [règle](./automatismes#les-regles-automatiques) ajoute (action **Compétence demandée**, à placer avant l'action **Équipe**) et celles ajoutées sur la fiche (permission **Répondre**).

Une équipe qui attribue toute seule choisit d'abord parmi les membres qui ont **toutes** les compétences demandées, puis parmi eux ceux qui **parlent la langue du demandeur** (celle de ses messages, quand le bot répond dans la langue de chacun). Si personne ne convient, toute l'équipe reste possible, comme avant. Les compétences et les sujets font partie de l'[export de configuration](./integrations#sauvegarde-de-la-configuration) ; qui a quelle compétence reste propre à l'espace.

Chaque membre retrouve les tickets de ses équipes dans **Ma file → Mes équipes**. La fiche ticket montre son équipe et permet de la changer (permission d'attribuer) : confier le ticket à une équipe qui attribue le donne aussitôt à un de ses membres s'il n'a personne. La liste des tickets se filtre par équipe ou « Sans équipe ». Supprimer une équipe laisse ses tickets, sans équipe.

## Double authentification

- Chacun peut activer la **2FA** (application TOTP) dans son **Profil**, avec 10 codes de secours.
- Un fondateur peut l'**imposer** aux fondateurs ou à tout le staff (**Paramètres → Accès et sécurité**).
- **Déconnexion après inactivité** réglable (15 minutes à 8 heures).
- Une connexion depuis un **nouvel appareil** envoie un MP au titulaire du compte.

## Organisation au quotidien

- **Disponibilité** (disponible, occupé, absent) sous son nom dans le menu, **mode vacances** et **absences planifiées** (Profil pour soi, Équipe pour les autres).
- **Mon activité** : ses chiffres sur 7, 30 ou 90 jours comparés à l'équipe.
- **Analytiques** : volume, délais, satisfaction, comparaison de périodes, réouvertures, temps passé, [rapports](#les-rapports), exports CSV et rapport mensuel PDF.

## Les tableaux de bord

Menu **Tableaux** : chacun compose ses **tableaux de bord** de **widgets** — un **compteur** (tickets ouverts, ouverts sans attribution, mes tickets, créés ou fermés sur la période, objectifs SLA dépassés, en attente du demandeur), une **courbe** des tickets créés et fermés par jour, une **liste** de tickets ouverts (urgents d'abord), le taux d'**objectifs SLA tenus**, la **satisfaction** (moyenne, part de 4 ou 5, répartition), la **résolution au premier contact** (voir ci-dessous). Chaque widget a ses **filtres** : équipe, organisation (sous-organisations comprises), priorité, période.

Un tableau est **personnel**, **partagé avec une équipe** dont on fait partie, ou (fondateurs) **avec tout le staff** ; seul son auteur le modifie. Les chiffres sont toujours calculés pour **qui regarde**, à travers ce qu'il a le droit de voir : un même tableau partagé ne montre pas un ticket confidentiel à qui ne le voit pas.

## Les rapports

**Analytiques → Rapports** regroupe les tickets ouverts sur la période (7, 30, 90 ou 365 jours, ou une **période libre** du … au …) :

| Regrouper | |
|---|---|
| **Par équipe** | Les [équipes](#les-equipes-et-leurs-files), plus « Sans équipe » |
| **Par catégorie** | La catégorie du sujet : une sous-catégorie (« Facturation › Remboursement ») compte dans sa catégorie |
| **Par sujet** | Le sujet complet, sous-catégorie comprise |
| **Par canal** | Discord, e-mail, ou web (espace membre et widget) |
| **Par type** | Incidents et demandes, si l'espace utilise les [types](./tickets#les-types-incident-ou-demande) |
| **Par organisation** | Les [organisations](./tickets#les-organisations) des demandeurs, plus « Sans organisation » |
| **Par personne** | La première personne attribuée, plus « Sans attribution » |
| **Par priorité** | Basse, normale, urgente |

Pour chaque groupe : tickets ouverts, fermés, encore ouverts, délai médian de première réponse, durée médiane jusqu'à la fermeture, note moyenne (et nombre de notes), temps passé, escaladés, et **résolution au premier contact** : la part des tickets fermés qui l'ont été avec **une seule réponse** du staff (les notes internes ne comptent pas) et jamais rouverts, parmi les tickets fermés qui ont reçu au moins une réponse. Le même tableau se télécharge en **CSV**, **XLSX** (classeur Excel, LibreOffice, Numbers) ou **PDF**. Les **rapports programmés** (fondateurs et permission **Journal d'audit**) l'envoient par e-mail **chaque lundi** ou **le 1er du mois**, à l'heure choisie, en pièce jointe ; calculés avec ce que voit leur auteur ; les fondateurs les envoient à n'importe quelle adresse, les autres à leur propre adresse vérifiée. Les chiffres ne comptent que les tickets que la personne a le droit de voir : un ticket confidentiel ou restreint à un grade n'y entre pas pour les autres ; les tickets fusionnés dans un autre ne sont comptés qu'une fois.
- **Journal** : chaque action, avec son auteur et sa source (dashboard, Discord, automatisme, API), filtrable et exportable.
