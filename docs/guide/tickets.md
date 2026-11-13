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

**Langue** : les messages du bot suivent le réglage du serveur — français, anglais, ou la langue Discord du membre. Les textes personnalisés (bienvenue, fermeture, FAQ) et les réponses du staff restent tels qu'écrits.

## Côté staff

- **Répondre** depuis la fiche du dashboard (avec un fichier jusqu'à 8 Mo, ou une capture collée), par `/reply`, ou anonymement par `/areply` (affiché « Support »). Un message tapé directement dans le salon Discord reste une note interne, jamais envoyée au membre.
- **Contacter un membre** soi-même : bouton **Nouveau ticket** de la page Tickets, `/contact`, ou clic droit sur un message → *Applications* → *Créer un ticket*.
- **Format des tickets** : un salon par ticket, avec des catégories de débordement au-delà de 50 salons et des fils privés au-delà de 500 ; ou salons uniquement ; ou fils privés uniquement.
- **Salon vocal temporaire** (bouton **Vocal** ou `/vocal`), réservé au membre et au staff qui voit le ticket, supprimé à la fermeture.
- **Fermer** depuis le salon ou le dashboard : le transcript est généré automatiquement.

## La fiche ticket

| | |
|---|---|
| **Temps réel** | Nouveaux messages sans recharger ; collègues qui regardent le ticket ou écrivent une réponse affichés en direct ; confirmation si quelqu'un a répondu pendant que tu écrivais |
| **Réponses** | Mode *Répondre* ou *Note interne*, anonyme ou signé, aperçu du rendu Discord, brouillons gardés si tu changes de page, correction ou retrait d'une réponse déjà envoyée |
| **Modèles et macros** | Réponses prêtes avec variables (`{{username}}`, `{{ticket_id}}`, champs personnalisés…), suggérées selon le sujet ; une macro applique en plus des actions (s'attribuer, priorité, tag, étape, fermer) |
| **Organisation** | Attribution à plusieurs personnes, priorité, étape, tags, titre (le salon Discord suit), participants, tickets liés, fusion de deux tickets du même membre |
| **Suivi** | Suivre un ticket sans en être chargé, rappels personnels (« Me le rappeler »), mentions `@pseudo` ou `@grade` dans les notes, notes épinglées |
| **Aide** | Tickets similaires déjà résolus avec leur réponse, procédures à cocher par sujet, profil du membre (étiquettes, historique, fil du staff) |
| **Temps** | Chronomètre par ticket et temps ajouté à la main, délai par étape (SLA) avec temps restant et alerte « Hors délai » |

## La liste des tickets

- **Vues** : Ouverts, Mes tickets, Non attribués, Suivis, En attente, En cours, Urgents, Hors délai, Fermés, Tous — et tes propres vues enregistrées.
- **Recherche** dans les sujets avec opérateurs combinables : `tag:VIP`, `de:pseudo`, `avant:2026-10-01`, `après:01/10/2026`, `étape:attente`, `priorité:urgente`, `statut:fermé`, `assigné:moi`, `sujet:"mot de passe"`. Bascule sur **Messages** pour chercher dans tout le texte des échanges.
- **Actions en masse** : priorité, étape, tags, attribution, modèle, fermeture — chacune selon tes permissions.
- **Vue fractionnée** (Profil → Affichage) : la liste à gauche, le ticket à droite, sur un écran d'au moins 1 280 px.
- **Ma file** : tes tickets du plus urgent au moins urgent, avec la raison ; **Kanban** : les tickets en colonnes par étape.
