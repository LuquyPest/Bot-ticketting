# Section Instance

L'**instance**, c'est ton installation : ton bot Discord et tous les serveurs où il est. Elle a un propriétaire, et un seul endroit pour la gérer.

## Le propriétaire

Le **propriétaire de l'instance** est le compte Discord qui possède l'application du bot (portail développeur → *General Information*). Pour une application d'équipe : le propriétaire et les admins de l'équipe. Tu peux ajouter des co-propriétaires avec `OWNER_IDS` dans le `.env`.

- Il se connecte au dashboard avec son compte Discord, comme tout le monde : pas de compte à part, pas de mot de passe.
- Il est **fondateur sur chaque serveur** de l'instance.
- Lui seul voit la liste de tous les serveurs à la connexion, obtient le lien d'invitation du bot et accède à la section **Instance** (menu Administration, ou `/instance`).

## Les serveurs

Un serveur Discord est **actif dès que le bot le rejoint** : sa base est créée, la personne qui a invité le bot en devient fondateur et reçoit un MP avec le lien du dashboard. Il n'y a pas de validation.

::: warning Bot privé
Dans le portail Discord, onglet *Bot*, décoche **Public Bot** : sinon n'importe qui peut ajouter ton bot à son serveur, et ce serveur serait activé sur ton instance. `ALLOWED_GUILDS` restreint en plus la liste des serveurs acceptés ; un avertissement s'affiche au démarrage si le bot est public sans cette liste.
:::

## Les pages

| Page | |
|---|---|
| **Vue d'ensemble** | Serveurs, tickets ouverts, tickets par jour sur 30 jours, staff, erreurs des dernières 24 heures, tableau par serveur |
| **Serveurs** | Suspendre, réactiver, mettre en maintenance, supprimer (le bot quitte le serveur et sa base est effacée) ; nommer ou retirer des fondateurs |
| **Santé** | Connexion Discord, base, Redis, tâches planifiées, mémoire, version de schéma de chaque base ; serveur de démonstration |
| **Erreurs** | Journal centralisé des erreurs du bot, du dashboard et des navigateurs, avec filtres ; **alerte** par MP (au propriétaire par défaut) ou webhook au-delà d'un seuil, et en cas de déconnexion de Discord |
| **Journal** | Chaque modification faite depuis la section, avec son auteur et le serveur concerné |
| **Blocages** | Adresses IP bloquées par les limites de connexion ou d'API, avec déblocage |

## Démonstration

Un serveur fictif rempli de données réalistes, ouvert à tous depuis la page de connexion (« Découvrir le dashboard ») ou directement à l'adresse `/demo` de ton domaine. **Désactivé par défaut**, il s'active dans **Instance → Santé**. Isolé de tout le reste : aucun MP n'en part, les actions vers Discord et vers l'extérieur sont refusées, et il est remis à zéro chaque nuit.

## Confidentialité

Une page de confidentialité est intégrée (`/confidentialite`) et liée depuis la connexion et l'espace membre : ce qui est enregistré, pourquoi, qui y a accès, combien de temps. Indique un e-mail de contact avec `CONTACT_EMAIL`, ou remplace la page par la tienne avec `PRIVACY_URL`.
