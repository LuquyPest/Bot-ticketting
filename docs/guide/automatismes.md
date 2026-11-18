# Automatismes

Toutes les tâches planifiées passent par **BullMQ** (Redis) : chacune ne s'exécute qu'une fois, et le planning survit aux redémarrages.

| Automatisme | Ce qu'il fait |
|---|---|
| **Inactivité du membre** | Avertissement, puis fermeture si le membre ne répond plus |
| **Inactivité du staff** | Avertissement, puis fermeture si le staff ne répond pas |
| **Rappel staff** | MP au responsable d'un ticket sans réponse depuis N heures (au plus une fois par jour) |
| **Escalade** | Alerte dans un salon, puis fermeture, pour les tickets urgents sans réponse prolongée |
| **Délais par étape (SLA)** | Temps restant affiché, ticket « Hors délai » au-delà |
| **Messages programmés** | Envoi à une date et une heure précises |
| **Questions sans réponse** | Ouvre sans sujet le ticket d'un membre qui n'a pas répondu à la question du sujet |
| **Absences planifiées** | Mode vacances au début de l'absence, retiré à la fin |
| **Rappels personnels** | Notification, push et MP à l'échéance |
| **Rapport hebdomadaire** | Chaque lundi à 9 h, statistiques et classement dans un salon |
| **Rapport mensuel** | Le 1er du mois à 9 h, un PDF du mois écoulé dans un salon |
| **Santé du serveur** | Toutes les 15 minutes : permissions du bot, salons et rôles configurés ; nouveau problème signalé en MP aux fondateurs |
| **Surveillance Discord** | Alerte le propriétaire si le bot reste déconnecté de Discord, puis à la reconnexion |
| **Alerte d'erreurs** | Prévient le propriétaire au-delà d'un seuil d'erreurs |
| **Rétention** | Chaque nuit, purge des journaux anciens et, si `TRANSCRIPT_RETENTION_DAYS` est fixé, des transcripts |
| **Sauvegarde** | Chaque nuit à 3 h, sauvegarde chiffrée de toutes les bases ([détails](./sauvegardes)) |
| **Statistiques publiques** | Toutes les heures, met à jour le message de statistiques du support dans le salon choisi ([détails](#statistiques-publiques)) |
| **Surveillance des sauvegardes** | Toutes les heures : sauvegarde, vérification ou copie hors du serveur en échec ou en retard → MP au propriétaire |
| **Nouvelles versions** | Chaque jour : MP au propriétaire quand une nouvelle version est publiée ([détails](./mise-a-jour)) |

## Les règles automatiques

**Paramètres → Règles** (fondateurs, ou la permission **Gérer les règles automatiques** d'un grade) : *quand* il arrive quelque chose à un ticket, *si* ses conditions sont remplies, *alors* la règle agit.

| | |
|---|---|
| **Quand** | Un ticket est ouvert · le demandeur écrit · le staff répond · le statut change · la priorité change (un ou plusieurs) · **le temps passe** (voir ci-dessous) |
| **Si** (toutes, ou au moins une) | Canal (Discord, e-mail, web) · adresse de réception · type · sujet (une catégorie couvre ses sous-catégories) · mots dans le message · demandeur (adresse, domaine `@client.fr`, nom) · priorité · statut · tag · horaires (support ouvert ou fermé) · langue du demandeur ; chaque condition peut être inversée (« n'est pas ») |
| **Alors** | Priorité · urgence et impact · type · sujet · équipe · attribuer à une personne · ajouter ou retirer un tag · statut · restreindre à un grade · observateurs · prévenir des membres du staff · réponse automatique au demandeur · note interne · webhook · fermer |

Les règles passent **dans l'ordre** de la liste (flèches) ; **« arrêter après cette règle »** empêche les suivantes. Chaque règle appliquée est notée au **journal du ticket** (« règle *Clients VIP* appliquée : priorité urgente, tag VIP »). **Tester** montre, sur un ticket existant, quelles conditions sont remplies et ce que la règle ferait, sans rien changer.

### Quand le temps passe

Une règle peut agir **un certain temps après** un moment du ticket : son ouverture, son dernier changement de statut, le dernier message du demandeur, la dernière réponse du staff, la dernière activité ; ou **avant / après une échéance SLA** (prise en charge, résolution). Le délai se compte en **heures ouvrées** du calendrier du ticket (son équipe, sinon l'espace) ou en heures pleines.

Exemples : « 48 h ouvrées après la dernière réponse du staff, si le statut est *En attente* : réponse automatique *As-tu pu essayer ?* » ; « 1 h avant l'échéance de résolution : prévenir le responsable ». La vérification tourne toutes les 5 minutes. Une règle ne joue **qu'une fois** par ticket et par moment : une nouvelle réponse ou un nouveau statut relance le compte. Une échéance SLA en pause (attente du demandeur) ou déjà tenue ne déclenche rien.

L'inactivité et l'escalade des tickets urgents (**Paramètres → Tickets**) gardent leurs réglages propres.

Garde-fous : une modification faite par une règle ne relance pas les règles (pas de boucle) ; 50 actions au plus par événement ; restreindre à un grade demande aussi la permission **Gérer les grades** ; une règle ne lève jamais un ticket confidentiel, ne le change pas d'équipe et ne prévient que du staff qui le voit.

Les **règles par sujet et par mots-clés** d'avant (**Paramètres → Tickets**) sont devenues des règles de ce moteur, avec le même effet ; leur formulaire simple reste, et elles passent avant celles-ci à l'ouverture. Les règles font partie de l'[export de configuration](./integrations#sauvegarde-de-la-configuration) (tags, équipes, grades et statuts par leur nom ; les personnes choisies ne sont pas exportées).

## Les notifications

**Paramètres → Notifications** (fondateurs) : qui est prévenu de quoi, et comment. Chaque notification associe un **événement**, des **destinataires** et des **canaux** :

| | |
|---|---|
| **Événements** | Nouveau ticket · message du demandeur · réponse du staff · note interne · attribution · changement de statut · fermeture · objectif SLA dépassé |
| **Destinataires** | La personne attribuée (pour une attribution) · les personnes attribuées · les observateurs · l'équipe du ticket · les fondateurs · des adresses e-mail fixes (une astreinte, une liste) |
| **Canaux** | Dashboard et navigateur (notification en direct et push) · MP Discord · e-mail (l'adresse vérifiée du compte, par l'e-mail de l'instance) |

Par défaut, c'est ce qui partait avant : les observateurs sont prévenus des messages, notes et fermetures dans le dashboard ; la personne attribuée dans le dashboard et par MP Discord. Personne n'est prévenu d'un ticket qu'il ne voit pas, ni de sa propre action ; un ticket confidentiel ne donne que son numéro hors de l'espace. « Objectif SLA dépassé » ne part qu'une fois par ticket et par objectif.

Chacun règle dans **Profil → Ce qui me prévient** ce qui l'atteint, canal par canal, sauf les notifications **imposées** par l'espace.

### Les messages envoyés au demandeur

Plus bas, **Messages envoyés au demandeur** : les messages automatiques (ticket créé, en attente, en cours, solution proposée, hors horaires, ticket fermé…) se réécrivent **dans chacune des 6 langues** ; le demandeur reçoit celle de sa langue, sur Discord, par e-mail ou sur le portail. Les variables du texte standard (`{id}`, `{days}`, `{when}`…) restent disponibles, une variable inconnue est refusée ; **Aperçu** montre le texte avec des valeurs d'exemple. Un texte vidé revient au texte standard.

## Statistiques publiques

**Paramètres → Salons → Statistiques publiques** : choisis un salon, et le bot y publie un message mis à jour toutes les heures, avec les chiffres des 30 derniers jours :

- tickets résolus ;
- première réponse (médiane), et part des tickets qui l'ont reçue dans le délai que tu fixes (2 h par défaut) ;
- temps de résolution (médiane) ;
- satisfaction moyenne et nombre d'avis.

Le message ne contient que des chiffres, jamais de nom ni de sujet de ticket, et suit la langue du bot sur le serveur. Un même message est modifié à chaque fois ; **Publier maintenant** le met à jour tout de suite. Une ligne sans données (pas encore de note, par exemple) n'est pas affichée.

## Annoncer un problème connu

**Incidents** (`manage_settings`) : pour une panne connue, un incident a un titre, un message et éventuellement des sujets. Tant qu'il est ouvert, chaque nouveau ticket concerné reçoit ce message en MP juste après l'accueil, et un bandeau le rappelle au staff. À la résolution, les membres touchés peuvent être prévenus.
