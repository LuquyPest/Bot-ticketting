# Venir de GLPI

Ce guide reprend l'assistance d'un GLPI (tickets, utilisateurs, entités, base de connaissances) dans un espace Datick, sans toucher à GLPI. Compte une heure pour un premier essai. Le parc (ordinateurs, licences, contrats) ne se reprend pas : Datick s'en tient aux tickets.

## Ce que deviennent les notions de GLPI

| GLPI | Datick |
|---|---|
| Entité | [Organisation](./tickets#les-contacts), ou un espace par entité si leurs équipes sont séparées ([modèle d'espace](./instance#les-espaces)) |
| Utilisateur demandeur | Contact, reconnu par son adresse e-mail |
| Technicien | Membre du staff ([invitation](./equipe#les-comptes), ou [connexion par l'annuaire](./active-directory)) |
| Groupe de techniciens | [Équipe](./equipe), avec sa file et l'attribution automatique |
| Catégorie ITIL | Sujet (les catégories imbriquées gardent leur arborescence : « Matériel › Imprimante ») |
| Type incident / demande | Type de ticket |
| Urgence × impact → priorité | [Matrice de priorité](./tickets) |
| SLA / OLA | [Objectifs SLA et escalade](./mettre-en-place-un-sla) |
| Règles métier | [Règles](./automatismes) |
| Problème, changement | Problèmes et changements (Paramètres → Fonctionnalités) |
| Formulaires du catalogue | [Catalogue de services](./espace-membre) |

## 1. Préparer l'espace

1. **Instance → Espaces → Créer un espace** (ou ton espace Discord existant).
2. **Paramètres → Tickets** : recrée tes **catégories ITIL** comme sujets, avec la même arborescence.
3. **Paramètres → Horaires** : ton calendrier (heures ouvrées, jours fériés), puis tes [objectifs SLA](./mettre-en-place-un-sla).
4. **Équipe → Équipes** : un groupe de techniciens = une équipe.

## 2. Exporter depuis GLPI

Dans chaque liste de GLPI, affiche toutes les colonnes utiles puis exporte en **CSV** (icône d'export de la recherche) :

| Liste GLPI | Colonnes utiles | Type d'import |
|---|---|---|
| Administration → Entités | Nom | Organisations |
| Administration → Utilisateurs | Identifiant, Nom, Courriel, Entité | Contacts |
| Assistance → Tickets | ID, Titre, Statut, Priorité, Demandeur (courriel), Date d'ouverture, Date de résolution, Entité, Description | Tickets |
| Outils → Base de connaissances | ID, Sujet, Contenu, Catégorie | Articles |

Les en-têtes français de GLPI sont reconnus tels quels (« Titre », « Demandeur », « Date d'ouverture »…), le séparateur `;` aussi. Les statuts 5 (résolu) et 6 (clos) donnent des tickets fermés.

## 3. Importer, dans cet ordre

**Paramètres → Sauvegarde → Importer depuis un autre outil**, outil **GLPI** :

1. **Organisations**, puis **Contacts** (ils se rattachent à leur organisation), puis **Tickets**, puis **Articles**.
2. Pour chaque fichier : **Essai à blanc** d'abord. Il compte les lignes et montre comment il a compris la première ; corrige l'en-tête si une colonne manque, puis **Importer**.
3. Les articles arrivent **en brouillon** : relis-les dans **Base de connaissances**, puis publie-les.

Tu peux réimporter un export plus récent : rien n'est dupliqué, et **Mettre à jour ce qui est déjà importé** reprend les changements (voir [Venir d'un autre outil](./integrations#venir-d-un-autre-outil-d-assistance)).

## 4. Basculer

1. Branche la [boîte de support](./integrations#tickets-par-e-mail) sur Datick : les réponses des demandeurs arrivent dans leurs tickets.
2. Donne l'adresse de l'[espace membre](./espace-membre) aux demandeurs : ils y retrouvent leurs tickets repris depuis GLPI, par leur adresse e-mail.
3. Garde GLPI en lecture seule le temps de vérifier, puis coupe son assistance.
