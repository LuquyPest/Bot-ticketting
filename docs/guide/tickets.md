# Tickets

## Côté membre

1. Le membre envoie un **message privé** au bot. S'il a déjà des tickets ouverts, le bot lui demande dans lequel envoyer son message, ou s'il en ouvre un nouveau.
2. S'il est sur plusieurs serveurs qui utilisent le bot, il choisit le serveur.
3. Si la **FAQ automatique** reconnaît sa question, le bot propose jusqu'à trois réponses ; « Ouvrir un ticket quand même » reste possible.
4. Le bot demande le **sujet** (boutons, ou texte libre), puis les **champs personnalisés** et le **formulaire** éventuels. Sans réponse sous 10 minutes, le ticket s'ouvre sans sujet. Ces conversations sont gardées dans Redis : un redémarrage ne fait rien perdre.
5. Le ticket est créé : un salon (ou un fil) privé, nommé d'après le sujet. Les messages suivants du membre y sont relayés.
6. Les réponses du staff arrivent en MP, avec le serveur et le numéro du ticket en en-tête, et un bouton **Fermer mon ticket**.
7. À la fermeture : **note** de 1 à 5 étoiles, commentaire facultatif, et bouton **Rouvrir mon ticket** pendant quelques jours (7 par défaut). Une note basse prévient les fondateurs et les chefs support.

Le membre peut aussi ouvrir un ticket depuis un **panel** à boutons publié dans un salon, ou depuis l'[espace membre](./espace-membre) web. Un membre blacklisté sur un serveur ne peut pas y ouvrir de ticket.

