# Mettre en place un SLA

Un SLA, ici, ce sont des **délais tenus ou non** sur chaque ticket : prise en charge (première réponse) et résolution. Ce guide les met en place pas à pas ; le détail de chaque réglage est dans [Tickets → Les objectifs de délai](./tickets#les-objectifs-de-delai-sla).

## 1. Les heures ouvrées

**Paramètres → Horaires** : jours et heures d'ouverture, fuseau horaire, jours fériés. Les délais se comptent dans ces heures : 8 h ouvrées ouvertes le vendredi à 17 h tombent le lundi après-midi. Une équipe qui travaille à d'autres heures a ses propres horaires (**Équipe → Équipes**).

## 2. Les objectifs

**Paramètres → Horaires → Objectifs SLA**. Un exemple courant :

| Objectif | Critères | Prise en charge | Résolution |
|---|---|---|---|
| Urgent | Priorité urgente | 1 h | 8 h |
| Incident | Type incident | 4 h | 3 jours |
| Standard | aucun (tous les autres) | 1 jour | 5 jours |

Un ticket prend l'objectif **le plus précis** qui lui correspond (le plus de critères remplis, puis l'ordre de la liste). La résolution s'arrête tant que le ticket attend le demandeur. Pour un client à part, une [règle](./automatismes) peut choisir l'objectif : « si l'organisation est *Client Or*, alors objectif SLA *Contrat or* ».

## 3. L'escalade

Dans chaque objectif, ajoute des **niveaux d'escalade** : à 75 % du délai, prévenir l'équipe ; à 100 %, monter la priorité et ajouter un responsable comme observateur ; à 150 %, passer le ticket à une autre équipe. Un **OLA** fait de même pour le délai interne d'une équipe.

## 4. Suivre

- La fiche ticket montre les deux échéances et leur état ; la liste filtre **SLA dépassé**.
- **Tableaux** : un widget « Objectifs SLA tenus » par équipe ou organisation.
- **Statistiques → Rapports** : taux tenu par sujet, équipe, organisation, sur la période de ton choix, en XLSX ou PDF, et programmé chaque semaine par e-mail.
- Le [rapport public](./espace-membre) peut afficher la part des tickets traités dans les délais.
