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

## Les statuts

Un ticket ouvert est dans un **statut** : **Ouvert**, **En attente** ou **En cours** par défaut. Dans **Paramètres → Tickets → Statuts**, un fondateur en ajoute d'autres, propres à l'espace (« Attente fournisseur », « À valider »…), jusqu'à 20 :

| Réglage | |
|---|---|
| **Nom et couleur** | Affichés partout : fiche ticket, Kanban (une colonne par statut), liste et filtres, file, journal, analytiques |
| **Pour le demandeur** | Le statut de base qu'il voit à la place (Ouvert, En attente ou En cours) : dans l'espace membre, `/mestickets` et le MP de changement d'étape. Le nom interne ne lui est jamais montré |
| **Catégorie Discord** | Le salon du ticket y est déplacé (comme pour les statuts de base) ; sans catégorie, seuls les fils et les tickets sans salon peuvent y passer |
| **Délai (SLA)** | Temps maximal dans ce statut avant « Hors délai », 0 = aucun ; compté dans les analytiques et le rapport mensuel |

On change de statut depuis la fiche, en masse depuis la liste, par une macro, ou sur Discord avec `/moveticket` (les statuts de l'espace sont proposés). L'ordre se règle avec les flèches. **Supprimer** un statut remet ses tickets dans son statut de base, sans déplacer leur salon. Chaque changement est au journal.

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
