# Équipe et permissions

## Les comptes

| Rôle | Accès |
|---|---|
| **Nouveau** | Page d'attente, aucun accès, jusqu'à ce qu'un grade lui soit attribué |
| **Support** | Le dashboard, limité aux **permissions de ses grades** — sans grade, aucun droit |
| **Fondateur** | Tout, sur son serveur : paramètres, équipe, blacklist, transcripts, clés API… |

Le **fondateur** d'un serveur est la personne qui a invité le bot (à défaut, le propriétaire du serveur) ; il peut en nommer d'autres. Le **propriétaire de l'instance** est fondateur sur tous les serveurs.

**Accès par rôle Discord** : les membres qui ont un rôle *support* ou *chef support* choisi dans **Paramètres → Rôles d'accès** obtiennent un compte à leur connexion, avec le grade associé. Ils le perdent avec le rôle Discord (vérifié à la connexion puis toutes les 5 minutes). Les comptes gérés à la main dans **Équipe** ne sont jamais touchés par cette synchronisation.

À la connexion, un membre du staff qui n'a accès qu'à un serveur arrive directement sur son dashboard.

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
| `manage_users` | Attribuer des grades (pas à soi-même, ni un grade plus puissant que les siens) |
| `manage_grades` | Créer et modifier des grades, restreindre la visibilité d'un ticket |
| `manage_settings` | Tags, FAQ, champs, procédures, incidents, santé du serveur |
| `view_audit` | Consulter le journal |

Un grade peut avoir un **parent** : les membres du parent voient aussi ce que voient les grades enfants. Un ticket **restreint à un grade** n'est visible que de ce grade, de ses parents et des fondateurs — sur Discord aussi, où son salon est fermé aux autres.

## Les rôles rattachés à des tags

**Rôles** (fondateurs) : des groupes de membres du staff, rattachés à un ou plusieurs **tags**. Un ticket qui porte l'un de ces tags n'est plus visible que des membres du rôle et des fondateurs, partout : liste, fiche, recherche, statistiques, notifications, commandes Discord, salon du ticket. Utile pour une équipe Comptabilité, Modération, Partenariats…

## Double authentification

- Chacun peut activer la **2FA** (application TOTP) dans son **Profil**, avec 10 codes de secours.
- Un fondateur peut l'**imposer** aux fondateurs ou à tout le staff (**Paramètres → Sécurité**).
- **Déconnexion après inactivité** réglable (15 minutes à 8 heures).
- Une connexion depuis un **nouvel appareil** envoie un MP au titulaire du compte.

## Organisation au quotidien

- **Disponibilité** (disponible, occupé, absent) sous son nom dans le menu, **mode vacances** et **absences planifiées** (Profil pour soi, Équipe pour les autres).
- **Mon activité** : ses chiffres sur 7, 30 ou 90 jours comparés à l'équipe.
- **Analytiques** : volume, délais, satisfaction, comparaison de périodes, réouvertures, temps passé, exports CSV et rapport mensuel PDF.
- **Journal** : chaque action, avec son auteur et sa source (dashboard, Discord, automatisme, API), filtrable et exportable.
