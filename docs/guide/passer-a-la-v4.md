# Passer à la v4

La v4 fait de Datick un outil de tickets complet où **Discord devient un canal parmi d'autres** : on peut l'utiliser sans Discord du tout, avec Discord comme aujourd'hui, ou les deux dans un même espace.

## Rien d'obligatoire

Une instance en v3 passe en v4 **sans rien faire** : mets à jour comme d'habitude (bouton **Mettre à jour** dans Instance → Santé, ou [à la main](./mise-a-jour)).

- Les migrations s'appliquent au démarrage ; aucune donnée n'est recopiée ni renommée.
- La connexion Discord, les MP, les salons, les commandes, les panels et `/setup` fonctionnent comme avant.
- L'image reste publiée sous l'ancien nom (`ghcr.io/luquypest/bot-ticketting`) en plus de `ghcr.io/luquypest/datick` : ton `.env` n'a pas à changer.
- L'API v1 et les webhooks ne changent pas.

## Les mots changent

| Avant | En v4 |
|---|---|
| Serveur (là où vivent les tickets, l'équipe, les réglages) | **Espace** |
| Mes serveurs | **Mes espaces** |
| Instance → Serveurs | **Instance → Espaces** |
| Profils des membres | **Contacts** |

« Serveur Discord » reste employé quand il s'agit vraiment de Discord. Un serveur déjà installé devient un espace **relié** à son serveur Discord : même identifiant, mêmes données.

## Ce que tu peux ajouter, si tu veux

| Quoi | Où |
|---|---|
| Un mot de passe sur ton compte, pour ne plus dépendre de Discord | Profil → Connexion |
| L'e-mail de l'instance (invitations, liens de connexion, réinitialisations) | Instance → Santé → E-mail de l'instance |
| Inviter des collègues par e-mail, avec un rôle et un grade | Équipe → Gestion → Invitations |
| Créer un espace sans Discord | Instance → Espaces → Créer un espace |
| Relier un espace à un serveur Discord, ou l'en délier | Instance → Espaces → Relier à Discord / Délier de Discord |
| Une fiche par personne, qui regroupe son compte Discord et son adresse e-mail | Support → Contacts |
| Laisser des personnes sans Discord ouvrir des tickets | Paramètres → Fonctionnalités → Espace membre web → « Ouvert à tous par e-mail » |
| Démarrer une instance sans Discord du tout | `DISCORD_TOKEN` vide, premier compte par jeton d'installation ([installation](./installation)) |

## Un espace sans Discord

Dans un espace qui n'est relié à aucun serveur Discord, le dashboard masque ce qui ne peut pas marcher : **Panels**, **Rôles**, **Santé du serveur**, **Newsletter**, l'onglet **Salons** des paramètres, les rôles d'accès, l'apparence du bot et le format des tickets sur Discord. Les tickets vivent dans le dashboard ; les demandeurs arrivent par e-mail (boîte de support) ou par l'[espace membre](./espace-membre) avec un lien de connexion.

Relier l'espace à un serveur Discord plus tard fait tout réapparaître, sans rien perdre.

## Après la mise à jour

1. Ouvre **Instance → Santé** : la version affichée est la v4 et les migrations sont passées (le journal du bot les liste au démarrage).
2. Si tu veux te passer de Discord pour te connecter : **Profil → Connexion → mot de passe**, et configure l'e-mail de l'instance pour pouvoir le réinitialiser.
3. Prévois l'e-mail de l'instance si tu veux inviter des collègues par e-mail ou ouvrir l'espace membre aux personnes sans Discord.
