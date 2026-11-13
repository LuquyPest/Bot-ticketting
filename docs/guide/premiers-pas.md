# Premiers pas

Le bot vient d'arriver sur ton serveur et tu es connecté au dashboard comme **fondateur**. Quelques réglages, et les membres peuvent ouvrir leurs premiers tickets.

## 1. Rôles d'accès et catégories

**Paramètres → Rôles d'accès** :

- **Rôles support** et **rôles chef support** : les membres Discord qui ont ces rôles obtiennent un compte sur le dashboard à leur connexion, avec le grade correspondant (*Support* ou *Chef support*, créés automatiquement). S'ils perdent le rôle, l'accès leur est retiré.
- **Catégories des étapes** : une catégorie Discord par étape (*Ouvert*, *En attente*, *En cours*). Changer l'étape d'un ticket déplace son salon.
- **Format des tickets sur Discord** : un salon par ticket (par défaut, avec des fils privés au-delà de 500 salons), salons uniquement, ou fils privés uniquement.

::: warning Permissions du bot
Le bot a besoin de **Gérer les salons** et **Gérer les rôles** pour créer des salons privés et en régler l'accès. **Santé du serveur** (menu Configuration) vérifie toutes ses permissions et signale ce qui manque.
:::

## 2. Sujets de ticket

**Paramètres → Sujets de ticket** : la liste proposée au membre en boutons (« Paiement », « Compte », « Signalement »…). Pour chaque sujet, des **règles automatiques** peuvent ajouter un tag, fixer une priorité ou réserver le ticket à un grade. Une règle se déclenche par sujet ou par mots-clés du premier message.

## 3. Messages et langue

Dans **Paramètres** :
- **Général** : message de bienvenue envoyé en MP à l'ouverture, message de fermeture ;
- **Langue du bot** : langue des messages aux membres — français, anglais, ou automatique (celle de leur Discord) ;
- **Apparence du bot sur ce serveur** : pseudo et photo du bot, visibles sur ce serveur uniquement.

## 4. L'équipe

- **Équipe** : les comptes du dashboard, leurs grades, le mode vacances et les absences planifiées.
- **Grades** : crée des grades sur mesure (Helper, Modérateur…) et choisis leurs permissions. Voir [Équipe et permissions](./equipe).

## 5. Pour aller plus loin

| Page | Pour |
|---|---|
| **FAQ** | Répondre aux questions fréquentes avant même l'ouverture d'un ticket |
| **Champs** | Demander un n° de commande, un pseudo en jeu… à l'ouverture |
| **Formulaires** | Un questionnaire étape par étape avant la création du ticket |
| **Panels** | Publier dans un salon un message à boutons pour ouvrir un ticket sans passer par les MP |
| **Tags** et **Rôles** | Classer les tickets, et réserver certains tags à une partie de l'équipe |
| **Paramètres → Salons de logs** | Garder une trace des ouvertures, fermetures et escalades dans des salons |
| **Paramètres → Sécurité** | Imposer la 2FA, déconnecter après inactivité, voir la clé des sauvegardes (propriétaire) |

## 6. Tester

Envoie un message privé au bot depuis un compte qui n'est pas du staff : le ticket doit apparaître dans **Tickets** et dans la catégorie *Ouvert* de ton serveur. Réponds depuis la fiche : la réponse arrive en MP.
