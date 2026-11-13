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

## Annoncer un problème connu

**Incidents** (`manage_settings`) : pour une panne connue, un incident a un titre, un message et éventuellement des sujets. Tant qu'il est ouvert, chaque nouveau ticket concerné reçoit ce message en MP juste après l'accueil, et un bandeau le rappelle au staff. À la résolution, les membres touchés peuvent être prévenus.