::: info Demande confidentielle
Au moment du sujet, le membre peut demander un ticket **confidentiel** (signalement d'un membre du staff, harcèlement…). Seuls les **fondateurs** le voient, partout : liste, fiche, recherche, statistiques, notifications, salon Discord fermé au staff avant le premier message. Chaque consultation est inscrite au journal.
:::

**Langue** : les messages du bot suivent le réglage du serveur (**Paramètres → Général → Langue du bot**) — français, anglais, espagnol, allemand, italien, portugais, ou **automatique** : la langue Discord du membre si elle est l'une de celles-ci, l'anglais sinon. Les textes personnalisés (bienvenue, fermeture, FAQ) et les réponses du staff restent tels qu'écrits.

### Catégories et sous-catégories

Les sujets se rangent en **catégories** et **sous-catégories** (**Paramètres → Général → Sujets de ticket**) : « Facturation », puis « Facturation › Remboursement », « Facturation › Changement d'offre »… Deux niveaux, jusqu'à 60 sujets ; les sujets déjà en place sont des catégories. Sur Discord, le membre choisit la catégorie, puis la sous-catégorie (ou « autre demande » dans la catégorie) ; l'espace membre et le widget les listent avec leur chemin.

Une sous-catégorie **hérite** de ce qui est réglé sur sa catégorie : règles par sujet, champs personnalisés, formulaire d'ouverture, procédures, modèles suggérés, incidents, équipe. Ce qui est réglé sur la sous-catégorie ne s'applique qu'à elle. Chaque sujet peut avoir un **délai** : il remplace celui de chaque étape qui en a un (une étape sans délai reste sans), la sous-catégorie prenant celui de sa catégorie si elle n'a pas le sien.

## Côté staff

- **Répondre** depuis la fiche du dashboard (avec un fichier jusqu'à 8 Mo, ou une capture collée), par `/reply`, ou anonymement par `/areply` (affiché « Support »). Un message tapé directement dans le salon Discord reste une note interne, jamais envoyée au membre.
- **Contacter un membre** soi-même : bouton **Nouveau ticket** de la page Tickets, `/contact`, ou clic droit sur un message → *Applications* → *Créer un ticket*.
- **Format des tickets** : un salon par ticket, avec des catégories de débordement au-delà de 50 salons et des fils privés au-delà de 500 ; ou salons uniquement ; ou fils privés uniquement ; ou **aucun salon** : les tickets ne vivent que dans le dashboard (le staff y répond, les membres continuent en MP ou dans l'espace membre, le transcript est tiré de l'historique) — pratique pour un petit serveur ou un staff qui ne travaille que sur le web.
- **Salon vocal temporaire** (bouton **Vocal** ou `/vocal`), réservé au membre et au staff qui voit le ticket, supprimé à la fermeture.
- **Fermer** depuis le salon ou le dashboard : le transcript est généré automatiquement.

## La fiche ticket

| | |
|---|---|
| **Temps réel** | Nouveaux messages sans recharger ; collègues qui regardent le ticket ou écrivent une réponse affichés en direct ; confirmation si quelqu'un a répondu pendant que tu écrivais |
| **Réponses** | Mode *Répondre* ou *Note interne*, anonyme ou signé, aperçu du rendu Discord, brouillons gardés si tu changes de page, correction ou retrait d'une réponse déjà envoyée |
| **Modèles et macros** | Réponses prêtes avec variables (`{{username}}`, `{{ticket_id}}`, champs personnalisés…), suggérées selon le sujet ; pour toi, pour le staff du serveur, ou — propriétaire de l'instance — pour **tous tes serveurs** à la fois ; une macro applique en plus des actions (s'attribuer, priorité, tag, étape, fermer) |
| **Organisation** | Attribution à plusieurs personnes, priorité, étape, tags, titre (le salon Discord suit), participants, tickets liés, fusion de deux tickets du même membre |
| **Suivi** | Suivre un ticket sans en être chargé, rappels personnels (« Me le rappeler »), mentions `@pseudo` ou `@grade` dans les notes, notes épinglées |
| **Aide** | Tickets similaires déjà résolus avec leur réponse, procédures à cocher par sujet, [fiche contact](#les-contacts) du demandeur (étiquettes, historique, fil du staff) |
| **Temps** | Chronomètre par ticket et temps ajouté à la main, délai par étape (SLA) avec temps restant et alerte « Hors délai » |

## Les types : incident ou demande

Dans **Paramètres → Général → Types de tickets**, un espace peut distinguer les **incidents** (quelque chose ne marche plus) des **demandes** (on demande quelque chose : un accès, un matériel, une information), et les renommer (« Panne », « Commande »…).

- **À l'ouverture**, le type vient du **sujet** (réglage par sujet ; une sous-catégorie prend celui de sa catégorie si elle n'a pas le sien), sinon c'est une demande. L'[API v3](./integrations#api-publique) peut le donner.
- Le staff le **change depuis la fiche** (permission de répondre), au journal. La liste se **filtre par type**, et [Analytiques → Rapports](./equipe#les-rapports) regroupe **par type**.
- Coupé, il n'existe que des demandes et aucun écran ne montre le type. Un espace existant le garde coupé jusqu'à ce qu'on l'active ; un nouvel espace l'a activé.

## La résolution et la clôture

Dans **Paramètres → Général → Résolution et clôture**, un espace **résout avant de fermer** :

1. Le staff clique **Résoudre** (fiche → Actions, permission de fermer) et écrit la **solution**. Elle part au demandeur par son canal ; le ticket reste ouvert, marqué **Résolu, en attente du demandeur**, et son délai (SLA) s'arrête, comme les relances d'inactivité.
2. Le demandeur **confirme** : bouton **C'est résolu** en MP, bandeau de l'[espace membre](./espace-membre), ou **lien à usage unique** reçu par e-mail (il ne montre que la solution). Le ticket se ferme comme d'habitude : transcript, demande de note.
3. S'il **écrit quoi que ce soit** (MP, réponse à l'e-mail, message sur le web, bouton **Pas encore**), le ticket **reprend**, avec son message.
4. **Sans réponse**, le ticket se ferme tout seul au bout du délai réglé (7 jours par défaut, 0 = jamais).

Le staff peut **annuler la résolution**. Chaque étape est au journal. Un espace existant ferme comme avant tant qu'il ne l'active pas ; un nouvel espace l'a activée. L'[API v3](./integrations#api-publique) propose aussi une solution (`POST /tickets/:id/resolve`).

## La priorité : urgence × impact

Dans **Paramètres → Général → Priorité : urgence × impact**, la priorité se **calcule** : l'**urgence** (pour le demandeur) et l'**impact** (combien de personnes, quelle gravité), chacun de *Très basse* à *Très haute*, donnent par une **matrice** réglable l'un des **6 niveaux** : Très basse, Basse, Moyenne, Haute, Très haute, Majeure. Sur la fiche, on règle l'urgence et l'impact, ou on **force** un niveau (*Majeure* se choisit ainsi).

Les **3 priorités** d'avant (basse, normale, urgente) restent et suivent le niveau : Très basse et Basse = basse, Moyenne = normale, Haute et au-delà = urgente. Ce qui les utilise ne change pas (`/priority` sur Discord, macros, règles par sujet, API v1 et v2, ordre de la file) ; réglées à l'ancienne, elles déplacent le niveau (basse → Basse, normale → Moyenne, urgente → Haute) s'il n'est pas déjà dans la bonne tranche. L'[API v3](./integrations#api-publique) accepte `urgency`, `impact` et `priority_level`. Coupée sur un espace existant tant qu'on ne l'active pas ; activée pour un nouvel espace.

## Les horaires d'ouverture

**Paramètres → Horaires** : les **calendriers** du support. Sans calendrier, le support est ouvert tout le temps (comme avant).

| Réglage | |
|---|---|
| **Horaires** | Par jour de la semaine, jusqu'à 4 plages (« 9 h – 12 h, 14 h – 18 h ») ; un jour sans plage est fermé |
| **Fuseau horaire** | Celui des horaires (`Europe/Paris`, `America/Montreal`…), heure d'été comprise |
| **Jours fermés** | Les **jours fériés** d'un pays (France, Belgique, Suisse, Luxembourg, Canada, États-Unis, Royaume-Uni, Allemagne), calculés pour cette année et la suivante, Pâques et Ascension comprises ; des **périodes de fermeture** (du … au …) ; chacun se modifie ou se retire |
| **Hors horaires** | Un ticket ouvert pendant la fermeture reçoit « le support est fermé, nous te répondons dès la réouverture, *lundi 9 h* », dans la langue du demandeur (ou ton propre message) |

L'espace choisit son calendrier ; une **équipe** peut avoir le sien (**Équipe → Équipes → Horaires de l'équipe**), qui s'applique à ses tickets. La page montre en direct si le support est ouvert et quand il rouvre. Les délais en heures ouvrées s'appuient sur ces calendriers.

## Les objectifs de délai (SLA)

**Paramètres → Horaires → Objectifs SLA** : deux délais par ticket, comptés en heures ouvrées du calendrier de son équipe (sinon de l'espace) ou en heures pleines.

| Objectif | |
|---|---|
| **Prise en charge** | Jusqu'à la première réponse du staff |
| **Résolution** | Jusqu'à la fermeture (ou la solution proposée) ; en **pause** tant que le ticket attend le demandeur (étape « En attente ») |

Un objectif s'applique aux tickets qui remplissent **tous** ses critères : priorités, types, sujets (une catégorie couvre ses sous-catégories), canaux (Discord, e-mail, web) ; un critère vide les prend tous. Quand plusieurs conviennent, le **plus précis** l'emporte, puis le premier de la liste (flèches pour l'ordre). Changer la priorité, le sujet, le type, l'équipe ou un calendrier recalcule les échéances des tickets ouverts.

La fiche montre les deux échéances (dans les temps, bientôt dépassé, dépassé, tenu, manqué, en pause) ; la liste signale un objectif dépassé et le filtre **SLA dépassé** le trouve ; les rapports par sujet, équipe ou type donnent le **taux d'objectifs tenus** (et l'export CSV). Les délais par étape (**Paramètres → Tickets**) restent à part.

### L'escalade

Chaque objectif a jusqu'à 6 **niveaux d'escalade**, à un pourcentage de son délai (50 % = à mi-chemin, 100 % = l'échéance, 150 % = dépassé de moitié). Un niveau atteint fait une ou plusieurs actions :

| Action | |
|---|---|
| **Prévenir** | Notification (dashboard et navigateur) aux personnes attribuées, sinon à l'équipe, sinon aux fondateurs ; seulement celles qui voient le ticket |
| **Monter la priorité** | Basse → normale → urgente |
| **Passer à une équipe** | Le ticket change d'équipe (jamais un ticket confidentiel) ; une équipe qui attribue le donne à l'un de ses membres |
| **Observateur** | Ajoute des membres du staff aux abonnés du ticket |
| **Salon d'escalade** | Une alerte dans le salon d'escalade Discord (sans le sujet d'un ticket confidentiel) |

La vérification tourne toutes les 5 minutes ; chaque niveau ne joue **qu'une fois** par ticket, et c'est noté dans son journal. Une résolution en pause n'escalade pas. Les équipes ont aussi leur **objectif interne** (OLA), avec ses propres niveaux : voir [Équipe](./equipe#les-equipes-et-leurs-files).

## Les statuts

Un ticket ouvert est dans un **statut** : **Ouvert**, **En attente** ou **En cours** par défaut. Dans **Paramètres → Tickets → Statuts**, un fondateur en ajoute d'autres, propres à l'espace (« Attente fournisseur », « À valider »…), jusqu'à 20 :

| Réglage | |
|---|---|
| **Nom et couleur** | Affichés partout : fiche ticket, Kanban (une colonne par statut), liste et filtres, file, journal, analytiques |
| **Pour le demandeur** | Le statut de base qu'il voit à la place (Ouvert, En attente ou En cours) : dans l'espace membre, `/mestickets` et le MP de changement d'étape. Le nom interne ne lui est jamais montré |
| **Catégorie Discord** | Le salon du ticket y est déplacé (comme pour les statuts de base) ; sans catégorie, seuls les fils et les tickets sans salon peuvent y passer |
| **Délai (SLA)** | Temps maximal dans ce statut avant « Hors délai », 0 = aucun ; compté dans les analytiques et le rapport mensuel |

On change de statut depuis la fiche, en masse depuis la liste, par une macro, ou sur Discord avec `/moveticket` (les statuts de l'espace sont proposés). L'ordre se règle avec les flèches. **Supprimer** un statut remet ses tickets dans son statut de base, sans déplacer leur salon. Chaque changement est au journal.

## Les validations

Un ticket peut demander **l'accord d'une personne** avant d'avancer (un remboursement, un accès exceptionnel…) : **fiche ticket → Validation → Demander une validation** (permission de répondre).

| | |
|---|---|
| **Qui valide** | Un membre du **staff** (il est prévenu dans le dashboard, par notification push et en MP, et répond depuis la fiche), ou **quelqu'un par e-mail** (un responsable hors de l'équipe : il reçoit un lien, valable 14 jours et à usage unique, qui ne montre que la demande, jamais la conversation) |
| **Ce qui est demandé** | Un texte libre, et éventuellement le **statut** où passer le ticket une fois l'accord donné |
| **Réponse** | **Accorder** (le ticket passe au statut choisi) ou **Refuser** (il reste où il est), avec un commentaire facultatif. Une seule réponse ; la personne qui a demandé est prévenue |
| **Relance** | **Relancer** à la main, une fois par heure au plus ; relance automatique après 24 h sans réponse, trois fois au plus (par e-mail, avec un nouveau lien : l'ancien ne marche plus) |

Une seule validation en attente par ticket ; la personne qui l'a demandée, ou un fondateur, peut l'**annuler**. Chaque étape est une note dans le ticket et une ligne de son journal. Un ticket **confidentiel** n'est validé que par un fondateur, jamais par e-mail. La validation par e-mail utilise l'[e-mail de l'instance](./instance#e-mail-de-l-instance), à raison de 10 envois (demandes et relances) par heure et par personne, 30 par espace.

## Les contacts

**Contacts** (menu Support) : une fiche par personne, quel que soit le canal. Chaque fiche regroupe ses **identités** : son compte Discord, son adresse pour les [tickets par e-mail](./integrations#tickets-par-e-mail), plus tard le portail web. Les fiches se créent d'elles-mêmes à partir des tickets, rien à saisir.

- **La fiche** : tous les tickets de ses identités, la note moyenne qu'elle donne, le temps passé, les champs personnalisés, la liste noire, les étiquettes (*VIP*, *à surveiller*…) et la discussion du staff à son sujet. Un nom, une adresse et des notes libres (société, téléphone, contexte) se modifient sur la fiche.
- **Fusionner** : quand `@pseudo` sur Discord et `marie@exemple.fr` sont la même personne, cherche l'autre contact depuis la fiche puis fusionne. Les identités, la discussion et les étiquettes rejoignent la fiche gardée ; les tickets ne bougent pas.
- **Détacher** une identité, pour corriger une fusion par erreur : elle retrouve une fiche à elle. L'identité principale (celle d'origine de la fiche) reste.
- **Confidentialité** : une fiche ne montre à chacun que les tickets qu'il a le droit de voir, chiffres compris ; un ticket restreint à un grade ou confidentiel n'y apparaît pas pour les autres.
- **Droits** : lire demande `view_tickets` ; modifier, fusionner et détacher demandent `reply_ticket`. Chaque fusion et chaque détachement sont inscrits au journal.
- L'**effacement des données** d'un membre (RGPD) retire aussi son identité de sa fiche, et la fiche si elle n'en a plus d'autre.

## La liste des tickets

- **Vues** : Ouverts, Mes tickets, Non attribués, Suivis, En attente, En cours, Urgents, Hors délai, Fermés, Tous — et tes propres vues enregistrées.
- **Recherche** dans les sujets avec opérateurs combinables : `tag:VIP`, `de:pseudo`, `avant:2026-10-01`, `après:01/10/2026`, `étape:attente`, `priorité:urgente`, `statut:fermé`, `assigné:moi`, `sujet:"mot de passe"`. Bascule sur **Messages** pour chercher dans tout le texte des échanges.
- **Actions en masse** : priorité, étape, tags, attribution, modèle, fermeture — chacune selon tes permissions.
- **Vue fractionnée** (Profil → Affichage) : la liste à gauche, le ticket à droite, sur un écran d'au moins 1 280 px.
- **Ma file** : tes tickets du plus urgent au moins urgent, avec la raison ; **Kanban** : les tickets en colonnes par étape.
